//! This file is used to generate Typescript bindings for the Russh library.
//!
//! For more information on the available data types, see the following links:
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/common-types.html
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/async-callbacks.html

use std::collections::HashMap;
use std::fmt;
use std::sync::{atomic::{AtomicU64, AtomicUsize, Ordering}, Arc, Mutex, Weak};
use std::time::{SystemTime, UNIX_EPOCH, Duration};

use rand::rngs::OsRng;
use thiserror::Error;
use tokio::sync::{broadcast, Mutex as AsyncMutex};

use russh::{self, client, ChannelMsg, Disconnect};
use russh::client::{Config as ClientConfig, Handle as ClientHandle};
use russh_keys::{Algorithm as KeyAlgorithm, EcdsaCurve, PrivateKey};
use russh_keys::ssh_key::{self, LineEnding};
use bytes::Bytes;

uniffi::setup_scaffolding!();

// No global registries; handles are the only access points.

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

// Stream kind for terminal output
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum StreamKind { Stdout, Stderr }

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct TerminalChunk {
    pub seq: u64,
    pub t_ms: f64,
    pub stream: StreamKind,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DroppedRange { pub from_seq: u64, pub to_seq: u64 }

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum ShellEvent {
    Chunk(TerminalChunk),
    Dropped { from_seq: u64, to_seq: u64 },
}

#[uniffi::export(with_foreign)]
pub trait ShellListener: Send + Sync {
    fn on_event(&self, ev: ShellEvent);
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

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum Cursor {
    Head,
    TailBytes { bytes: u64 },
    Seq { seq: u64 },
    TimeMs { t_ms: f64 },
    Live,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ListenerOptions {
    pub cursor: Cursor,
    pub coalesce_ms: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct BufferReadResult {
    pub chunks: Vec<TerminalChunk>,
    pub next_seq: u64,
    pub dropped: Option<DroppedRange>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct BufferStats {
    pub ring_bytes: u64,
    pub used_bytes: u64,
    pub chunks: u64,
    pub head_seq: u64,
    pub tail_seq: u64,
    pub dropped_bytes_total: u64,
}

/// Snapshot of current connection info for property-like access in TS.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SshConnectionInfo {
    pub connection_id: String,
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
    pub connection_id: String,
}

/// ---------- Connection object (no shell until start_shell) ----------

#[derive(uniffi::Object)]
pub struct SSHConnection {
    connection_id: String,
    connection_details: ConnectionDetails,
    created_at_ms: f64,
    tcp_established_at_ms: f64,

    handle: AsyncMutex<ClientHandle<NoopHandler>>,

    // Shell state (one active shell per connection by design).
    shell: AsyncMutex<Option<Arc<ShellSession>>>,

    // Weak self for child sessions to refer back without cycles.
    self_weak: AsyncMutex<Weak<SSHConnection>>,
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

    // Ring buffer
    ring: Arc<Mutex<std::collections::VecDeque<Arc<Chunk>>>>,
    ring_bytes_capacity: Arc<AtomicUsize>,
    used_bytes: Arc<Mutex<usize>>,
    dropped_bytes_total: Arc<AtomicU64>,
    head_seq: Arc<AtomicU64>,
    tail_seq: Arc<AtomicU64>,

    // Live broadcast
    sender: broadcast::Sender<Arc<Chunk>>,

    // Listener tasks management
    listener_tasks: Arc<Mutex<HashMap<u64, tokio::task::JoinHandle<()>>>>,
    next_listener_id: AtomicU64,
    default_coalesce_ms: AtomicU64,
    rt_handle: tokio::runtime::Handle,
}

impl fmt::Debug for SSHConnection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SSHConnection")
            .field("connection_details", &self.connection_details)
            .field("created_at_ms", &self.created_at_ms)
            .field("tcp_established_at_ms", &self.tcp_established_at_ms)
            .finish()
    }
}

// Internal chunk type kept in ring/broadcast
#[derive(Debug)]
struct Chunk {
    seq: u64,
    t_ms: f64,
    stream: StreamKind,
    bytes: Bytes,
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
    /// Convenience snapshot for property-like access in TS.
    pub fn info(&self) -> SshConnectionInfo {
        SshConnectionInfo {
            connection_id: self.connection_id.clone(),
            connection_details: self.connection_details.clone(),
            created_at_ms: self.created_at_ms,
            tcp_established_at_ms: self.tcp_established_at_ms,
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
        // Request a PTY with basic sane defaults: enable ECHO and set speeds.
        // RFC4254 terminal mode opcodes: 53=ECHO, 128=TTY_OP_ISPEED, 129=TTY_OP_OSPEED
        let modes: &[(russh::Pty, u32)] = &[
            (russh::Pty::ECHO, 1),
            (russh::Pty::ECHOK, 1),
            (russh::Pty::ECHOE, 1),
            (russh::Pty::ICANON, 1),
            (russh::Pty::ISIG, 1),
            (russh::Pty::ICRNL, 1),
            (russh::Pty::ONLCR, 1),
            (russh::Pty::TTY_OP_ISPEED, 38400),
            (russh::Pty::TTY_OP_OSPEED, 38400),
        ];
        ch.request_pty(true, pty.as_ssh_name(), 80, 24, 0, 0, modes).await?;
        ch.request_shell(true).await?;

        // Split for read/write; spawn reader.
        let (mut reader, writer) = ch.split();

        // Setup ring + broadcast for this session
        let (tx, _rx) = broadcast::channel::<Arc<Chunk>>(1024);
        let ring = Arc::new(Mutex::new(std::collections::VecDeque::<Arc<Chunk>>::new()));
        let used_bytes = Arc::new(Mutex::new(0usize));
        let next_seq = Arc::new(AtomicU64::new(1));
        let head_seq = Arc::new(AtomicU64::new(1));
        let tail_seq = Arc::new(AtomicU64::new(0));
        let dropped_bytes_total = Arc::new(AtomicU64::new(0));
        let ring_bytes_capacity = Arc::new(AtomicUsize::new(2 * 1024 * 1024)); // default 2MiB
        let default_coalesce_ms = AtomicU64::new(16); // default 16ms

        let ring_clone = ring.clone();
        let used_bytes_clone = used_bytes.clone();
        let tx_clone = tx.clone();
        let ring_bytes_capacity_c = ring_bytes_capacity.clone();
        let dropped_bytes_total_c = dropped_bytes_total.clone();
        let head_seq_c = head_seq.clone();
        let tail_seq_c = tail_seq.clone();
        let next_seq_c = next_seq.clone();
        let shell_listener_for_task = shell_status_listener.clone();
        let reader_task = tokio::spawn(async move {
            let max_chunk = 16 * 1024; // 16KB
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
                        if let Some(sl) = shell_listener_for_task.as_ref() {
                            sl.on_change(SSHConnectionStatus::ShellDisconnected);
                        }
                        break;
                    }
                    _ => {}
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
            ring,
            ring_bytes_capacity,
            used_bytes,
            dropped_bytes_total,
            head_seq,
            tail_seq,
            sender: tx,
            listener_tasks: Arc::new(Mutex::new(HashMap::new())),
            next_listener_id: AtomicU64::new(1),
            default_coalesce_ms,
            rt_handle: tokio::runtime::Handle::current(),
        });

        *self.shell.lock().await = Some(session.clone());

        // Report ShellConnected.
        if let Some(sl) = session.shell_status_listener.as_ref() {
            sl.on_change(SSHConnectionStatus::ShellConnected);
        }

        Ok(session)
    }

    // Note: send_data now lives on ShellSession

    // No exported close_shell: shell closure is handled via ShellSession::close()

    /// Disconnect TCP (also closes any active shell).
    pub async fn disconnect(&self) -> Result<(), SshError> {
        // Close shell first.
        if let Some(session) = self.shell.lock().await.take() {
            let _ = ShellSession::close_internal(&session).await;
        }

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
            connection_id: self.parent.upgrade().map(|p| p.connection_id.clone()).unwrap_or_default(),
        }
    }

    /// Send bytes to the active shell (stdin).
    pub async fn send_data(&self, data: Vec<u8>) -> Result<(), SshError> {
        let w = self.writer.lock().await;
        w.data(&data[..]).await?;
        Ok(())
    }

    /// Close the associated shell channel and stop its reader task.
    pub async fn close(&self) -> Result<(), SshError> { self.close_internal().await }

    /// Configure ring buffer policy.
    pub async fn set_buffer_policy(&self, ring_bytes: Option<u64>, coalesce_ms: Option<u32>) {
        if let Some(rb) = ring_bytes { self.ring_bytes_capacity.store(rb as usize, Ordering::Relaxed); self.evict_if_needed(); }
        if let Some(cm) = coalesce_ms { self.default_coalesce_ms.store(cm as u64, Ordering::Relaxed); }
    }

    /// Buffer statistics snapshot.
    pub fn buffer_stats(&self) -> BufferStats {
        let used = *self.used_bytes.lock().unwrap_or_else(|p| p.into_inner()) as u64;
        let chunks = match self.ring.lock() { Ok(q) => q.len() as u64, Err(p) => p.into_inner().len() as u64 };
        BufferStats {
            ring_bytes: self.ring_bytes_capacity.load(Ordering::Relaxed) as u64,
            used_bytes: used,
            chunks,
            head_seq: self.head_seq.load(Ordering::Relaxed),
            tail_seq: self.tail_seq.load(Ordering::Relaxed),
            dropped_bytes_total: self.dropped_bytes_total.load(Ordering::Relaxed),
        }
    }

    /// Current next sequence number.
    pub fn current_seq(&self) -> u64 { self.tail_seq.load(Ordering::Relaxed).saturating_add(1) }

    /// Read the ring buffer from a cursor.
    pub fn read_buffer(&self, cursor: Cursor, max_bytes: Option<u64>) -> BufferReadResult {
        let max_total = max_bytes.unwrap_or(512 * 1024) as usize; // default 512KB
        let mut out_chunks: Vec<TerminalChunk> = Vec::new();
        let mut dropped: Option<DroppedRange> = None;
        let head_seq_now = self.head_seq.load(Ordering::Relaxed);
        let tail_seq_now = self.tail_seq.load(Ordering::Relaxed);

        // Lock ring to determine start and collect arcs, then drop lock.
        let (_start_idx_unused, _start_seq, arcs): (usize, u64, Vec<Arc<Chunk>>) = {
            let ring = match self.ring.lock() { Ok(g) => g, Err(p) => p.into_inner() };
            let (start_seq, idx) = match cursor {
                Cursor::Head => (head_seq_now, 0usize),
                Cursor::Seq { seq: mut s } => {
                    if s < head_seq_now { dropped = Some(DroppedRange { from_seq: s, to_seq: head_seq_now - 1 }); s = head_seq_now; }
                    let idx = s.saturating_sub(head_seq_now) as usize;
                    (s, idx.min(ring.len()))
                }
                Cursor::TimeMs { t_ms: t } => {
                    // linear scan to find first chunk with t_ms >= t
                    let mut idx = 0usize; let mut s = head_seq_now;
                    for (i, ch) in ring.iter().enumerate() { if ch.t_ms >= t { idx = i; s = ch.seq; break; } }
                    (s, idx)
                }
                Cursor::TailBytes { bytes: n } => {
                    // Walk from tail backwards until approx n bytes, then forward.
                    let mut bytes = 0usize; let mut idx = ring.len();
                    for i in (0..ring.len()).rev() {
                        let b = ring[i].bytes.len();
                        if bytes >= n as usize { idx = i + 1; break; }
                        bytes += b; idx = i;
                    }
                    let s = if idx < ring.len() { ring[idx].seq } else { tail_seq_now.saturating_add(1) };
                    (s, idx)
                }
                Cursor::Live => (tail_seq_now.saturating_add(1), ring.len()),
            };
            let arcs: Vec<Arc<Chunk>> = ring.iter().skip(idx).cloned().collect();
            (idx, start_seq, arcs)
        };

        // Build output respecting max_bytes
        let mut total = 0usize;
        for ch in arcs {
            let len = ch.bytes.len();
            if total + len > max_total { break; }
            out_chunks.push(TerminalChunk { seq: ch.seq, t_ms: ch.t_ms, stream: ch.stream, bytes: ch.bytes.clone().to_vec() });
            total += len;
        }
        let next_seq = if let Some(last) = out_chunks.last() { last.seq + 1 } else { tail_seq_now.saturating_add(1) };
        BufferReadResult { chunks: out_chunks, next_seq, dropped }
    }

    /// Add a listener with optional replay and live follow.
    pub fn add_listener(&self, listener: Arc<dyn ShellListener>, opts: ListenerOptions) -> Result<u64, SshError> {
        // Snapshot for replay; emit from task to avoid re-entrant callbacks during FFI.
        let replay = self.read_buffer(opts.cursor.clone(), None);
        let mut rx = self.sender.subscribe();
        let id = self.next_listener_id.fetch_add(1, Ordering::Relaxed);
        eprintln!("ShellSession.add_listener -> id={id}");
        let default_coalesce_ms = self.default_coalesce_ms.load(Ordering::Relaxed) as u32;
        let coalesce_ms = opts.coalesce_ms.unwrap_or(default_coalesce_ms);

        let rt = self.rt_handle.clone();
        let handle = rt.spawn(async move {
            // Emit replay first
            if let Some(dr) = replay.dropped.as_ref() {
                listener.on_event(ShellEvent::Dropped { from_seq: dr.from_seq, to_seq: dr.to_seq });
            }
            for ch in replay.chunks.into_iter() {
                listener.on_event(ShellEvent::Chunk(ch));
            }

            let mut last_seq_seen: u64 = replay.next_seq.saturating_sub(1);
            let mut acc: Vec<u8> = Vec::new();
            let mut acc_stream: Option<StreamKind>;
            let mut acc_last_seq: u64;
            let mut acc_last_t: f64;
            let window = Duration::from_millis(coalesce_ms as u64);
            let mut pending_drop_from: Option<u64> = None;

            loop {
                // First receive an item
                let first = match rx.recv().await {
                    Ok(c) => c,
                    Err(broadcast::error::RecvError::Lagged(_n)) => { pending_drop_from = Some(last_seq_seen.saturating_add(1)); continue; }
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                if let Some(from) = pending_drop_from.take() {
                    if from <= first.seq.saturating_sub(1) {
                        listener.on_event(ShellEvent::Dropped { from_seq: from, to_seq: first.seq - 1 });
                    }
                }
                // Start accumulating
                acc.clear(); acc_stream = Some(first.stream); acc_last_seq = first.seq; acc_last_t = first.t_ms; acc.extend_from_slice(&first.bytes);
                last_seq_seen = first.seq;

                // Drain within window while same stream
                let mut deadline = tokio::time::Instant::now() + window;
                loop {
                    let timeout = tokio::time::sleep_until(deadline);
                    tokio::pin!(timeout);
                    tokio::select! {
                        _ = &mut timeout => break,
                        msg = rx.recv() => {
                            match msg {
                                Ok(c) => {
                                    if Some(c.stream) == acc_stream { acc.extend_from_slice(&c.bytes); acc_last_seq = c.seq; acc_last_t = c.t_ms; last_seq_seen = c.seq; }
                                    else { // flush and start new
                                        let chunk = TerminalChunk { seq: acc_last_seq, t_ms: acc_last_t, stream: acc_stream.unwrap_or(StreamKind::Stdout), bytes: std::mem::take(&mut acc) };
                                        listener.on_event(ShellEvent::Chunk(chunk));
                                        acc_stream = Some(c.stream); acc_last_seq = c.seq; acc_last_t = c.t_ms; acc.extend_from_slice(&c.bytes); last_seq_seen = c.seq;
                                        deadline = tokio::time::Instant::now() + window;
                                    }
                                }
                                Err(broadcast::error::RecvError::Lagged(_n)) => { pending_drop_from = Some(last_seq_seen.saturating_add(1)); break; }
                                Err(broadcast::error::RecvError::Closed) => { break; }
                            }
                        }
                    }
                }
                if let Some(s) = acc_stream.take() {
                    let chunk = TerminalChunk { seq: acc_last_seq, t_ms: acc_last_t, stream: s, bytes: std::mem::take(&mut acc) };
                    listener.on_event(ShellEvent::Chunk(chunk));
                }
            }
        });
        if let Ok(mut map) = self.listener_tasks.lock() { map.insert(id, handle); }
        Ok(id)
    }

    pub fn remove_listener(&self, id: u64) {
        if let Ok(mut map) = self.listener_tasks.lock() {
            if let Some(h) = map.remove(&id) { h.abort(); }
        }
    }
}

// Internal lifecycle helpers (not exported via UniFFI)
impl ShellSession {
    async fn close_internal(&self) -> Result<(), SshError> {
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

    fn evict_if_needed(&self) {
        let cap = self.ring_bytes_capacity.load(Ordering::Relaxed);
        let mut ring = match self.ring.lock() { Ok(g) => g, Err(p) => p.into_inner() };
        let mut used = self.used_bytes.lock().unwrap_or_else(|p| p.into_inner());
        while *used > cap {
            if let Some(front) = ring.pop_front() {
                *used -= front.bytes.len();
                self.dropped_bytes_total.fetch_add(front.bytes.len() as u64, Ordering::Relaxed);
                self.head_seq.store(front.seq.saturating_add(1), Ordering::Relaxed);
            } else { break; }
        }
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
    let connection_id = format!("{}@{}:{}|{}", details.username, details.host, details.port, now as u64);
    let conn = Arc::new(SSHConnection {
        connection_id,
        connection_details: details,
        created_at_ms: now,
        tcp_established_at_ms: now,
        handle: AsyncMutex::new(handle),
        shell: AsyncMutex::new(None),
        self_weak: AsyncMutex::new(Weak::new()),
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

#[allow(clippy::too_many_arguments)]
fn append_and_broadcast(
    data: &[u8],
    stream: StreamKind,
    ring: &Arc<Mutex<std::collections::VecDeque<Arc<Chunk>>>>,
    used_bytes: &Arc<Mutex<usize>>,
    ring_bytes_capacity: &Arc<AtomicUsize>,
    dropped_bytes_total: &Arc<AtomicU64>,
    head_seq: &Arc<AtomicU64>,
    tail_seq: &Arc<AtomicU64>,
    next_seq: &Arc<AtomicU64>,
    sender: &broadcast::Sender<Arc<Chunk>>,
    max_chunk: usize,
) {
    let mut offset = 0usize;
    while offset < data.len() {
        let end = (offset + max_chunk).min(data.len());
        let slice = &data[offset..end];
        let seq = next_seq.fetch_add(1, Ordering::Relaxed);
        let t_ms = now_ms();
        let chunk = Arc::new(Chunk { seq, t_ms, stream, bytes: Bytes::copy_from_slice(slice) });
        // push to ring
        {
            let mut q = match ring.lock() { Ok(g) => g, Err(p) => p.into_inner() };
            q.push_back(chunk.clone());
        }
        {
            let mut used = used_bytes.lock().unwrap_or_else(|p| p.into_inner());
            *used += slice.len();
            tail_seq.store(seq, Ordering::Relaxed);
            // evict if needed
            let cap = ring_bytes_capacity.load(Ordering::Relaxed);
            if *used > cap {
                let mut q = match ring.lock() { Ok(g) => g, Err(p) => p.into_inner() };
                while *used > cap {
                    if let Some(front) = q.pop_front() {
                        *used -= front.bytes.len();
                        dropped_bytes_total.fetch_add(front.bytes.len() as u64, Ordering::Relaxed);
                        head_seq.store(front.seq.saturating_add(1), Ordering::Relaxed);
                    } else { break; }
                }
            }
        }
        // broadcast
        let _ = sender.send(chunk);

        offset = end;
    }
}
