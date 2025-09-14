// lib.rs (or your crate root)

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use std::fmt;


// You must call this once in your crate
uniffi::setup_scaffolding!();

/// ----- Types that mirror your TS schema -----

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum Security {
    Password { password: String },
    Key { key_id: String },
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ConnectionDetails {
    pub host: String,
    pub port: u16, // maps cleanly to JS number
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

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum SshError {
    #[error("The connection is not available.")]
    Disconnected,
    #[error("Unsupported key type.")]
    UnsupportedKeyType,
}

/// Callback for status changes: onStatusChange(status)
#[uniffi::export(with_foreign)]
pub trait StatusListener: Send + Sync {
    fn on_status_change(&self, status: SSHConnectionStatus);
}

/// Data listener: on_data(ArrayBuffer)
#[uniffi::export(with_foreign)]
pub trait DataListener: Send + Sync {
    fn on_data(&self, data: Vec<u8>);
}

/// Key types
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum KeyType {
    Rsa,
    Ecdsa,
    Ed25519,
    Ed448,
}

/// ----- SSHConnection object -----

#[derive(uniffi::Object)]
pub struct SSHConnection {
    connection_details: ConnectionDetails,
    session_id: String,
    created_at_ms: f64,
    established_at_ms: f64,
    listeners: Mutex<Vec<Arc<dyn DataListener>>>,
}

impl fmt::Debug for SSHConnection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SSHConnection")
            .field("connection_details", &self.connection_details)
            .field("session_id", &self.session_id)
            .field("created_at_ms", &self.created_at_ms)
            .field("established_at_ms", &self.established_at_ms)
            // Don’t try to print the trait objects; just show count or omit entirely.
            .field(
                "listeners_len",
                &self.listeners.lock().map(|v| v.len()).unwrap_or(0),
            )
            .finish()
    }
}

#[uniffi::export]
impl SSHConnection {
    // Read-only “properties” via getters (JS sees methods: connectionDetails(), etc.)
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

    /// Register a data listener (no-op storage for now; we keep it so you can emit later)
    pub fn add_data_listener(&self, listener: Arc<dyn DataListener>) {
        let mut vec = self.listeners.lock().unwrap();
        vec.push(listener);
        // If you want to prove it works, you could immediately emit a hello packet:
        // if let Some(last) = vec.last() {
        //     last.on_data(b"hello-from-rust".to_vec());
        // }
    }

    /// Send bytes to the session (dummy async)
    pub async fn send_data(&self, _data: Vec<u8>) -> Result<(), SshError> {
        // No real transport yet; just succeed.
        Ok(())
    }

    /// Disconnect (dummy async)
    pub async fn disconnect(&self) -> Result<(), SshError> {
        // No real transport yet; just succeed.
        Ok(())
    }
}

/// ----- Top-level API surface -----

/// Connect and emit a few status transitions. Returns a ready SSHConnection.
/// Kept async so JS sees a Promise<SSHConnection>.
#[uniffi::export]
pub async fn connect(
    details: ConnectionDetails,
    status_listener: Arc<dyn StatusListener>,
) -> Result<Arc<SSHConnection>, SshError> {
    // Fire a short, synchronous sequence of status updates (no sleeps needed for now)
    status_listener.on_status_change(SSHConnectionStatus::TcpConnecting);
    status_listener.on_status_change(SSHConnectionStatus::TcpConnected);
    status_listener.on_status_change(SSHConnectionStatus::ShellConnecting);
    status_listener.on_status_change(SSHConnectionStatus::ShellConnected);

    let now = now_ms();

    let conn = Arc::new(SSHConnection {
        connection_details: details,
        session_id: "SESSION-STATIC-0001".to_string(),
        created_at_ms: now,
        established_at_ms: now,
        listeners: Mutex::new(Vec::new()),
    });

    Ok(conn)
}

/// Generate a key pair as a PEM string (dummy content)
#[uniffi::export]
pub async fn generate_key_pair(key_type: KeyType) -> Result<String, SshError> {
    let pem = match key_type {
        KeyType::Rsa => "-----BEGIN RSA PRIVATE KEY-----\n...dummy...\n-----END RSA PRIVATE KEY-----",
        KeyType::Ecdsa => "-----BEGIN EC PRIVATE KEY-----\n...dummy...\n-----END EC PRIVATE KEY-----",
        KeyType::Ed25519 => "-----BEGIN OPENSSH PRIVATE KEY-----\n...dummy-ed25519...\n-----END OPENSSH PRIVATE KEY-----",
        KeyType::Ed448 => "-----BEGIN OPENSSH PRIVATE KEY-----\n...dummy-ed448...\n-----END OPENSSH PRIVATE KEY-----",
    };
    Ok(pem.to_string())
}

/// Helper
fn now_ms() -> f64 {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    d.as_millis() as f64
}
