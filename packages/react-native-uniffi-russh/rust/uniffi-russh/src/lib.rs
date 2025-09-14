//! This file is used to generate Typescript bindings for the Russh library.
//!
//! For more information on the available data types, see the following links:
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/common-types.html
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/async-callbacks.html

use std::fmt;
use std::sync::{Arc, Mutex, Weak};
use std::time::{SystemTime, UNIX_EPOCH};

use rand::rngs::OsRng;
use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;

use russh::{self, client, ChannelMsg, Disconnect};
use russh::client::{Config as ClientConfig, Handle as ClientHandle};
use russh_keys::{Algorithm as KeyAlgorithm, EcdsaCurve, PrivateKey};
use russh_keys::ssh_key::{self, LineEnding};

uniffi::setup_scaffolding!();

// Simpler aliases to satisfy clippy type-complexity.
type ListenerEntry = (u64, Arc<dyn ChannelListener>);
type ListenerList = Vec<ListenerEntry>;

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

/// Options for establishing a TCP connection and authenticating.
/// Listener is embedded here so TS has a single arg.
#[derive(Clone, uniffi::Record)]
pub struct ConnectOptions {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub security: Security,
    pub on_status_change: Option<Arc<dyn StatusListener>>,
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
    fn on_change(&self, status: SSHConnectionStatus);
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

/// Options for starting a shell.
#[derive(Clone, uniffi::Record)]
pub struct StartShellOptions {
    pub pty: PtyType,
    pub on_status_change: Option<Arc<dyn StatusListener>>,
}

/// Snapshot of current connection info for property-like access in TS.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SshConnectionInfo {
    pub connection_details: ConnectionDetails,
    pub created_at_ms: f64,
    pub tcp_established_at_ms: f64,
}

/// Snapshot of shell session info for property-like access in TS.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ShellSessionInfo {
    pub channel_id: u32,
    pub created_at_ms: f64,
    pub pty: PtyType,
}

/// ---------- Connection object (no shell until start_shell) ----------

#[derive(uniffi::Object)]
pub struct SSHConnection {
    connection_details: ConnectionDetails,
    created_at_ms: f64,
    tcp_established_at_ms: f64,

    handle: AsyncMutex<ClientHandle<NoopHandler>>,

    // Shell state (one active shell per connection by design).
    shell: AsyncMutex<Option<Arc<ShellSession>>>,

    // Weak self for child sessions to refer back without cycles.
    self_weak: AsyncMutex<Weak<SSHConnection>>,

    // Data listeners for whatever shell is active. We track by id for removal.
    listeners: Arc<Mutex<ListenerList>>,
    next_listener_id: Arc<Mutex<u64>>, // simple counter guarded by same kind of mutex
}

#[derive(uniffi::Object)]
pub struct ShellSession {
    // Weak backref; avoid retain cycle.
    parent: std::sync::Weak<SSHConnection>,
    channel_id: u32,
    writer: AsyncMutex<russh::ChannelWriteHalf<client::Msg>>,
    // We keep the reader task to allow cancellation on close.
    reader_task: tokio::task::JoinHandle<()>,
    // Only used for Shell* statuses.
    shell_status_listener: Option<Arc<dyn StatusListener>>,
    created_at_ms: f64,
    pty: PtyType,
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
    // Accept any server key for now so dev UX isn't blocked.
    // TODO: Add known-hosts verification and surface API to control this.
    #[allow(unused_variables)]
    fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> impl std::future::Future<Output = std::result::Result<bool, <Self as russh::client::Handler>::Error>> + std::marker::Send {
        std::future::ready(Ok(true))
    }
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

    /// Convenience snapshot for property-like access in TS.
    pub async fn info(&self) -> SshConnectionInfo {
        SshConnectionInfo {
            connection_details: self.connection_details.clone(),
            created_at_ms: self.created_at_ms,
            tcp_established_at_ms: self.tcp_established_at_ms,
        }
    }

    /// Add a channel listener and get an id you can later remove with.
    pub fn add_channel_listener(&self, listener: Arc<dyn ChannelListener>) -> u64 {
        let mut guard = self.listeners.lock().unwrap();
        let mut id_guard = self.next_listener_id.lock().unwrap();
        let id = *id_guard + 1;
        *id_guard = id;
        guard.push((id, listener));
        id
    }
    pub fn remove_channel_listener(&self, id: u64) {
        if let Ok(mut v) = self.listeners.lock() {
            v.retain(|(lid, _)| *lid != id);
        }
    }

