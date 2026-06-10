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
		let info = server_public_key_to_info(
			&self.host,
			self.port,
			self.remote_ip.clone(),
			server_public_key,
		);
		async move { Ok(verifier.verify(info).await) }
	}
}

/// Captured output of a one-off [`Connection::exec_command`] run.
#[derive(Debug, Clone)]
pub struct CommandOutput {
	pub stdout: Vec<u8>,
	pub stderr: Vec<u8>,
	/// Exit code, or `None` if the command was killed by a signal / the server
	/// omitted it.
	pub exit_code: Option<i32>,
}

/// Soft cap on captured stdout/stderr (each) for a one-off command, so a runaway
/// command (`cat huge`, `yes`) can't OOM the app. Excess is dropped; the channel is
/// still drained so it closes cleanly.
const EXEC_OUTPUT_CAP: usize = 256 * 1024;

fn append_capped(buf: &mut Vec<u8>, data: &[u8]) {
	if buf.len() >= EXEC_OUTPUT_CAP {
		return;
	}
	let room = EXEC_OUTPUT_CAP - buf.len();
	buf.extend_from_slice(&data[..data.len().min(room)]);
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

		let row_height = opts
			.terminal_size
			.and_then(|s| s.row_height)
			.unwrap_or(DEFAULT_TERM_ROW_HEIGHT);
		let col_width = opts
			.terminal_size
			.and_then(|s| s.col_width)
			.unwrap_or(DEFAULT_TERM_COL_WIDTH);
		let pixel_width = opts
			.terminal_pixel_size
			.and_then(|s| s.pixel_width)
			.unwrap_or(DEFAULT_TERM_PIXEL_WIDTH);
		let pixel_height = opts
			.terminal_pixel_size
			.and_then(|s| s.pixel_height)
			.unwrap_or(DEFAULT_TERM_PIXEL_HEIGHT);

		ch.request_pty(
			true,
			opts.term.as_ssh_name(),
			col_width,
			row_height,
			pixel_width,
			pixel_height,
			&modes,
		)
		.await?;

		if opts.shell_integration {
			// Launch the interactive shell with OSC 633 shell integration injected
			// (cwd / command lifecycle / exit code / command text), nothing touched
			// permanently on the host. The bootstrap self-falls-back to a plain login
			// shell for shells it can't inject. See crate::shell_integration.
			let nonce = crate::shell_integration::generate_nonce();
			let exec_command = crate::shell_integration::build_exec_command(&nonce);
			ch.exec(true, exec_command).await?;
		} else {
			ch.request_shell(true).await?;
		}

		let (reader, writer) = ch.split();
		Ok(Shell {
			channel_id,
			term: opts.term,
			created_at_ms: started_at_ms,
			reader: ShellReader::new(reader),
			writer: ShellWriter::new(writer),
		})
	}

	/// Run a single command on this connection **without a PTY or shell** (the russh
	/// `exec` request): open a sibling session channel, `exec` the command, collect
	/// stdout/stderr until the channel closes, and return them with the exit code.
	/// The interactive shell (if any) is untouched — this is just another channel on
	/// the same multiplexed transport. Powers the Commands tab's one-off runner and
	/// (later) out-of-band `git status`.
	pub async fn exec_command(&self, command: &str) -> Result<CommandOutput, SshError> {
		// Hold the client-handle lock only long enough to OPEN the channel; the
		// returned channel is owned, so the read loop below doesn't block the shell's
		// writes (which use their own channel write-half, not this lock).
		let mut ch = {
			let handle = self.client_handle.lock().await;
			handle.channel_open_session().await?
		};
		ch.exec(true, command.as_bytes().to_vec()).await?;

		let mut stdout = Vec::new();
		let mut stderr = Vec::new();
		let mut exit_code = None;
		while let Some(msg) = ch.wait().await {
			match msg {
				russh::ChannelMsg::Data { data } => append_capped(&mut stdout, &data),
				russh::ChannelMsg::ExtendedData { data, ext } => {
					// ext == 1 is stderr (SSH_EXTENDED_DATA_STDERR); fold anything else
					// into stdout rather than dropping it.
					append_capped(if ext == 1 { &mut stderr } else { &mut stdout }, &data);
				}
				russh::ChannelMsg::ExitStatus { exit_status } => {
					exit_code = Some(exit_status as i32);
				}
				// Eof/Close end the stream; the loop exits when `wait` returns None.
				_ => {}
			}
		}
		Ok(CommandOutput {
			stdout,
			stderr,
			exit_code,
		})
	}

	/// Disconnect the SSH session (closes all channels server-side).
	pub async fn disconnect(&self) -> Result<(), SshError> {
		let handle = self.client_handle.lock().await;
		handle
			.disconnect(Disconnect::ByApplication, "bye", "")
			.await?;
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
			handle
				.authenticate_password(details.username.clone(), password.clone())
				.await?
		}
		Security::Key {
			private_key_content,
		} => {
			let (_canonical, parsed) = normalize_openssh_ed25519_seed_key(private_key_content)?;
			let pk_with_hash = PrivateKeyWithHashAlg::new(Arc::new(parsed), None);
			handle
				.authenticate_publickey(details.username.clone(), pk_with_hash)
				.await?
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
