//! `shim-uniffi` — the binding shim we ship FIRST (§7, §10), plus the render-plane
//! C-ABI ([`android`]). It maps the agnostic control surface (FresshControlSpec,
//! §10) onto uniffi-exported, id-keyed functions, each delegating to `fressh-core`:
//!   - flat, id-keyed fns (no exported objects)
//!   - `Promise<T>` over async entry points (uniffi `async_runtime = "tokio"`)
//!   - a one-way event sink (uniffi callback interface → `fressh_core::EventSink`)
//!   - `ArrayBuffer`/structs/enums across the boundary
//!
//! The DTOs below are the thin mapping layer: `fressh-core` carries plain Rust
//! types (no uniffi derives), so we define uniffi-shaped mirrors here and convert.
//! Swapping to craby later replaces THIS file's wrappers, not the core.

use std::sync::Arc;

#[cfg(target_os = "android")]
mod android;

uniffi::setup_scaffolding!();

// ─────────────────────────── error ───────────────────────────

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum SshError {
	#[error("Disconnected")]
	Disconnected,
	#[error("Unsupported key type")]
	UnsupportedKeyType,
	#[error("Auth failed: {0}")]
	Auth(String),
	#[error("Shell already running")]
	ShellAlreadyRunning,
	#[error("Host key rejected")]
	HostKeyRejected,
	#[error("Not found: {0}")]
	NotFound(String),
	#[error("SSH error: {0}")]
	Ssh(String),
	#[error("Key error: {0}")]
	Keys(String),
}

impl From<fressh_core::SshError> for SshError {
	fn from(e: fressh_core::SshError) -> Self {
		use fressh_core::SshError as E;
		match e {
			E::Disconnected => SshError::Disconnected,
			E::UnsupportedKeyType => SshError::UnsupportedKeyType,
			E::Auth(m) => SshError::Auth(m),
			E::ShellAlreadyRunning => SshError::ShellAlreadyRunning,
			E::HostKeyRejected => SshError::HostKeyRejected,
			E::NotFound(m) => SshError::NotFound(m),
			E::Russh(m) => SshError::Ssh(m),
			E::RusshKeys(m) => SshError::Keys(m),
		}
	}
}

// ─────────────────────────── value types (DTOs) ───────────────────────────

#[derive(uniffi::Enum)]
pub enum Security {
	Password { password: String },
	Key { private_key_content: String },
}
impl From<Security> for fressh_core::Security {
	fn from(s: Security) -> Self {
		match s {
			Security::Password { password } => fressh_core::Security::Password { password },
			Security::Key {
				private_key_content,
			} => fressh_core::Security::Key {
				private_key_content,
			},
		}
	}
}

#[derive(uniffi::Record)]
pub struct ConnectionDetails {
	pub host: String,
	pub port: u16,
	pub username: String,
	pub security: Security,
}
impl From<ConnectionDetails> for fressh_core::ConnectionDetails {
	fn from(d: ConnectionDetails) -> Self {
		fressh_core::ConnectionDetails {
			host: d.host,
			port: d.port,
			username: d.username,
			security: d.security.into(),
		}
	}
}

#[derive(uniffi::Enum)]
pub enum KeyType {
	Rsa,
	Ecdsa,
	Ed25519,
	Ed448,
}
impl From<KeyType> for fressh_core::KeyType {
	fn from(k: KeyType) -> Self {
		match k {
			KeyType::Rsa => fressh_core::KeyType::Rsa,
			KeyType::Ecdsa => fressh_core::KeyType::Ecdsa,
			KeyType::Ed25519 => fressh_core::KeyType::Ed25519,
			KeyType::Ed448 => fressh_core::KeyType::Ed448,
		}
	}
}

#[derive(uniffi::Enum)]
pub enum TerminalType {
	Vanilla,
	Vt100,
	Vt102,
	Vt220,
	Ansi,
	Xterm,
	Xterm256,
}
impl From<TerminalType> for fressh_core::TerminalType {
	fn from(t: TerminalType) -> Self {
		match t {
			TerminalType::Vanilla => fressh_core::TerminalType::Vanilla,
			TerminalType::Vt100 => fressh_core::TerminalType::Vt100,
			TerminalType::Vt102 => fressh_core::TerminalType::Vt102,
			TerminalType::Vt220 => fressh_core::TerminalType::Vt220,
			TerminalType::Ansi => fressh_core::TerminalType::Ansi,
			TerminalType::Xterm => fressh_core::TerminalType::Xterm,
			TerminalType::Xterm256 => fressh_core::TerminalType::Xterm256,
		}
	}
}

#[derive(uniffi::Record)]
pub struct ShellOptions {
	pub term: TerminalType,
	pub cols: u32,
	pub rows: u32,
	pub scrollback_lines: u32,
	/// Auto-inject OSC 633 shell integration on connect (cwd / command lifecycle /
	/// exit code / command text). `None` ⇒ default on. Set `false` from the app's
	/// global kill-switch / per-host toggle to behave like a plain SSH client.
	pub shell_integration: Option<bool>,
}

