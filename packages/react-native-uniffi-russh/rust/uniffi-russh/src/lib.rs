use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rand::rngs::OsRng;
use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;

use russh::{self, client, ChannelMsg, Disconnect};
use russh::client::{Config as ClientConfig, Handle as ClientHandle};
use russh_keys::{Algorithm as KeyAlgorithm, EcdsaCurve, PrivateKey};
use russh_keys::ssh_key::{self, LineEnding};

uniffi::setup_scaffolding!();

/// ---------- Types ----------

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum Security {
    Password { password: String },
    Key { key_id: String }, // (key-based auth can be wired later)
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ConnectionDetails {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub security: Security,
}

#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum SSHConnectionStatus {
    TcpConnecting,
    TcpConnected,
    TcpDisconnected,
    ShellConnecting,
    ShellConnected,
    ShellDisconnected,
}

/// PTY types similar to the old TS lib (plus xterm-256color, which is common).
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum PtyType {
    Vanilla,
    Vt100,
    Vt102,
    Vt220,
    Ansi,
    Xterm,
    Xterm256,
}
impl PtyType {
    fn as_ssh_name(self) -> &'static str {
        match self {
            PtyType::Vanilla => "vanilla",
            PtyType::Vt100 => "vt100",
            PtyType::Vt102 => "vt102",
            PtyType::Vt220 => "vt220",
            PtyType::Ansi => "ansi",
            PtyType::Xterm => "xterm",
            PtyType::Xterm256 => "xterm-256color",
        }
    }
}

#[derive(Debug, Error, uniffi::Error)]
pub enum SshError {
    #[error("Disconnected")]
    Disconnected,
    #[error("Unsupported key type")]
    UnsupportedKeyType,
    #[error("Auth failed: {0}")]
    Auth(String),
    #[error("Shell already running")]
    ShellAlreadyRunning,
    #[error("russh error: {0}")]
    Russh(String),
    #[error("russh-keys error: {0}")]
    RusshKeys(String),
}
impl From<russh::Error> for SshError {
    fn from(e: russh::Error) -> Self { SshError::Russh(e.to_string()) }
}
impl From<russh_keys::Error> for SshError {
    fn from(e: russh_keys::Error) -> Self { SshError::RusshKeys(e.to_string()) }
}
impl From<ssh_key::Error> for SshError {
    fn from(e: ssh_key::Error) -> Self { SshError::RusshKeys(e.to_string()) }
}

/// Status callback (used separately by connect and by start_shell)
#[uniffi::export(with_foreign)]
pub trait StatusListener: Send + Sync {
    fn on_status_change(&self, status: SSHConnectionStatus);
}

/// Channel data callback (stdout/stderr unified)
#[uniffi::export(with_foreign)]
pub trait ChannelListener: Send + Sync {
    fn on_data(&self, data: Vec<u8>);
}

/// Key types for generation
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum KeyType {
    Rsa,
    Ecdsa,
    Ed25519,
    Ed448,
}

/// ---------- Connection object (no shell until start_shell) ----------

#[derive(uniffi::Object)]
pub struct SSHConnection {
    connection_details: ConnectionDetails,
    created_at_ms: f64,
    tcp_established_at_ms: f64,

    handle: AsyncMutex<ClientHandle<NoopHandler>>,

    // Shell state (one active shell per connection by design).
    shell: AsyncMutex<Option<ShellState>>,

    // Data listeners for whatever shell is active.
    listeners: Arc<Mutex<Vec<Arc<dyn ChannelListener>>>>,
}

struct ShellState {
    channel_id: u32,
    writer: russh::ChannelWriteHalf<client::Msg>,
    // We keep the reader task to allow cancellation on close.
    reader_task: tokio::task::JoinHandle<()>,
    // Only used for Shell* statuses.
    shell_status_listener: Option<Arc<dyn StatusListener>>,
}

impl fmt::Debug for SSHConnection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let listeners_len = self.listeners.lock().map(|v| v.len()).unwrap_or(0);
        f.debug_struct("SSHConnection")
            .field("connection_details", &self.connection_details)
            .field("created_at_ms", &self.created_at_ms)
            .field("tcp_established_at_ms", &self.tcp_established_at_ms)
            .field("listeners_len", &listeners_len)
            .finish()
    }
}

/// Minimal client::Handler.
struct NoopHandler;
impl client::Handler for NoopHandler {
    type Error = SshError;
}

/// ---------- Methods ----------

#[uniffi::export(async_runtime = "tokio")]
impl SSHConnection {
    pub fn connection_details(&self) -> ConnectionDetails {
        self.connection_details.clone()
    }
    pub fn created_at_ms(&self) -> f64 {
        self.created_at_ms
    }
    pub fn tcp_established_at_ms(&self) -> f64 {
        self.tcp_established_at_ms
    }

    /// Return current shell channel id, if any.
    pub async fn channel_id(&self) -> Option<u32> {
        self.shell.lock().await.as_ref().map(|s| s.channel_id)
    }

    pub fn add_channel_listener(&self, listener: Arc<dyn ChannelListener>) {
        self.listeners.lock().unwrap().push(listener);
    }
    pub fn remove_channel_listener(&self, listener: Arc<dyn ChannelListener>) {
        if let Ok(mut v) = self.listeners.lock() {
            v.retain(|l| !Arc::ptr_eq(l, &listener));
        }
    }

