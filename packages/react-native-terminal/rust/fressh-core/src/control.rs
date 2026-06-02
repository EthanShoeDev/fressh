//! The control plane: id-keyed `async` functions the binding shim wraps (§10).
//! These are the only entry points JS reaches through the shim; each delegates to
//! the registry + sessions and runs its work on the core runtime via
//! [`runtime::run`] so russh's internal tasks land on our runtime, not the shim's.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use fressh_ssh::{
	ConnectOptions, ConnectionDetails, KeyType, ProgressCallback, StartShellOptions, SshError,
};

use crate::events::{self, CoreEvent};
use crate::host_key::{self, ParkingVerifier};
use crate::session::{ConnectionSession, ShellSession};
use crate::{registry, runtime};

static CONN_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_connection_id(details: &ConnectionDetails) -> String {
	let n = CONN_COUNTER.fetch_add(1, Ordering::Relaxed);
	format!("{}@{}:{}#{}", details.username, details.host, details.port, n)
}

/// Establish + authenticate a connection. The connection id is assigned up front
/// so the `hostKeyPending` event (emitted mid-handshake, before this resolves)
/// can be answered with `respond_to_host_key(connectionId, …)`. (§7)
pub async fn connect(details: ConnectionDetails) -> Result<String, SshError> {
	runtime::run(async move {
		let connection_id = next_connection_id(&details);

		let verifier = Arc::new(ParkingVerifier { connection_id: connection_id.clone() });

		let progress_conn_id = connection_id.clone();
		let on_progress: ProgressCallback = Arc::new(move |event| {
			events::emit(CoreEvent::ConnectProgress {
				connection_id: progress_conn_id.clone(),
				event,
			});
		});

		let conn = fressh_ssh::connect(ConnectOptions {
			details,
			verifier,
			on_progress: Some(on_progress),
		})
		.await?;

		registry::insert_connection(Arc::new(ConnectionSession {
			connection_id: connection_id.clone(),
			inner: Arc::new(conn),
		}));
		Ok(connection_id)
	})
	.await
}

/// Resume a parked host-key decision (accept/reject the server key). (§7)
pub fn respond_to_host_key(connection_id: &str, accept: bool) {
	host_key::respond_to_host_key(connection_id, accept);
}

/// Open a PTY + shell on a connection, returning the new shell id. The reader
/// loop starts immediately, feeding the durable `Term`.
pub async fn start_shell(
	connection_id: String,
	opts: StartShellOptions,
	cols: usize,
	rows: usize,
	scrollback_lines: usize,
) -> Result<String, SshError> {
	runtime::run(async move {
		let conn = registry::connection(&connection_id)
			.ok_or_else(|| SshError::NotFound(connection_id.clone()))?;
		let shell = conn.inner.open_shell(opts).await?;
		let shell_id = format!("{}:{}", connection_id, shell.channel_id);
		let session = ShellSession::spawn(
			shell_id.clone(),
			connection_id,
			shell,
			cols,
			rows,
			scrollback_lines,
		);
		registry::insert_shell(session);
		Ok(shell_id)
	})
	.await
}

/// Send user input (stdin) to a shell.
pub async fn send_data(shell_id: String, data: Vec<u8>) -> Result<(), SshError> {
	let shell =
		registry::shell(&shell_id).ok_or_else(|| SshError::NotFound(shell_id.clone()))?;
	runtime::run(async move { shell.send_data(&data).await }).await
}

/// Resize a shell's terminal (reflow `Term` + SSH window-change).
pub async fn resize(shell_id: String, cols: usize, rows: usize) -> Result<(), SshError> {
	let shell =
		registry::shell(&shell_id).ok_or_else(|| SshError::NotFound(shell_id.clone()))?;
	runtime::run(async move { shell.resize(cols, rows).await }).await
}

/// Close a shell channel and drop its `Term`.
pub async fn close_shell(shell_id: String) -> Result<(), SshError> {
	if let Some(shell) = registry::remove_shell(&shell_id) {
		runtime::run(async move { shell.close().await }).await;
		events::emit(CoreEvent::ShellClosed { shell_id });
	}
	Ok(())
}

/// Disconnect a connection: close its shells, then drop the connection.
pub async fn disconnect(connection_id: String) -> Result<(), SshError> {
	runtime::run(async move {
		for shell in registry::shells_for_connection(&connection_id) {
			registry::remove_shell(&shell.shell_id);
			shell.close().await;
			events::emit(CoreEvent::ShellClosed { shell_id: shell.shell_id.clone() });
		}
		if let Some(conn) = registry::remove_connection(&connection_id) {
			let _ = conn.inner.disconnect().await;
			events::emit(CoreEvent::ConnectionClosed { connection_id });
		}
		Ok(())
	})
	.await
}

/// Generate a new key pair (OpenSSH private-key string). Sync; no runtime needed.
pub fn generate_key_pair(key_type: KeyType) -> Result<String, SshError> {
	fressh_ssh::generate_key_pair(key_type)
}

/// Validate a private key, returning its canonical OpenSSH form. Sync.
pub fn validate_private_key(pem: &str) -> Result<String, SshError> {
	fressh_ssh::validate_private_key(pem)
}