#[derive(uniffi::Record)]
pub struct ServerPublicKeyInfo {
	pub host: String,
	pub port: u16,
	pub remote_ip: Option<String>,
	pub algorithm: String,
	pub fingerprint_sha256: String,
	pub key_base64: String,
}
impl From<fressh_core::ServerPublicKeyInfo> for ServerPublicKeyInfo {
	fn from(i: fressh_core::ServerPublicKeyInfo) -> Self {
		ServerPublicKeyInfo {
			host: i.host,
			port: i.port,
			remote_ip: i.remote_ip,
			algorithm: i.algorithm,
			fingerprint_sha256: i.fingerprint_sha256,
			key_base64: i.key_base64,
		}
	}
}

#[derive(uniffi::Enum)]
pub enum SshConnectionProgressEvent {
	TcpConnected,
	SshHandshake,
}
impl From<fressh_core::SshConnectionProgressEvent> for SshConnectionProgressEvent {
	fn from(e: fressh_core::SshConnectionProgressEvent) -> Self {
		match e {
			fressh_core::SshConnectionProgressEvent::TcpConnected => {
				SshConnectionProgressEvent::TcpConnected
			}
			fressh_core::SshConnectionProgressEvent::SshHandshake => {
				SshConnectionProgressEvent::SshHandshake
			}
		}
	}
}

// ─────────────────────────── event sink (one-way) ───────────────────────────

#[derive(uniffi::Enum)]
pub enum FresshEvent {
	ConnectProgress {
		connection_id: String,
		event: SshConnectionProgressEvent,
	},
	HostKeyPending {
		connection_id: String,
		info: ServerPublicKeyInfo,
	},
	ConnectionClosed {
		connection_id: String,
	},
	ShellClosed {
		shell_id: String,
	},
	// Shell-integration semantic events (OSC 7 + OSC 133); see fressh-core::osc.
	WorkingDirectoryChanged {
		shell_id: String,
		path: String,
	},
	PromptStart {
		shell_id: String,
	},
	CommandStart {
		shell_id: String,
	},
	CommandFinished {
		shell_id: String,
		exit_code: Option<i32>,
		duration_ms: Option<u64>,
	},
	CommandText {
		shell_id: String,
		command: String,
	},
}
impl From<fressh_core::CoreEvent> for FresshEvent {
	fn from(ev: fressh_core::CoreEvent) -> Self {
		use fressh_core::CoreEvent as E;
		match ev {
			E::ConnectProgress {
				connection_id,
				event,
			} => FresshEvent::ConnectProgress {
				connection_id,
				event: event.into(),
			},
			E::HostKeyPending {
				connection_id,
				info,
			} => FresshEvent::HostKeyPending {
				connection_id,
				info: info.into(),
			},
			E::ConnectionClosed { connection_id } => {
				FresshEvent::ConnectionClosed { connection_id }
			}
			E::ShellClosed { shell_id } => FresshEvent::ShellClosed { shell_id },
			E::WorkingDirectoryChanged { shell_id, path } => {
				FresshEvent::WorkingDirectoryChanged { shell_id, path }
			}
			E::PromptStart { shell_id } => FresshEvent::PromptStart { shell_id },
			E::CommandStart { shell_id } => FresshEvent::CommandStart { shell_id },
			E::CommandFinished {
				shell_id,
				exit_code,
				duration_ms,
			} => FresshEvent::CommandFinished {
				shell_id,
				exit_code,
				duration_ms,
			},
			E::CommandText { shell_id, command } => {
				FresshEvent::CommandText { shell_id, command }
			}
		}
	}
}

/// JS implements this to receive the low-frequency event stream (§10 event plane).
#[uniffi::export(with_foreign)]
pub trait FresshEventListener: Send + Sync {
	fn on_event(&self, event: FresshEvent);
}

struct SinkBridge {
	listener: Arc<dyn FresshEventListener>,
}
impl fressh_core::EventSink for SinkBridge {
	fn emit(&self, event: fressh_core::CoreEvent) {
		self.listener.on_event(event.into());
	}
}

/// Install the JS event listener. Call once at module init.
#[uniffi::export]
pub fn set_event_listener(listener: Arc<dyn FresshEventListener>) {
	fressh_core::set_event_sink(Arc::new(SinkBridge { listener }));
}

// ─────────────────────────── control plane ───────────────────────────

/// Connect + authenticate. Returns the connection id. A `HostKeyPending` event is
/// emitted mid-handshake; answer it with [`respond_to_host_key`].
#[uniffi::export(async_runtime = "tokio")]
pub async fn connect(details: ConnectionDetails) -> Result<String, SshError> {
	fressh_core::connect(details.into())
		.await
		.map_err(Into::into)
}

/// Resume a parked host-key decision (accept/reject the server key).
#[uniffi::export]
pub fn respond_to_host_key(connection_id: String, accept: bool) {
	fressh_core::respond_to_host_key(&connection_id, accept);
}

