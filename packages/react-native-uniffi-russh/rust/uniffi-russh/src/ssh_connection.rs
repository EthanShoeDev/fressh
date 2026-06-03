use std::fmt;
use std::future::Future;
use std::sync::{Arc, Weak};
use std::time::Duration;

use tokio::sync::{broadcast, Mutex as AsyncMutex};

use russh::client::{Config, Handle as ClientHandle};
use russh::keys::PrivateKeyWithHashAlg;
use russh::{self, client, ChannelMsg, Disconnect};

use crate::private_key::normalize_openssh_ed25519_seed_key;
use crate::ssh_channel::StartupChannelCloseGuard;
use crate::ssh_command::{
    CommandOutput, CommandStreamSession, RunCommandOptions, StartCommandStreamOptions,
};
use crate::ssh_shell::{
    append_and_broadcast, emit_shell_closed_once, Chunk, ShellSession, ShellSessionInfo,
    StartShellOptions, StreamKind, DEFAULT_BROADCAST_CHUNK_CAPACITY, DEFAULT_MAX_CHUNK_SIZE,
    DEFAULT_SHELL_RING_BUFFER_CAPACITY, DEFAULT_TERMINAL_MODES, DEFAULT_TERM_COALESCE_MS,
    DEFAULT_TERM_COL_WIDTH, DEFAULT_TERM_PIXEL_HEIGHT, DEFAULT_TERM_PIXEL_WIDTH,
    DEFAULT_TERM_ROW_HEIGHT,
};
use crate::utils::{
    catch_foreign_callback_future_unwind, catch_foreign_callback_unwind, now_ms, SshError,
    CLOSE_TIMEOUT,
};
use russh::keys::PublicKeyBase64;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering as AtomicOrdering};

use std::{
    collections::HashMap,
    sync::{atomic::AtomicU64, Mutex},
};

// Mobile-friendly keepalive defaults.
const KEEPALIVE_INTERVAL_SECS: u64 = 15;
const KEEPALIVE_MAX: usize = 6;
// Short probe window to catch immediate Workmux attach failures.
const TMUX_ATTACH_PROBE_TIMEOUT_MS: u64 = 300;
const SHELL_REQUEST_REPLY_TIMEOUT: Duration = Duration::from_secs(5);

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn build_workmux_attach_command(session_name: &str) -> String {
    format!("mdev tmux attach {}", shell_quote(session_name))
}

enum WorkmuxAttachProbeDecision {
    Continue,
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellRequestDecision {
    Continue,
    Success,
    Failure,
    ClosedBeforeSuccess,
}

fn classify_workmux_attach_probe_message(message: &ChannelMsg) -> WorkmuxAttachProbeDecision {
    match message {
        ChannelMsg::ExitStatus { exit_status } if *exit_status != 0 => {
            WorkmuxAttachProbeDecision::Failed(format!(
                "Workmux attach exited with status {exit_status}"
            ))
        }
        ChannelMsg::ExitSignal { signal_name, .. } => WorkmuxAttachProbeDecision::Failed(format!(
            "Workmux attach exited with signal {signal_name:?}"
        )),
        ChannelMsg::Eof | ChannelMsg::Close => {
            WorkmuxAttachProbeDecision::Failed("Workmux attach closed the channel".to_string())
        }
        _ => WorkmuxAttachProbeDecision::Continue,
    }
}

async fn open_shell_session(
    connection: &SshConnection,
) -> Result<russh::Channel<client::Msg>, SshError> {
    match tokio::time::timeout(SHELL_REQUEST_REPLY_TIMEOUT, async {
        let client_handle = connection.client_handle.lock().await;
        client_handle.channel_open_session().await
    })
    .await
    {
        Ok(Ok(channel)) => Ok(channel),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => {
            connection.disconnect().await.ok();
            Err(SshError::Russh(
                "SSH shell channel open timed out".to_string(),
            ))
        }
    }
}

async fn wait_for_shell_request_send<F, E>(request_name: &str, request: F) -> Result<(), SshError>
where
    F: Future<Output = Result<(), E>>,
    E: Into<SshError>,
{
    match tokio::time::timeout(SHELL_REQUEST_REPLY_TIMEOUT, request).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => Err(SshError::Russh(format!(
            "SSH {request_name} request send timed out"
        ))),
    }
}

