use std::fmt;
use std::sync::{Arc, Weak};

use tokio::sync::{broadcast, Mutex as AsyncMutex};

use russh::client::{Config, Handle as ClientHandle};
use russh::keys::PrivateKeyWithHashAlg;
use russh::{self, client, ChannelMsg, Disconnect};

use crate::private_key::normalize_openssh_ed25519_seed_key;
use crate::ssh_shell::{
    append_and_broadcast, Chunk, ShellSession, ShellSessionInfo, StartShellOptions, StreamKind,
    DEFAULT_BROADCAST_CHUNK_CAPACITY, DEFAULT_MAX_CHUNK_SIZE, DEFAULT_SHELL_RING_BUFFER_CAPACITY,
    DEFAULT_TERMINAL_MODES, DEFAULT_TERM_COALESCE_MS, DEFAULT_TERM_COL_WIDTH,
    DEFAULT_TERM_PIXEL_HEIGHT, DEFAULT_TERM_PIXEL_WIDTH, DEFAULT_TERM_ROW_HEIGHT,
};
use crate::utils::{now_ms, SshError};
use russh::keys::PublicKeyBase64;
use std::sync::atomic::AtomicUsize;

use std::{
    collections::HashMap,
    sync::{atomic::AtomicU64, Mutex},
};

