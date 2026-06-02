//! Connect + authenticate + open shell channels. Ported from the uniffi-russh
//! crate, with the uniffi callback traits replaced by plain-Rust seams:
//!   - host-key verification -> [`HostKeyVerifier`] (async, returns bool)
//!   - connection progress    -> a plain `Fn` callback
//! `fressh-core` implements the verifier via host-key park/resume. (§7)

use std::sync::Arc;

use futures::future::BoxFuture;
use russh::client::{self, Config, Handle as ClientHandle};
use russh::keys::{PrivateKeyWithHashAlg, PublicKeyBase64};
use russh::Disconnect;

use crate::private_key::normalize_openssh_ed25519_seed_key;
use crate::shell::{
	Shell, ShellReader, ShellWriter, StartShellOptions, DEFAULT_TERMINAL_MODES,
	DEFAULT_TERM_COL_WIDTH, DEFAULT_TERM_PIXEL_HEIGHT, DEFAULT_TERM_PIXEL_WIDTH,
	DEFAULT_TERM_ROW_HEIGHT,
};
use crate::utils::{now_ms, SshError};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Security {
	Password { password: String },
	Key { private_key_content: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionDetails {
	pub host: String,
	pub port: u16,
	pub username: String,
	pub security: Security,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshConnectionProgressEvent {
	// Before any progress events, assume: TcpConnecting.
	TcpConnected,
	SshHandshake,
	// If the connect call has not resolved, assume: Authenticating.
	// After it resolves, assume: Connected.
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SshConnectionInfoProgressTimings {
	pub tcp_established_at_ms: f64,
	pub ssh_handshake_at_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerPublicKeyInfo {
	pub host: String,
	pub port: u16,
	pub remote_ip: Option<String>,
	pub algorithm: String,
	pub fingerprint_sha256: String,
	pub key_base64: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SshConnectionInfo {
	pub details: ConnectionDetails,
	pub local_port: u16,
	pub created_at_ms: f64,
	pub connected_at_ms: f64,
	pub progress_timings: SshConnectionInfoProgressTimings,
}

/// Async host-key decision. `fressh-core` implements this as park/resume: emit a
/// `hostKeyPending` event, park a `oneshot`, resume on `respond_to_host_key`. (§7)
pub trait HostKeyVerifier: Send + Sync {
	fn verify(&self, info: ServerPublicKeyInfo) -> BoxFuture<'static, bool>;
}

/// Connection-progress sink (TcpConnected / SshHandshake). One-way, rare.
pub type ProgressCallback = Arc<dyn Fn(SshConnectionProgressEvent) + Send + Sync>;

pub struct ConnectOptions {
	pub details: ConnectionDetails,
	pub verifier: Arc<dyn HostKeyVerifier>,
	pub on_progress: Option<ProgressCallback>,
}

fn server_public_key_to_info(
	host: &str,
	port: u16,
	remote_ip: Option<String>,
	pk: &russh::keys::PublicKey,
) -> ServerPublicKeyInfo {
	ServerPublicKeyInfo {
		host: host.to_string(),
		port,
		remote_ip,
		algorithm: pk.algorithm().to_string(),
		fingerprint_sha256: format!("{}", pk.fingerprint(russh::keys::ssh_key::HashAlg::Sha256)),
		key_base64: pk.public_key_base64(),
	}
}

/// russh `client::Handler` that defers the host-key decision to a [`HostKeyVerifier`].
pub(crate) struct Handler {
	verifier: Arc<dyn HostKeyVerifier>,
	host: String,
	port: u16,
	remote_ip: Option<String>,
}

impl client::Handler for Handler {
	type Error = SshError;

	fn check_server_key(
		&mut self,
		server_public_key: &russh::keys::PublicKey,
	) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
		let verifier = self.verifier.clone();
		let info =
			server_public_key_to_info(&self.host, self.port, self.remote_ip.clone(), server_public_key);
		async move { Ok(verifier.verify(info).await) }
	}
}

/// A live, authenticated SSH connection. Lifetime is owned by `fressh-core`'s
/// registry, not by a JS handle. (§7)
pub struct Connection {
	pub info: SshConnectionInfo,
	client_handle: AsyncMutex<ClientHandle<Handler>>,
}

impl Connection {
	/// Open a PTY + shell channel.
	pub async fn open_shell(&self, opts: StartShellOptions) -> Result<Shell, SshError> {
		let started_at_ms = now_ms();
		let handle = self.client_handle.lock().await;
		let ch = handle.channel_open_session().await?;
		let channel_id: u32 = ch.id().into();

		let mut modes: Vec<(russh::Pty, u32)> = DEFAULT_TERMINAL_MODES.to_vec();
		if let Some(overrides) = &opts.terminal_mode {
			for m in overrides {
				if let Some(pty) = russh::Pty::from_u8(m.opcode) {
					if let Some(pos) = modes.iter().position(|(p, _)| *p as u8 == m.opcode) {
						modes[pos].1 = m.value;
					} else {
						modes.push((pty, m.value));
					}
				}
			}
		}

		let row_height =
			opts.terminal_size.and_then(|s| s.row_height).unwrap_or(DEFAULT_TERM_ROW_HEIGHT);
		let col_width =
			opts.terminal_size.and_then(|s| s.col_width).unwrap_or(DEFAULT_TERM_COL_WIDTH);
		let pixel_width =
			opts.terminal_pixel_size.and_then(|s| s.pixel_width).unwrap_or(DEFAULT_TERM_PIXEL_WIDTH);
		let pixel_height = opts
			.terminal_pixel_size
			.and_then(|s| s.pixel_height)
			.unwrap_or(DEFAULT_TERM_PIXEL_HEIGHT);

		ch.request_pty(true, opts.term.as_ssh_name(), col_width, row_height, pixel_width, pixel_height, &modes)
			.await?;
		ch.request_shell(true).await?;

		let (reader, writer) = ch.split();
		Ok(Shell {
			channel_id,
			term: opts.term,
			created_at_ms: started_at_ms,
			reader: ShellReader::new(reader),
			writer: ShellWriter::new(writer),
		})
	}

	/// Disconnect the SSH session (closes all channels server-side).
	pub async fn disconnect(&self) -> Result<(), SshError> {
		let handle = self.client_handle.lock().await;
		handle.disconnect(Disconnect::ByApplication, "bye", "").await?;
		Ok(())
	}
}

/// Establish a TCP connection, perform the SSH handshake (host key verified via
/// `opts.verifier`), and authenticate.
pub async fn connect(opts: ConnectOptions) -> Result<Connection, SshError> {
	let started_at_ms = now_ms();
	let details = opts.details;

	let addr = format!("{}:{}", details.host, details.port);
	let socket = tokio::net::TcpStream::connect(&addr).await?;
	let local_port = socket.local_addr()?.port();
	let remote_ip = socket.peer_addr().ok().map(|a| a.ip().to_string());

	let tcp_established_at_ms = now_ms();
	if let Some(cb) = opts.on_progress.as_ref() {
		cb(SshConnectionProgressEvent::TcpConnected);
	}

	let cfg = Arc::new(Config::default());
	let mut handle = client::connect_stream(
		cfg,
		socket,
		Handler {
			verifier: opts.verifier.clone(),
			host: details.host.clone(),
			port: details.port,
			remote_ip,
		},
	)
	.await?;

	let ssh_handshake_at_ms = now_ms();
	if let Some(cb) = opts.on_progress.as_ref() {
		cb(SshConnectionProgressEvent::SshHandshake);
	}

	let auth_result = match &details.security {
		Security::Password { password } => {
			handle.authenticate_password(details.username.clone(), password.clone()).await?
		}
		Security::Key { private_key_content } => {
			let (_canonical, parsed) = normalize_openssh_ed25519_seed_key(private_key_content)?;
			let pk_with_hash = PrivateKeyWithHashAlg::new(Arc::new(parsed), None);
			handle.authenticate_publickey(details.username.clone(), pk_with_hash).await?
		}
	};
	if !matches!(auth_result, client::AuthResult::Success) {
		return Err(auth_result.into());
	}

	Ok(Connection {
		info: SshConnectionInfo {
			details,
			local_port,
			created_at_ms: started_at_ms,
			connected_at_ms: now_ms(),
			progress_timings: SshConnectionInfoProgressTimings {
				tcp_established_at_ms,
				ssh_handshake_at_ms,
			},
		},
		client_handle: AsyncMutex::new(handle),
	})
}