async fn wait_for_shell_request_success(
    channel: &mut russh::Channel<client::Msg>,
    request_name: &str,
) -> Result<(), SshError> {
    let deadline = tokio::time::Instant::now() + SHELL_REQUEST_REPLY_TIMEOUT;
    loop {
        let message = match tokio::time::timeout_at(deadline, channel.wait()).await {
            Ok(Some(message)) => message,
            Ok(None) => {
                return Err(SshError::Russh(format!(
                    "SSH {request_name} request closed before success"
                )));
            }
            Err(_) => {
                return Err(SshError::Russh(format!(
                    "SSH {request_name} request timed out before success"
                )));
            }
        };

        match classify_shell_request_message(&message) {
            ShellRequestDecision::Continue => {}
            ShellRequestDecision::Success => return Ok(()),
            ShellRequestDecision::Failure => {
                return Err(SshError::Russh(format!(
                    "SSH {request_name} request failed"
                )));
            }
            ShellRequestDecision::ClosedBeforeSuccess => {
                return Err(SshError::Russh(format!(
                    "SSH {request_name} request closed before success"
                )));
            }
        }
    }
}

fn classify_shell_request_message(message: &ChannelMsg) -> ShellRequestDecision {
    match message {
        ChannelMsg::Success => ShellRequestDecision::Success,
        ChannelMsg::Failure => ShellRequestDecision::Failure,
        ChannelMsg::Close | ChannelMsg::Eof => ShellRequestDecision::ClosedBeforeSuccess,
        _ => ShellRequestDecision::Continue,
    }
}

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

fn emit_connection_progress(
    callback: &Arc<dyn ConnectProgressCallback>,
    status: SshConnectionProgressEvent,
) -> bool {
    catch_foreign_callback_unwind(|| callback.on_change(status))
}

#[uniffi::export(with_foreign)]
pub trait ConnectionDisconnectedCallback: Send + Sync {
    fn on_change(&self, connection_id: String);
}