    /// Start a shell with the given PTY. Emits only Shell* statuses via options.on_status_change.
    pub async fn start_shell(&self, opts: StartShellOptions) -> Result<Arc<ShellSession>, SshError> {
        // Prevent double-start (safe default).
        if self.shell.lock().await.is_some() {
            return Err(SshError::ShellAlreadyRunning);
        }

        let pty = opts.pty;
        let shell_status_listener = opts.on_status_change.clone();
        if let Some(sl) = shell_status_listener.as_ref() {
            sl.on_change(SSHConnectionStatus::ShellConnecting);
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
                            for (_, l) in snapshot { l.on_data(buf.clone()); }
                        }
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        if let Ok(cl) = listeners.lock() {
                            let snapshot = cl.clone();
                            let buf = data.to_vec();
                            for (_, l) in snapshot { l.on_data(buf.clone()); }
                        }
                    }
                    Some(ChannelMsg::Close) | None => {
                        if let Some(sl) = shell_listener_for_task.as_ref() {
                            sl.on_change(SSHConnectionStatus::ShellDisconnected);
                        }
                        break;
                    }
                    _ => { /* ignore others */ }
                }
            }
        });

        let session = Arc::new(ShellSession {
            parent: self.self_weak.lock().await.clone(),
            channel_id,
            writer: AsyncMutex::new(writer),
            reader_task,
            shell_status_listener,
            created_at_ms: now_ms(),
            pty,
        });

        *self.shell.lock().await = Some(session.clone());

        // Report ShellConnected.
        if let Some(sl) = session.shell_status_listener.as_ref() {
            sl.on_change(SSHConnectionStatus::ShellConnected);
        }

        Ok(session)
    }

    /// Send bytes to the active shell (stdin).
    pub async fn send_data(&self, data: Vec<u8>) -> Result<(), SshError> {
        let guard = self.shell.lock().await;
        let session = guard.as_ref().ok_or(SshError::Disconnected)?;
        session.send_data(data).await
    }

    /// Close the active shell channel (if any) and stop its reader task.
    pub async fn close_shell(&self) -> Result<(), SshError> {
        if let Some(session) = self.shell.lock().await.take() {
            // Try to close via the session; ignore error.
            let _ = session.close().await;
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

#[uniffi::export(async_runtime = "tokio")]
impl ShellSession {
    pub fn info(&self) -> ShellSessionInfo {
        ShellSessionInfo {
            channel_id: self.channel_id,
            created_at_ms: self.created_at_ms,
            pty: self.pty,
        }
    }
    pub fn channel_id(&self) -> u32 { self.channel_id }
    pub fn created_at_ms(&self) -> f64 { self.created_at_ms }
    pub fn pty(&self) -> PtyType { self.pty }

    /// Send bytes to the active shell (stdin).
    pub async fn send_data(&self, data: Vec<u8>) -> Result<(), SshError> {
        let w = self.writer.lock().await;
        w.data(&data[..]).await?;
        Ok(())
    }

    /// Close the associated shell channel and stop its reader task.
    pub async fn close(&self) -> Result<(), SshError> {
        // Try to close channel gracefully; ignore error.
        self.writer.lock().await.close().await.ok();
        self.reader_task.abort();
        if let Some(sl) = self.shell_status_listener.as_ref() {
            sl.on_change(SSHConnectionStatus::ShellDisconnected);
        }
        // Clear parent's notion of active shell if it matches us.
        if let Some(parent) = self.parent.upgrade() {
            let mut guard = parent.shell.lock().await;
            if let Some(current) = guard.as_ref() {
                if current.channel_id == self.channel_id { *guard = None; }
            }
        }
        Ok(())
    }
}

/// ---------- Top-level API ----------

#[uniffi::export(async_runtime = "tokio")]
pub async fn connect(options: ConnectOptions) -> Result<Arc<SSHConnection>, SshError> {
    let details = ConnectionDetails {
        host: options.host.clone(),
        port: options.port,
        username: options.username.clone(),
        security: options.security.clone(),
    };
    if let Some(sl) = options.on_status_change.as_ref() {
        sl.on_change(SSHConnectionStatus::TcpConnecting);
    }

    // TCP
    let cfg = Arc::new(ClientConfig::default());
    let addr = format!("{}:{}", details.host, details.port);
    let mut handle: ClientHandle<NoopHandler> = client::connect(cfg, addr, NoopHandler).await?;

    if let Some(sl) = options.on_status_change.as_ref() {
        sl.on_change(SSHConnectionStatus::TcpConnected);
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
    let conn = Arc::new(SSHConnection {
        connection_details: details,
        created_at_ms: now,
        tcp_established_at_ms: now,
        handle: AsyncMutex::new(handle),
        shell: AsyncMutex::new(None),
        self_weak: AsyncMutex::new(Weak::new()),
        listeners: Arc::new(Mutex::new(Vec::new())),
        next_listener_id: Arc::new(Mutex::new(0)),
    });
    // Initialize weak self reference.
    *conn.self_weak.lock().await = Arc::downgrade(&conn);
    Ok(conn)
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