fn server_public_key_to_info(
    host: &str,
    port: u16,
    remote_ip: Option<String>,
    pk: &russh::keys::PublicKey,
) -> ServerPublicKeyInfo {
    // Algorithm identifier (e.g., "ssh-ed25519", "rsa-sha2-512")
    let algorithm = pk.algorithm().to_string();

    // Key blob (base64)
    let key_base64 = pk.public_key_base64();

    // Fingerprints via russh-keys/ssh-key helpers
    let fingerprint_sha256 = format!("{}", pk.fingerprint(russh::keys::ssh_key::HashAlg::Sha256));

    ServerPublicKeyInfo {
        host: host.to_string(),
        port,
        remote_ip,
        algorithm,
        fingerprint_sha256,
        key_base64,
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum Security {
    Password { password: String },
    Key { private_key_content: String }, // (key-based auth can be wired later)
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ConnectionDetails {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub security: Security,
}

#[derive(Clone, uniffi::Record)]
pub struct ConnectOptions {
    pub connection_details: ConnectionDetails,
    pub on_connection_progress_callback: Option<Arc<dyn ConnectProgressCallback>>,
    pub on_disconnected_callback: Option<Arc<dyn ConnectionDisconnectedCallback>>,
    pub on_server_key_callback: Arc<dyn ServerKeyCallback>,
}

#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum SshConnectionProgressEvent {
    // Before any progress events, assume: TcpConnecting
    TcpConnected,
    SshHandshake,
    // If promise has not resolved, assume: Authenticating
    // After promise resolves, assume: Connected
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SshConnectionInfoProgressTimings {
    // TODO: We should have a field for each SshConnectionProgressEvent. Would be great if this were enforced by the compiler.
    pub tcp_established_at_ms: f64,
    pub ssh_handshake_at_ms: f64,
}

#[uniffi::export(with_foreign)]
pub trait ConnectProgressCallback: Send + Sync {
    fn on_change(&self, status: SshConnectionProgressEvent);
}

#[uniffi::export(with_foreign)]
pub trait ConnectionDisconnectedCallback: Send + Sync {
    fn on_change(&self, connection_id: String);
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ServerPublicKeyInfo {
    pub host: String,
    pub port: u16,
    pub remote_ip: Option<String>,
    pub algorithm: String,
    pub fingerprint_sha256: String, // e.g., "SHA256:..." (no padding)
    pub key_base64: String,         // raw key blob (base64)
}

#[uniffi::export(with_foreign)]
#[async_trait::async_trait]
pub trait ServerKeyCallback: Send + Sync {
    async fn on_change(&self, server_key_info: ServerPublicKeyInfo) -> bool;
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SshConnectionInfo {
    pub connection_id: String,
    pub connection_details: ConnectionDetails,
    pub created_at_ms: f64,
    pub connected_at_ms: f64,
    pub progress_timings: SshConnectionInfoProgressTimings,
}

/// Minimal client::Handler with optional server key callback.
pub(crate) struct NoopHandler {
    pub on_server_key_callback: Arc<dyn ServerKeyCallback>,
    pub host: String,
    pub port: u16,
    pub remote_ip: Option<String>,
}
impl client::Handler for NoopHandler {
    type Error = SshError;
    fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> impl std::future::Future<
        Output = std::result::Result<bool, <Self as russh::client::Handler>::Error>,
    > + std::marker::Send {
        let cb = self.on_server_key_callback.clone();
        let host = self.host.clone();
        let port = self.port;
        let remote_ip = self.remote_ip.clone();
        // Build structured info for UI/decision.
        let info = server_public_key_to_info(&host, port, remote_ip, server_public_key);
        async move {
            // Delegate decision to user callback (async via UniFFI).
            let accept = cb.on_change(info).await;
            Ok(accept)
        }
    }
}

#[derive(uniffi::Object)]
pub struct SshConnection {
    pub info: SshConnectionInfo,
    pub on_disconnected_callback: Option<Arc<dyn ConnectionDisconnectedCallback>>,

    pub(crate) client_handle: AsyncMutex<ClientHandle<NoopHandler>>,

    pub(crate) shells: AsyncMutex<HashMap<u32, Arc<ShellSession>>>,

    // Weak self for child sessions to refer back without cycles.
    pub(crate) self_weak: AsyncMutex<Weak<SshConnection>>,
}

impl fmt::Debug for SshConnection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SshConnectionHandle")
            .field("info.connection_details", &self.info.connection_details)
            .field("info.created_at_ms", &self.info.created_at_ms)
            .field("info.connected_at_ms", &self.info.connected_at_ms)
            .finish()
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl SshConnection {
    /// Convenience snapshot for property-like access in TS.
    pub fn get_info(&self) -> SshConnectionInfo {
        self.info.clone()
    }

    pub async fn start_shell(
        &self,
        opts: StartShellOptions,
    ) -> Result<Arc<ShellSession>, SshError> {
        let started_at_ms = now_ms();

        let term = opts.term;
        let on_closed_callback = opts.on_closed_callback.clone();

        let client_handle = self.client_handle.lock().await;

        let ch = client_handle.channel_open_session().await?;
        let channel_id: u32 = ch.id().into();

        let mut modes: Vec<(russh::Pty, u32)> = DEFAULT_TERMINAL_MODES.to_vec();
        if let Some(terminal_mode_params) = &opts.terminal_mode {
            for m in terminal_mode_params {
                if let Some(pty) = russh::Pty::from_u8(m.opcode) {
                    if let Some(pos) = modes.iter().position(|(p, _)| *p as u8 == m.opcode) {
                        modes[pos].1 = m.value; // override
                    } else {
                        modes.push((pty, m.value)); // add
                    }
                }
            }
        }

        let row_height = opts
            .terminal_size
            .as_ref()
            .and_then(|s| s.row_height)
            .unwrap_or(DEFAULT_TERM_ROW_HEIGHT);
        let col_width = opts
            .terminal_size
            .as_ref()
            .and_then(|s| s.col_width)
            .unwrap_or(DEFAULT_TERM_COL_WIDTH);
        let pixel_width = opts
            .terminal_pixel_size
            .as_ref()
            .and_then(|s| s.pixel_width)
            .unwrap_or(DEFAULT_TERM_PIXEL_WIDTH);
        let pixel_height = opts
            .terminal_pixel_size
            .as_ref()
            .and_then(|s| s.pixel_height)
            .unwrap_or(DEFAULT_TERM_PIXEL_HEIGHT);

        ch.request_pty(
            true,
            term.as_ssh_name(),
            col_width,
            row_height,
            pixel_width,
            pixel_height,
            &modes,
        )
        .await?;
        ch.request_shell(true).await?;

        // Split for read/write; spawn reader.
        let (mut reader, writer) = ch.split();

        // Setup ring + broadcast for this session
        let (tx, _rx) = broadcast::channel::<Arc<Chunk>>(DEFAULT_BROADCAST_CHUNK_CAPACITY);
        let ring = Arc::new(Mutex::new(std::collections::VecDeque::<Arc<Chunk>>::new()));
        let used_bytes = Arc::new(Mutex::new(0usize));
        let next_seq = Arc::new(AtomicU64::new(1));
        let head_seq = Arc::new(AtomicU64::new(1));
        let tail_seq = Arc::new(AtomicU64::new(0));
        let dropped_bytes_total = Arc::new(AtomicU64::new(0));
        let ring_bytes_capacity = Arc::new(AtomicUsize::new(DEFAULT_SHELL_RING_BUFFER_CAPACITY));
        let default_coalesce_ms = AtomicU64::new(DEFAULT_TERM_COALESCE_MS);

        let ring_clone = ring.clone();
        let used_bytes_clone = used_bytes.clone();
        let tx_clone = tx.clone();
        let ring_bytes_capacity_c = ring_bytes_capacity.clone();
        let dropped_bytes_total_c = dropped_bytes_total.clone();
        let head_seq_c = head_seq.clone();
        let tail_seq_c = tail_seq.clone();
        let next_seq_c = next_seq.clone();

        let on_closed_callback_for_reader = on_closed_callback.clone();

        let reader_task = tokio::spawn(async move {
            let max_chunk = DEFAULT_MAX_CHUNK_SIZE;
            loop {
                match reader.wait().await {
                    Some(ChannelMsg::Data { data }) => {
                        append_and_broadcast(
                            &data,
                            StreamKind::Stdout,
                            &ring_clone,
                            &used_bytes_clone,
                            &ring_bytes_capacity_c,
                            &dropped_bytes_total_c,
                            &head_seq_c,
                            &tail_seq_c,
                            &next_seq_c,
                            &tx_clone,
                            max_chunk,
                        );
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        append_and_broadcast(
                            &data,
                            StreamKind::Stderr,
                            &ring_clone,
                            &used_bytes_clone,
                            &ring_bytes_capacity_c,
                            &dropped_bytes_total_c,
                            &head_seq_c,
                            &tail_seq_c,
                            &next_seq_c,
                            &tx_clone,
                            max_chunk,
                        );
                    }
                    Some(ChannelMsg::Close) | None => {
                        if let Some(sl) = on_closed_callback_for_reader.as_ref() {
                            sl.on_change(channel_id);
                        }
                        break;
                    }
                    _ => {}
                }
            }
        });

        let session = Arc::new(ShellSession {
            info: ShellSessionInfo {
                channel_id,
                created_at_ms: started_at_ms,
                connected_at_ms: now_ms(),
                term,
                connection_id: self.info.connection_id.clone(),
            },
            on_closed_callback,
            parent: self.self_weak.lock().await.clone(),

            writer: AsyncMutex::new(writer),
            reader_task,

            // Ring buffer
            ring,
            ring_bytes_capacity,
            used_bytes,
            dropped_bytes_total,
            head_seq,
            tail_seq,

            // Listener tasks management
            sender: tx,
            listener_tasks: Arc::new(Mutex::new(HashMap::new())),
            next_listener_id: AtomicU64::new(1),
            coalesce_ms: default_coalesce_ms,
            rt_handle: tokio::runtime::Handle::current(),
        });

        self.shells.lock().await.insert(channel_id, session.clone());

        Ok(session)
    }

    pub async fn disconnect(&self) -> Result<(), SshError> {
        // TODO: Check if we need to close all these if we are about to disconnect?
        let sessions: Vec<Arc<ShellSession>> = {
            let map = self.shells.lock().await;
            map.values().cloned().collect()
        };
        for s in sessions {
            s.close().await?;
        }

        let h = self.client_handle.lock().await;
        h.disconnect(Disconnect::ByApplication, "bye", "").await?;

        if let Some(on_disconnected_callback) = self.on_disconnected_callback.as_ref() {
            on_disconnected_callback.on_change(self.info.connection_id.clone());
        }

        Ok(())
    }
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn connect(options: ConnectOptions) -> Result<Arc<SshConnection>, SshError> {
    let started_at_ms = now_ms();
    let details = ConnectionDetails {
        host: options.connection_details.host.clone(),
        port: options.connection_details.port,
        username: options.connection_details.username.clone(),
        security: options.connection_details.security.clone(),
    };

    // TCP
    let addr = format!("{}:{}", details.host, details.port);
    let socket = tokio::net::TcpStream::connect(&addr).await?;
    let local_port = socket.local_addr()?.port();

    let tcp_established_at_ms = now_ms();
    if let Some(sl) = options.on_connection_progress_callback.as_ref() {
        sl.on_change(SshConnectionProgressEvent::TcpConnected);
    }
    let cfg = Arc::new(Config::default());
    let remote_ip = socket.peer_addr().ok().map(|a| a.ip().to_string());
    let mut handle: ClientHandle<NoopHandler> = russh::client::connect_stream(
        cfg,
        socket,
        NoopHandler {
            on_server_key_callback: options.on_server_key_callback.clone(),
            host: options.connection_details.host.clone(),
            port: options.connection_details.port,
            remote_ip,
        },
    )
    .await?;
    let ssh_handshake_at_ms = now_ms();
    if let Some(sl) = options.on_connection_progress_callback.as_ref() {
        sl.on_change(SshConnectionProgressEvent::SshHandshake);
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
            // Normalize and parse using shared helper so RN-validated keys match runtime parsing.
            let (_canonical, parsed) = normalize_openssh_ed25519_seed_key(private_key_content)?;
            let pk_with_hash = PrivateKeyWithHashAlg::new(Arc::new(parsed), None);
            handle
                .authenticate_publickey(details.username.clone(), pk_with_hash)
                .await?
        }
    };
    if !matches!(auth_result, russh::client::AuthResult::Success) {
        return Err(auth_result.into());
    }

    let connection_id = format!(
        "{}@{}:{}:{}",
        details.username, details.host, details.port, local_port
    );
    let conn = Arc::new(SshConnection {
        info: SshConnectionInfo {
            connection_id,
            connection_details: details,
            created_at_ms: started_at_ms,
            connected_at_ms: now_ms(),
            progress_timings: SshConnectionInfoProgressTimings {
                tcp_established_at_ms,
                ssh_handshake_at_ms,
            },
        },
        client_handle: AsyncMutex::new(handle),
        shells: AsyncMutex::new(HashMap::new()),
        self_weak: AsyncMutex::new(Weak::new()),
        on_disconnected_callback: options.on_disconnected_callback.clone(),
    });
    // Initialize weak self reference.
    *conn.self_weak.lock().await = Arc::downgrade(&conn);
    Ok(conn)
}