fn emit_connection_disconnected(
    callback: &Arc<dyn ConnectionDisconnectedCallback>,
    connection_id: String,
) -> bool {
    catch_foreign_callback_unwind(|| callback.on_change(connection_id))
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
            let accept = catch_foreign_callback_future_unwind(cb.on_change(info))
                .await
                .unwrap_or(false);
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
    pub(crate) command_streams: AsyncMutex<HashMap<u32, Weak<CommandStreamSession>>>,

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
        let use_tmux = opts.use_tmux;
        let tmux_session_name = opts.tmux_session_name.clone();

        let channel = open_shell_session(self).await?;
        let mut channel_guard = StartupChannelCloseGuard::new(channel);
        let channel_id: u32 = channel_guard.channel().id().into();

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

        wait_for_shell_request_send(
            "PTY",
            channel_guard.channel().request_pty(
                true,
                term.as_ssh_name(),
                col_width,
                row_height,
                pixel_width,
                pixel_height,
                &modes,
            ),
        )
        .await?;
        wait_for_shell_request_success(channel_guard.channel_mut(), "PTY").await?;

        if use_tmux {
            let tmux_name = tmux_session_name
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_string();
            if tmux_name.is_empty() {
                self.disconnect().await.ok();
                return Err(SshError::TmuxAttachFailed(
                    "Missing Workmux session name".to_string(),
                ));
            }
            let cmd = build_workmux_attach_command(&tmux_name);
            wait_for_shell_request_send("exec", channel_guard.channel().exec(true, cmd)).await?;
            wait_for_shell_request_success(channel_guard.channel_mut(), "exec").await?;
        } else {
            wait_for_shell_request_send("shell", channel_guard.channel().request_shell(true))
                .await?;
            wait_for_shell_request_success(channel_guard.channel_mut(), "shell").await?;
        }

        // Split for read/write; spawn reader.
        let channel = channel_guard.into_inner();
        let (mut reader, writer) = channel.split();

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
        let parent = self.self_weak.lock().await.clone();
        let parent_for_reader = parent.clone();
        let reader_has_closed = Arc::new(AtomicBool::new(false));
        let reader_has_closed_for_reader = reader_has_closed.clone();
        let closed_notified = Arc::new(AtomicBool::new(false));
        let closed_notified_for_reader = closed_notified.clone();

        if use_tmux {
            let probe_deadline =
                tokio::time::Instant::now() + Duration::from_millis(TMUX_ATTACH_PROBE_TIMEOUT_MS);
            loop {
                let probe = tokio::time::timeout_at(probe_deadline, reader.wait()).await;
                let Some(message) = (match probe {
                    Ok(message) => message,
                    Err(_) => break,
                }) else {
                    self.disconnect().await.ok();
                    return Err(SshError::TmuxAttachFailed(
                        "Workmux attach closed the channel".to_string(),
                    ));
                };

                if let WorkmuxAttachProbeDecision::Failed(message) =
                    classify_workmux_attach_probe_message(&message)
                {
                    self.disconnect().await.ok();
                    return Err(SshError::TmuxAttachFailed(message));
                }

                match message {
                    ChannelMsg::Data { data } => {
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
                            DEFAULT_MAX_CHUNK_SIZE,
                        );
                    }
                    ChannelMsg::ExtendedData { data, .. } => {
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
                            DEFAULT_MAX_CHUNK_SIZE,
                        );
                    }
                    _ => {}
                }
            }
        }

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
                        reader_has_closed_for_reader.store(true, AtomicOrdering::Release);
                        emit_shell_closed_once(
                            on_closed_callback_for_reader.as_ref(),
                            channel_id,
                            &closed_notified_for_reader,
                        );
                        if let Some(parent) = parent_for_reader.upgrade() {
                            parent.shells.lock().await.remove(&channel_id);
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
            parent,

            writer: AsyncMutex::new(writer),
            reader_task,
            closed_notified,

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

        let mut shells = self.shells.lock().await;
        shells.insert(channel_id, session.clone());
        // The reader can observe a fast remote close before this insertion
        // happens. Remove the just-inserted session if that close already won.
        if reader_has_closed.load(AtomicOrdering::Acquire) {
            shells.remove(&channel_id);
        }

        Ok(session)
    }

    pub async fn run_command(&self, opts: RunCommandOptions) -> Result<CommandOutput, SshError> {
        crate::ssh_command::run_command(self, opts).await
    }

    pub async fn start_command_stream(
        &self,
        opts: StartCommandStreamOptions,
    ) -> Result<Arc<CommandStreamSession>, SshError> {
        crate::ssh_command::start_command_stream(self, opts).await
    }

    pub async fn disconnect(&self) -> Result<(), SshError> {
        let mut first_error = None;

        let cleanup_result = tokio::time::timeout(CLOSE_TIMEOUT, async {
            let sessions: Vec<Arc<ShellSession>> = {
                let map = self.shells.lock().await;
                map.values().cloned().collect()
            };
            for s in sessions {
                s.close().await.ok();
            }

            let command_streams: Vec<Arc<CommandStreamSession>> = {
                let map = self.command_streams.lock().await;
                map.values().filter_map(Weak::upgrade).collect()
            };
            for stream in command_streams {
                stream.close().await.ok();
            }
        })
        .await;
        cleanup_result.ok();

        let on_disconnected_callback = self.on_disconnected_callback.clone();
        let connection_id = self.info.connection_id.clone();
        let disconnect_result = tokio::time::timeout(CLOSE_TIMEOUT, async {
            let h = self.client_handle.lock().await;
            h.disconnect(Disconnect::ByApplication, "bye", "").await
        })
        .await;
        match disconnect_result {
            Ok(Ok(())) => {
                if let Some(on_disconnected_callback) = on_disconnected_callback.as_ref() {
                    emit_connection_disconnected(on_disconnected_callback, connection_id);
                }
            }
            Ok(Err(error)) => {
                first_error.get_or_insert(error.into());
            }
            Err(_) => {
                first_error.get_or_insert(SshError::Russh("SSH disconnect timed out".to_string()));
            }
        }

        if let Some(error) = first_error {
            return Err(error);
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
        emit_connection_progress(sl, SshConnectionProgressEvent::TcpConnected);
    }
    let mut cfg = Config::default();
    cfg.keepalive_interval = Some(Duration::from_secs(KEEPALIVE_INTERVAL_SECS));
    cfg.keepalive_max = KEEPALIVE_MAX;
    let cfg = Arc::new(cfg);
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
        emit_connection_progress(sl, SshConnectionProgressEvent::SshHandshake);
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
        command_streams: AsyncMutex::new(HashMap::new()),
        self_weak: AsyncMutex::new(Weak::new()),
        on_disconnected_callback: options.on_disconnected_callback.clone(),
    });
    // Initialize weak self reference.
    *conn.self_weak.lock().await = Arc::downgrade(&conn);
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::CryptoVec;

    struct PanickingProgressCallback;

    impl ConnectProgressCallback for PanickingProgressCallback {
        fn on_change(&self, _status: SshConnectionProgressEvent) {
            panic!("callback panic");
        }
    }

    struct PanickingDisconnectedCallback;

    impl ConnectionDisconnectedCallback for PanickingDisconnectedCallback {
        fn on_change(&self, _connection_id: String) {
            panic!("callback panic");
        }
    }

    struct PanickingServerKeyCallback;

    #[async_trait::async_trait]
    impl ServerKeyCallback for PanickingServerKeyCallback {
        async fn on_change(&self, _server_key_info: ServerPublicKeyInfo) -> bool {
            panic!("callback panic");
        }
    }

    #[test]
    fn emit_connection_disconnected_catches_callback_panic() {
        let callback: Arc<dyn ConnectionDisconnectedCallback> =
            Arc::new(PanickingDisconnectedCallback);

        assert!(!emit_connection_disconnected(
            &callback,
            "connection-1".to_string()
        ));
    }

    #[test]
    fn emit_connection_progress_catches_callback_panic() {
        let callback: Arc<dyn ConnectProgressCallback> = Arc::new(PanickingProgressCallback);

        assert!(!emit_connection_progress(
            &callback,
            SshConnectionProgressEvent::TcpConnected
        ));
    }

    #[tokio::test]
    async fn check_server_key_treats_callback_panic_as_reject() {
        let valid_key = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACC7PhmC0yS0Q8LcUkRnoYCxpb4gkCjJhadvvf+TDlRBJwAAAKCX5GEsl+Rh
LAAAAAtzc2gtZWQyNTUxOQAAACC7PhmC0yS0Q8LcUkRnoYCxpb4gkCjJhadvvf+TDlRBJw
AAAEBmrg8TL0+2xypHjVpFeuQmgQf3Qn/A45Jz+zCwVgoBt7s+GYLTJLRDwtxSRGehgLGl
viCQKMmFp2+9/5MOVEEnAAAAF3Rlc3QtZWQyNTUxOUBmcmVzc2guY29tAQIDBAUG
-----END OPENSSH PRIVATE KEY-----
";
        let (_canonical, parsed) = normalize_openssh_ed25519_seed_key(valid_key).unwrap();
        let public_key = parsed.public_key().clone();
        let mut handler = NoopHandler {
            on_server_key_callback: Arc::new(PanickingServerKeyCallback),
            host: "example.test".to_string(),
            port: 22,
            remote_ip: None,
        };

        let accepted =
            <NoopHandler as client::Handler>::check_server_key(&mut handler, &public_key)
                .await
                .unwrap();

        assert!(!accepted);
    }

    #[test]
    fn shell_request_message_classifies_replies() {
        assert_eq!(
            classify_shell_request_message(&ChannelMsg::Success),
            ShellRequestDecision::Success
        );
        assert_eq!(
            classify_shell_request_message(&ChannelMsg::Failure),
            ShellRequestDecision::Failure
        );
        assert_eq!(
            classify_shell_request_message(&ChannelMsg::Close),
            ShellRequestDecision::ClosedBeforeSuccess
        );
        assert_eq!(
            classify_shell_request_message(&ChannelMsg::Eof),
            ShellRequestDecision::ClosedBeforeSuccess
        );
        assert_eq!(
            classify_shell_request_message(&ChannelMsg::Data {
                data: CryptoVec::from_slice(b"pending"),
            }),
            ShellRequestDecision::Continue
        );
    }

    #[test]
    fn workmux_attach_command_uses_mdev_tmux_attach() {
        assert_eq!(
            build_workmux_attach_command("main"),
            "mdev tmux attach 'main'"
        );
    }

    #[test]
    fn workmux_attach_command_shell_quotes_session_names() {
        assert_eq!(
            build_workmux_attach_command("main's work"),
            "mdev tmux attach 'main'\\''s work'"
        );
    }

    #[test]
    fn workmux_attach_probe_continues_after_output_messages() {
        let stdout = ChannelMsg::Data {
            data: CryptoVec::from_slice(b"starting"),
        };
        let stderr = ChannelMsg::ExtendedData {
            data: CryptoVec::from_slice(b"missing session"),
            ext: 1,
        };

        assert!(matches!(
            classify_workmux_attach_probe_message(&stdout),
            WorkmuxAttachProbeDecision::Continue
        ));
        assert!(matches!(
            classify_workmux_attach_probe_message(&stderr),
            WorkmuxAttachProbeDecision::Continue
        ));
    }

    #[test]
    fn workmux_attach_probe_fails_on_nonzero_exit_after_output() {
        let output = ChannelMsg::ExtendedData {
            data: CryptoVec::from_slice(b"missing session"),
            ext: 1,
        };
        let exit = ChannelMsg::ExitStatus { exit_status: 1 };

        assert!(matches!(
            classify_workmux_attach_probe_message(&output),
            WorkmuxAttachProbeDecision::Continue
        ));
        match classify_workmux_attach_probe_message(&exit) {
            WorkmuxAttachProbeDecision::Failed(message) => {
                assert_eq!(message, "Workmux attach exited with status 1");
            }
            WorkmuxAttachProbeDecision::Continue => panic!("expected failure"),
        }
    }

    #[test]
    fn workmux_attach_probe_fails_on_channel_end() {
        match classify_workmux_attach_probe_message(&ChannelMsg::Eof) {
            WorkmuxAttachProbeDecision::Failed(message) => {
                assert_eq!(message, "Workmux attach closed the channel");
            }
            WorkmuxAttachProbeDecision::Continue => panic!("expected failure"),
        }
        match classify_workmux_attach_probe_message(&ChannelMsg::Close) {
            WorkmuxAttachProbeDecision::Failed(message) => {
                assert_eq!(message, "Workmux attach closed the channel");
            }
            WorkmuxAttachProbeDecision::Continue => panic!("expected failure"),
        }
    }
}
