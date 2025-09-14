use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rand::rngs::OsRng;
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex as AsyncMutex;

use russh::{self, client, ChannelMsg, Disconnect};
use russh::client::{Config as ClientConfig, Handle as ClientHandle};
use russh_keys::{Algorithm as KeyAlgorithm, EcdsaCurve, PrivateKey};
use russh_keys::ssh_key::{self, LineEnding};

uniffi::setup_scaffolding!();

/// ---------- Types mirroring your TS shape ----------

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum Security {
    Password { password: String },
    Key { key_id: String }, // left unimplemented in connect() for now
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

#[derive(Debug, Error, uniffi::Error)]
pub enum SshError {
    #[error("Disconnected")]
    Disconnected,

    #[error("Unsupported key type")]
    UnsupportedKeyType,

    #[error("Auth failed: {0}")]
    Auth(String),

    #[error("russh error: {0}")]
    Russh(String),

    #[error("russh-keys error: {0}")]
    RusshKeys(String),
}

// Allow `?` on various fallible calls:
impl From<russh::Error> for SshError {
    fn from(e: russh::Error) -> Self { SshError::Russh(e.to_string()) }
}
impl From<russh_keys::Error> for SshError {
    fn from(e: russh_keys::Error) -> Self { SshError::RusshKeys(e.to_string()) }
}
impl From<ssh_key::Error> for SshError {
    fn from(e: ssh_key::Error) -> Self { SshError::RusshKeys(e.to_string()) }
}
impl From<std::io::Error> for SshError {
    fn from(e: std::io::Error) -> Self { SshError::Russh(e.to_string()) }
}

/// Status callback from Rust -> JS
#[uniffi::export(with_foreign)]
pub trait StatusListener: Send + Sync {
    fn on_status_change(&self, status: SSHConnectionStatus);
}

/// Data callback from Rust -> JS (stdout/stderr chunks unified)
#[uniffi::export(with_foreign)]
pub trait DataListener: Send + Sync {
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

/// ---------- Connection object ----------

#[derive(uniffi::Object)]
pub struct SSHConnection {
    connection_details: ConnectionDetails,
    session_id: String,
    created_at_ms: f64,
    established_at_ms: f64,

    listeners: Mutex<Vec<Arc<dyn DataListener>>>,

    // write side for sending stdin to the shell
    writer: AsyncMutex<russh::ChannelWriteHalf<client::Msg>>,
    // handle is kept so we can call disconnect
    handle: AsyncMutex<ClientHandle<NoopHandler>>,
}

impl fmt::Debug for SSHConnection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let listeners_len = self.listeners.lock().map(|v| v.len()).unwrap_or(0);
        f.debug_struct("SSHConnection")
            .field("connection_details", &self.connection_details)
            .field("session_id", &self.session_id)
            .field("created_at_ms", &self.created_at_ms)
            .field("established_at_ms", &self.established_at_ms)
            .field("listeners_len", &listeners_len)
            .finish()
    }
}

/// Put the UniFFI export attribute on the IMPL BLOCK (not individual methods).
#[uniffi::export(async_runtime = "tokio")]
impl SSHConnection {
    pub fn connection_details(&self) -> ConnectionDetails {
        self.connection_details.clone()
    }
    pub fn session_id(&self) -> String {
        self.session_id.clone()
    }
    pub fn created_at_ms(&self) -> f64 {
        self.created_at_ms
    }
    pub fn established_at_ms(&self) -> f64 {
        self.established_at_ms
    }

    pub fn add_data_listener(&self, listener: Arc<dyn DataListener>) {
        self.listeners.lock().unwrap().push(listener);
    }

    /// Send bytes to the remote shell (stdin).
    pub async fn send_data(&self, data: Vec<u8>) -> Result<(), SshError> {
        // ChannelWriteHalf isn’t AsyncWrite. Use a one-shot writer facade.
        let writer = self.writer.lock().await;
        let mut stream = writer.make_writer();
        stream.write_all(&data).await?;
        stream.flush().await?;
        Ok(())
    }

    /// Graceful disconnect.
    pub async fn disconnect(&self) -> Result<(), SshError> {
        let handle = self.handle.lock().await;
        handle.disconnect(Disconnect::ByApplication, "bye", "").await?;
        Ok(())
    }
}

/// Minimal client::Handler.
struct NoopHandler;
impl client::Handler for NoopHandler {
    type Error = SshError;
    // No overrides needed; defaults are fine.
}

/// ---------- Top-level API ----------

#[uniffi::export(async_runtime = "tokio")]
pub async fn connect(
    details: ConnectionDetails,
    status_listener: Arc<dyn StatusListener>,
) -> Result<Arc<SSHConnection>, SshError> {
    status_listener.on_status_change(SSHConnectionStatus::TcpConnecting);

    // connect(config, addr, handler)
    let cfg = Arc::new(ClientConfig::default());
    let addr = format!("{}:{}", details.host, details.port);
    let mut handle: ClientHandle<NoopHandler> = client::connect(cfg, addr, NoopHandler).await?;

    status_listener.on_status_change(SSHConnectionStatus::TcpConnected);

    // authenticate
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

    status_listener.on_status_change(SSHConnectionStatus::ShellConnecting);

    // open session, request pty, launch shell
    let ch = handle.channel_open_session().await?;
    ch.request_pty(true, "xterm-256color", 80, 24, 0, 0, &[]).await?;
    ch.request_shell(true).await?;

    status_listener.on_status_change(SSHConnectionStatus::ShellConnected);

    // split for read/write
    let (mut reader, writer) = ch.split();

    // build the connection object
    let now = now_ms();
    let conn = Arc::new(SSHConnection {
        connection_details: details.clone(),
        session_id: format!("session-{}", now as u64),
        created_at_ms: now,
        established_at_ms: now,
        listeners: Mutex::new(Vec::new()),
        writer: AsyncMutex::new(writer),
        handle: AsyncMutex::new(handle),
    });

    // background read loop: forward stdout/stderr chunks
    let weak = Arc::downgrade(&conn);
    tokio::spawn(async move {
        loop {
            match reader.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    if let Some(conn) = weak.upgrade() {
                        let listeners = conn.listeners.lock().unwrap().clone();
                        let buf = data.to_vec();
                        for l in listeners { l.on_data(buf.clone()); }
                    } else { break; }
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    if let Some(conn) = weak.upgrade() {
                        let listeners = conn.listeners.lock().unwrap().clone();
                        let buf = data.to_vec();
                        for l in listeners { l.on_data(buf.clone()); }
                    } else { break; }
                }
                Some(ChannelMsg::ExitStatus { .. }) => {
                    // Optionally store/report exit status here.
                }
                Some(ChannelMsg::Close) | None => {
                    if let Some(_conn) = weak.upgrade() {
                        status_listener.on_status_change(SSHConnectionStatus::ShellDisconnected);
                        status_listener.on_status_change(SSHConnectionStatus::TcpDisconnected);
                    }
                    break;
                }
                _ => { /* ignore others for now */ }
            }
        }
    });

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

    // OpenSSH PEM, LF endings; returns Zeroizing<String>
    let pem = key.to_openssh(LineEnding::LF)?;
    Ok(pem.to_string())
}

fn now_ms() -> f64 {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    d.as_millis() as f64
}