/// Open a PTY + shell, returning the new shell id. Render with `<Terminal shellId=…/>`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn start_shell(connection_id: String, options: ShellOptions) -> Result<String, SshError> {
	let cols = options.cols as usize;
	let rows = options.rows as usize;
	let scrollback = options.scrollback_lines as usize;
	let core_opts = fressh_core::StartShellOptions {
		term: options.term.into(),
		terminal_mode: None,
		terminal_size: Some(fressh_core::TerminalSize {
			col_width: Some(options.cols),
			row_height: Some(options.rows),
		}),
		terminal_pixel_size: None,
		shell_integration: options.shell_integration.unwrap_or(true),
	};
	fressh_core::start_shell(connection_id, core_opts, cols, rows, scrollback)
		.await
		.map_err(Into::into)
}

/// Create a non-SSH preview shell fed a canned snippet, bound by `previewId`.
/// Render it with `<Terminal shellId={previewId} />` — the live config still flows
/// through, so it reflows as Terminal settings change. Tear down with
/// [`close_preview`]. Sync (no network round-trip).
#[uniffi::export]
pub fn create_preview(preview_id: String, demo: Vec<u8>) {
	fressh_core::create_preview(preview_id, demo);
}

/// Tear down a preview shell created by [`create_preview`]. Emits no `ShellClosed`
/// event (preview lifetime is owned by the settings screen, not the session list).
#[uniffi::export(async_runtime = "tokio")]
pub async fn close_preview(preview_id: String) {
	fressh_core::close_preview(preview_id).await;
}

/// Send user input (stdin) to a shell. (Also available on the render plane.)
#[uniffi::export(async_runtime = "tokio")]
pub async fn send_data(shell_id: String, data: Vec<u8>) -> Result<(), SshError> {
	fressh_core::send_data(shell_id, data)
		.await
		.map_err(Into::into)
}

/// Resize a shell's terminal.
#[uniffi::export(async_runtime = "tokio")]
pub async fn resize(shell_id: String, cols: u32, rows: u32) -> Result<(), SshError> {
	fressh_core::resize(shell_id, cols as usize, rows as usize)
		.await
		.map_err(Into::into)
}

// ─────────────────────── touch interaction (scroll + selection) ──────────────

/// Which kind of selection a touch starts. Maps to `fressh_core::SelectionKind`.
#[derive(uniffi::Enum)]
pub enum SelectionKind {
	Simple,
	Word,
	Line,
}
impl From<SelectionKind> for fressh_core::SelectionKind {
	fn from(k: SelectionKind) -> Self {
		match k {
			SelectionKind::Simple => fressh_core::SelectionKind::Simple,
			SelectionKind::Word => fressh_core::SelectionKind::Word,
			SelectionKind::Line => fressh_core::SelectionKind::Line,
		}
	}
}

/// Scroll a shell by `delta_px` physical px (positive = finger dragged down =
/// older content). Honors mouse-reporting / alt-screen modes; otherwise moves the
/// scrollback viewport. Touch gestures live in JS and call this by `shellId`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn scroll(shell_id: String, delta_px: f32) -> Result<(), SshError> {
	fressh_core::scroll(shell_id, delta_px)
		.await
		.map_err(Into::into)
}

/// Begin a selection at a touch point (physical px, surface-relative).
#[uniffi::export]
pub fn selection_start(shell_id: String, x: f32, y: f32, kind: SelectionKind) {
	fressh_core::selection_start(&shell_id, x, y, kind.into());
}

/// Extend the active selection to a touch point (physical px).
#[uniffi::export]
pub fn selection_update(shell_id: String, x: f32, y: f32) {
	fressh_core::selection_update(&shell_id, x, y);
}

/// Clear any active selection.
#[uniffi::export]
pub fn selection_clear(shell_id: String) {
	fressh_core::selection_clear(&shell_id);
}

/// The currently selected text, if any.
#[uniffi::export]
pub fn selection_text(shell_id: String) -> Option<String> {
	fressh_core::selection_text(&shell_id)
}

/// Close a shell channel and drop its `Term`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn close_shell(shell_id: String) -> Result<(), SshError> {
	fressh_core::close_shell(shell_id).await.map_err(Into::into)
}

/// Disconnect a connection (closes its shells first).
#[uniffi::export(async_runtime = "tokio")]
pub async fn disconnect(connection_id: String) -> Result<(), SshError> {
	fressh_core::disconnect(connection_id)
		.await
		.map_err(Into::into)
}

/// Generate a new key pair (OpenSSH private-key string).
#[uniffi::export]
pub fn generate_key_pair(key_type: KeyType) -> Result<String, SshError> {
	fressh_core::generate_key_pair(key_type.into()).map_err(Into::into)
}

/// Validate a private key; returns its canonical OpenSSH form.
#[uniffi::export]
pub fn validate_private_key(pem: String) -> Result<String, SshError> {
	fressh_core::validate_private_key(&pem).map_err(Into::into)
}