    /// Start a shell with the given PTY. Emits only Shell* statuses via `shell_status_listener`.
    pub async fn start_shell(
        &self,
        pty: PtyType,
        shell_status_listener: Option<Arc<dyn StatusListener>>,
    ) -> Result<u32, SshError> {
        // Prevent double-start (safe default).
        if self.shell.lock().await.is_some() {
            return Err(SshError::ShellAlreadyRunning);
        }

        if let Some(sl) = shell_status_listener.as_ref() {
            sl.on_status_change(SSHConnectionStatus::ShellConnecting);
        }

        // Open session channel.
        let handle = self.handle.lock().await;
        let ch = handle.channel_open_session().await?;
        let channel_id: u32 = ch.id().into();

        // Request PTY & shell.
        ch.request_pty(true, pty.as_ssh_name(), 80, 24, 0, 0, &[]).await?;
        ch.request_shell(true).await?;

        // Split for read/write; spawn reader.
        let (mut reader, writer) = ch.split();
        let listeners = self.listeners.clone();
        let shell_listener_for_task = shell_status_listener.clone();
        let reader_task = tokio::spawn(async move {
            loop {
                match reader.wait().await {
                    Some(ChannelMsg::Data { data }) => {
                        if let Ok(cl) = listeners.lock() {
                            let snapshot = cl.clone();
                            let buf = data.to_vec();
                            for l in snapshot { l.on_data(buf.clone()); }
                        }
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        if let Ok(cl) = listeners.lock() {
                            let snapshot = cl.clone();
                            let buf = data.to_vec();
                            for l in snapshot { l.on_data(buf.clone()); }
                        }
                    }
                    Some(ChannelMsg::Close) | None => {
                        if let Some(sl) = shell_listener_for_task.as_ref() {
                            sl.on_status_change(SSHConnectionStatus::ShellDisconnected);
                        }
                        break;
                    }
                    _ => { /* ignore others */ }
                }
            }
        });

        *self.shell.lock().await = Some(ShellState {
            channel_id,
            writer,
            reader_task,
            shell_status_listener,
        });

        // Report ShellConnected.
        if let Some(sl) = self.shell.lock().await.as_ref().and_then(|s| s.shell_status_listener.clone()) {
            sl.on_status_change(SSHConnectionStatus::ShellConnected);
        }

        Ok(channel_id)
    }

    /// Send bytes to the active shell (stdin).
    pub async fn send_data(&self, data: Vec<u8>) -> Result<(), SshError> {
        let mut guard = self.shell.lock().await;
        let state = guard.as_mut().ok_or(SshError::Disconnected)?;
        state.writer.data(&data[..]).await?;
        Ok(())
    }

    /// Close the active shell channel (if any) and stop its reader task.
    pub async fn close_shell(&self) -> Result<(), SshError> {
        if let Some(state) = self.shell.lock().await.take() {
            // Try to close channel gracefully; ignore error.
            state.writer.close().await.ok();
            state.reader_task.abort();
            if let Some(sl) = state.shell_status_listener {
                sl.on_status_change(SSHConnectionStatus::ShellDisconnected);
            }
        }
        Ok(())
    }

    /// Disconnect TCP (also closes any active shell).
    pub async fn disconnect(&self) -> Result<(), SshError> {
        // Close shell first.
        let _ = self.close_shell().await;

        let h = self.handle.lock().await;
        h.disconnect(Disconnect::ByApplication, "bye", "").await?;
        Ok(())
    }
}

/// ---------- Top-level API ----------

#[uniffi::export(async_runtime = "tokio")]
pub async fn connect(
    details: ConnectionDetails,
    connect_status_listener: Option<Arc<dyn StatusListener>>,
) -> Result<Arc<SSHConnection>, SshError> {
    if let Some(sl) = connect_status_listener.as_ref() {
        sl.on_status_change(SSHConnectionStatus::TcpConnecting);
    }

    // TCP
    let cfg = Arc::new(ClientConfig::default());
    let addr = format!("{}:{}", details.host, details.port);
    let mut handle: ClientHandle<NoopHandler> = client::connect(cfg, addr, NoopHandler).await?;

    if let Some(sl) = connect_status_listener.as_ref() {
        sl.on_status_change(SSHConnectionStatus::TcpConnected);
    }

    // Auth
    let auth = match &details.security {
        Security::Password { password } => {
            handle.authenticate_password(details.username.clone(), password.clone()).await?
        }
        Security::Key { .. } => {
            return Err(SshError::UnsupportedKeyType);
        }
    };
    match auth {
        client::AuthResult::Success => {}
        other => return Err(SshError::Auth(format!("{other:?}"))),
    }

    let now = now_ms();
    Ok(Arc::new(SSHConnection {
        connection_details: details,
        created_at_ms: now,
        tcp_established_at_ms: now,
        handle: AsyncMutex::new(handle),
        shell: AsyncMutex::new(None),
        listeners: Arc::new(Mutex::new(Vec::new())),
    }))
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn generate_key_pair(key_type: KeyType) -> Result<String, SshError> {
    let mut rng = OsRng;
    let key = match key_type {
        KeyType::Rsa => PrivateKey::random(&mut rng, KeyAlgorithm::Rsa { hash: None })?,
        KeyType::Ecdsa => PrivateKey::random(
            &mut rng,
            KeyAlgorithm::Ecdsa { curve: EcdsaCurve::NistP256 },
        )?,
        KeyType::Ed25519 => PrivateKey::random(&mut rng, KeyAlgorithm::Ed25519)?,
        KeyType::Ed448 => return Err(SshError::UnsupportedKeyType),
    };
    let pem = key.to_openssh(LineEnding::LF)?; // Zeroizing<String>
    Ok(pem.to_string())
}

fn now_ms() -> f64 {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    d.as_millis() as f64
}
