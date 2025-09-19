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
use russh::client::{Config, Handle as ClientHandle};
use russh_keys::{Algorithm, EcdsaCurve};
use russh::keys::{PrivateKey, PrivateKeyWithHashAlg};
use russh_keys::ssh_key::{self, LineEnding};
use bytes::Bytes;

uniffi::setup_scaffolding!();


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
}

#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum SshConnectionProgressEvent {
    // Before any progress events, assume: TcpConnecting
    TcpConnected,
    SshHandshake,
    // If promise has not resolved, assume: Authenticating
    // After promise resolves, assume: Connected
}

#[uniffi::export(with_foreign)]
pub trait ConnectProgressCallback: Send + Sync {
    fn on_change(&self, status: SshConnectionProgressEvent);
}

#[uniffi::export(with_foreign)]
pub trait ConnectionDisconnectedCallback: Send + Sync {
    fn on_change(&self, connection_id: String);
}

// Note: russh accepts an untyped string for the terminal type
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum TerminalType {
    Vanilla,
    Vt100,
    Vt102,
    Vt220,
    Ansi,
    Xterm,
    Xterm256,
}
impl TerminalType {
    fn as_ssh_name(self) -> &'static str {
        match self {
            TerminalType::Vanilla => "vanilla",
            TerminalType::Vt100 => "vt100",
            TerminalType::Vt102 => "vt102",
            TerminalType::Vt220 => "vt220",
            TerminalType::Ansi => "ansi",
            TerminalType::Xterm => "xterm",
            TerminalType::Xterm256 => "xterm-256color",
        }
    }
}

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

#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct TerminalMode {
    pub opcode: u8,   // PTY opcode (matches russh::Pty discriminants)
    pub value: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct TerminalSize {
    pub row_height: Option<u32>,
    pub col_width: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct TerminalPixelSize {
    pub pixel_width: Option<u32>,
    pub pixel_height: Option<u32>,
}

#[derive(Clone, uniffi::Record)]
pub struct StartShellOptions {
    pub term: TerminalType,
    pub terminal_mode: Option<Vec<TerminalMode>>,
    pub terminal_size: Option<TerminalSize>,
    pub terminal_pixel_size: Option<TerminalPixelSize>,
    pub on_closed_callback: Option<Arc<dyn ShellClosedCallback>>,
}

#[uniffi::export(with_foreign)]
pub trait ShellClosedCallback: Send + Sync {
    fn on_change(&self, channel_id: u32);
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SshConnectionInfoProgressTimings {
    // TODO: We should have a field for each SshConnectionProgressEvent. Would be great if this were enforced by the compiler.
    pub tcp_established_at_ms: f64,
    pub ssh_handshake_at_ms: f64,
}

/// Snapshot of current connection info for property-like access in TS.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SshConnectionInfo {
    pub connection_id: String,
    pub connection_details: ConnectionDetails,
    pub created_at_ms: f64,
    pub connected_at_ms: f64,
    pub progress_timings: SshConnectionInfoProgressTimings,
}

/// Snapshot of shell session info for property-like access in TS.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ShellSessionInfo {
    pub channel_id: u32,
    pub created_at_ms: f64,
    pub connected_at_ms: f64,
    pub term: TerminalType,
    pub connection_id: String,
}


#[derive(uniffi::Object)]
pub struct SshConnection {
    info: SshConnectionInfo,
    client_handle: AsyncMutex<ClientHandle<NoopHandler>>,

    shells: AsyncMutex<HashMap<u32, Arc<ShellSession>>>,

    // Weak self for child sessions to refer back without cycles.
    self_weak: AsyncMutex<Weak<SshConnection>>,
}

#[derive(uniffi::Object)]
pub struct ShellSession {
    info: ShellSessionInfo,
    on_closed_callback: Option<Arc<dyn ShellClosedCallback>>,

    // Weak backref; avoid retain cycle.
    parent: std::sync::Weak<SshConnection>,

    writer: AsyncMutex<russh::ChannelWriteHalf<client::Msg>>,
    // We keep the reader task to allow cancellation on close.
    reader_task: tokio::task::JoinHandle<()>,
   
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


#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum Cursor {
    Head, // start from the beginning
    TailBytes { bytes: u64 }, // start from the end of the last N bytes
    Seq { seq: u64 }, // start from the given sequence number
    TimeMs { t_ms: f64 }, // start from the given time in milliseconds
    Live, // start from the live stream
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ListenerOptions {
    pub cursor: Cursor,
    pub coalesce_ms: Option<u32>, // coalesce chunks into this many milliseconds
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct BufferReadResult {
    pub chunks: Vec<TerminalChunk>,
    pub next_seq: u64,
    pub dropped: Option<DroppedRange>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct BufferStats {
    pub ring_bytes_count: u64,
    pub used_bytes: u64,
    pub head_seq: u64,
    pub tail_seq: u64,
    pub dropped_bytes_total: u64,

    pub chunks_count: u64,
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

// Internal chunk type kept in ring/broadcast
#[derive(Debug)]
struct Chunk { // TODO: This is very similar to TerminalChunk. The only difference is the bytes field
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
static DEFAULT_TERMINAL_MODES: &[(russh::Pty, u32)] = &[
    (russh::Pty::ECHO, 1), // This will cause the terminal to echo the characters back to the client.
    (russh::Pty::ECHOK, 1), // After the line-kill character (often Ctrl+U), echo a newline.
    (russh::Pty::ECHOE, 1), // Visually erase on backspace (erase using BS-SP-BS sequence). 
    (russh::Pty::ICANON, 1), // Canonical (cooked) mode: line editing; input delivered line-by-line.
    (russh::Pty::ISIG, 1), // Generate signals on special chars (e.g., Ctrl+C -> SIGINT, Ctrl+Z -> SIGTSTP).
    (russh::Pty::ICRNL, 1), // Convert carriage return (CR, \r) to newline (NL, \n) on input.
    (russh::Pty::ONLCR, 1), // Convert newline (NL) to CR+NL on output (LF -> CRLF).
    (russh::Pty::TTY_OP_ISPEED, 38400), // Set input baud rate (here 38400). The baud rate is the number of characters per second.
    (russh::Pty::TTY_OP_OSPEED, 38400), // Set output baud rate (here 38400). The baud rate is the number of characters per second.
];

static DEFAULT_TERM_ROW_HEIGHT: u32 = 24;
static DEFAULT_TERM_COL_WIDTH: u32 = 80;
static DEFAULT_TERM_PIXEL_WIDTH: u32 = 0;
static DEFAULT_TERM_PIXEL_HEIGHT: u32 = 0;
static DEFAULT_TERM_COALESCE_MS: u64 = 16;

// Number of recent live chunks retained by the broadcast channel for each
// subscriber. If a subscriber falls behind this many messages, they will get a
// Lagged error and skip to the latest. Tune to: peak_chunks_per_sec × max_pause_sec.
static DEFAULT_BROADCAST_CHUNK_CAPACITY: usize = 1024;

// Byte budget for the on-heap replay/history ring buffer. When the total bytes
// of stored chunks exceed this, oldest chunks are evicted. Increase for a
// longer replay window at the cost of memory.
static DEFAULT_SHELL_RING_BUFFER_CAPACITY: usize = 2 * 1024 * 1024; // default 2MiB

// Upper bound for the size of a single appended/broadcast chunk. Incoming data
// is split into slices no larger than this. Smaller values reduce latency and
// loss impact; larger values reduce per-message overhead.
static DEFAULT_MAX_CHUNK_SIZE: usize = 16 * 1024; // 16KB

static DEFAULT_READ_BUFFER_MAX_BYTES: u64 = 512 * 1024; // 512KB

#[uniffi::export(async_runtime = "tokio")]
impl SshConnection {
    /// Convenience snapshot for property-like access in TS.
    pub fn get_info(&self) -> SshConnectionInfo {
        self.info.clone()
    }

    pub async fn start_shell(&self, opts: StartShellOptions) -> Result<Arc<ShellSession>, SshError> {

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

        let row_height  = opts.terminal_size.as_ref().and_then(|s| s.row_height).unwrap_or(DEFAULT_TERM_ROW_HEIGHT);
        let col_width   = opts.terminal_size.as_ref().and_then(|s| s.col_width).unwrap_or(DEFAULT_TERM_COL_WIDTH);
        let pixel_width = opts.terminal_pixel_size.as_ref().and_then(|s| s.pixel_width).unwrap_or(DEFAULT_TERM_PIXEL_WIDTH);
        let pixel_height= opts.terminal_pixel_size.as_ref().and_then(|s| s.pixel_height).unwrap_or(DEFAULT_TERM_PIXEL_HEIGHT);

        ch.request_pty(true, term.as_ssh_name(), col_width, row_height, pixel_width, pixel_height, &modes).await?;
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
            default_coalesce_ms,
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
        Ok(())
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl ShellSession {
    pub fn get_info(&self) -> ShellSessionInfo {
        self.info.clone()
    }

    /// Send bytes to the active shell (stdin).
    pub async fn send_data(&self, data: Vec<u8>) -> Result<(), SshError> {
        let w = self.writer.lock().await;
        w.data(&data[..]).await?;
        Ok(())
    }

    /// Close the associated shell channel and stop its reader task.
    pub async fn close(&self) -> Result<(), SshError> { self.close_internal().await }

    /// Buffer statistics snapshot.
    pub fn buffer_stats(&self) -> BufferStats {
        let used = *self.used_bytes.lock().unwrap_or_else(|p| p.into_inner()) as u64;
        let chunks_count = match self.ring.lock() { Ok(q) => q.len() as u64, Err(p) => p.into_inner().len() as u64 };
        BufferStats {
            ring_bytes_count: self.ring_bytes_capacity.load(Ordering::Relaxed) as u64,
            used_bytes: used,
            chunks_count,
            head_seq: self.head_seq.load(Ordering::Relaxed),
            tail_seq: self.tail_seq.load(Ordering::Relaxed),
            dropped_bytes_total: self.dropped_bytes_total.load(Ordering::Relaxed),
        }
    }

    /// Current next sequence number.
    pub fn current_seq(&self) -> u64 { self.tail_seq.load(Ordering::Relaxed).saturating_add(1) }

    /// Read the ring buffer from a cursor.
    pub fn read_buffer(&self, cursor: Cursor, max_bytes: Option<u64>) -> BufferReadResult {
        let max_total = max_bytes.unwrap_or(DEFAULT_READ_BUFFER_MAX_BYTES) as usize;
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
        if let Some(sl) = self.on_closed_callback.as_ref() {
            sl.on_change(self.info.channel_id);
        }
        // Clear parent's notion of active shell if it matches us.
        if let Some(parent) = self.parent.upgrade() {
            parent.shells.lock().await.remove(&self.info.channel_id);
        }
        Ok(())
    }

    // /// This was on the public interface but I don't think we need it
    // pub async fn set_buffer_policy(&self, ring_bytes: Option<u64>, coalesce_ms: Option<u32>) {
    //     if let Some(rb) = ring_bytes { self.ring_bytes_capacity.store(rb as usize, Ordering::Relaxed); self.evict_if_needed(); }
    //     if let Some(cm) = coalesce_ms { self.default_coalesce_ms.store(cm as u64, Ordering::Relaxed); }
    // }

    // fn evict_if_needed(&self) {
    //     let cap = self.ring_bytes_capacity.load(Ordering::Relaxed);
    //     let mut ring = match self.ring.lock() { Ok(g) => g, Err(p) => p.into_inner() };
    //     let mut used = self.used_bytes.lock().unwrap_or_else(|p| p.into_inner());
    //     while *used > cap {
    //         if let Some(front) = ring.pop_front() {
    //             *used -= front.bytes.len();
    //             self.dropped_bytes_total.fetch_add(front.bytes.len() as u64, Ordering::Relaxed);
    //             self.head_seq.store(front.seq.saturating_add(1), Ordering::Relaxed);
    //         } else { break; }
    //     }
    // }
}

/// ---------- Top-level API ----------

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
    let local_port = socket.local_addr()?.port(); // ephemeral local port
    
    
    let tcp_established_at_ms = now_ms();
    if let Some(sl) = options.on_connection_progress_callback.as_ref() {
        sl.on_change(SshConnectionProgressEvent::TcpConnected);
    }

    
    let cfg = Arc::new(Config::default());
    let mut handle: ClientHandle<NoopHandler> =
    russh::client::connect_stream(cfg, socket, NoopHandler).await?;


    let ssh_handshake_at_ms = now_ms();
    if let Some(sl) = options.on_connection_progress_callback.as_ref() {
        sl.on_change(SshConnectionProgressEvent::SshHandshake);
    }


    // Auth
    let auth_result  = match &details.security {
        Security::Password { password } => {
            handle
                .authenticate_password(details.username.clone(), password.clone())
                .await?
        }
        // Treat key_id as the OpenSSH PEM-encoded private key content
        Security::Key { private_key_content } => {
            // Parse OpenSSH private key text into a russh::keys::PrivateKey
            let parsed: PrivateKey = PrivateKey::from_openssh(private_key_content.as_str())
                .map_err(|e| SshError::RusshKeys(e.to_string()))?;
            // Wrap; omit hash preference (server selects or default applies)
            let pk_with_hash = PrivateKeyWithHashAlg::new(Arc::new(parsed), None);
            handle
                .authenticate_publickey(details.username.clone(), pk_with_hash)
                .await?
        }
    };
    if !matches!(auth_result, russh::client::AuthResult::Success) {
        return Err(auth_result.into());
    }


    let connection_id = format!("{}@{}:{}:{}", details.username, details.host, details.port, local_port);
    let conn = Arc::new(SshConnection {
        info: SshConnectionInfo {
            connection_id,
            connection_details: details,
            created_at_ms: started_at_ms,
            connected_at_ms: now_ms(),
            progress_timings: SshConnectionInfoProgressTimings { tcp_established_at_ms, ssh_handshake_at_ms },
        },
        client_handle: AsyncMutex::new(handle),
        shells: AsyncMutex::new(HashMap::new()),
        self_weak: AsyncMutex::new(Weak::new()),
    });
    // Initialize weak self reference.
    *conn.self_weak.lock().await = Arc::downgrade(&conn);
    Ok(conn)
}

#[uniffi::export]
pub fn validate_private_key(private_key_content: String) -> Result<String, SshError> {
    let parsed: russh_keys::PrivateKey = russh_keys::PrivateKey::from_openssh(&private_key_content)?;
    Ok(parsed.to_openssh(LineEnding::LF)?.to_string())
}

#[uniffi::export]
pub fn generate_key_pair(key_type: KeyType) -> Result<String, SshError> {
    let mut rng = OsRng;
    let key = match key_type {
        KeyType::Rsa => russh_keys::PrivateKey::random(&mut rng, Algorithm::Rsa { hash: None })?,
        KeyType::Ecdsa => russh_keys::PrivateKey::random(&mut rng, Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 })?,
        KeyType::Ed25519 => russh_keys::PrivateKey::random(&mut rng, Algorithm::Ed25519)?,
        KeyType::Ed448 => return Err(SshError::UnsupportedKeyType),
    };
    Ok(key.to_openssh(LineEnding::LF)?.to_string())
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


// TODO: Split this into different errors for each public function
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
impl From<std::io::Error> for SshError {
    fn from(e: std::io::Error) -> Self { SshError::Russh(e.to_string()) }
}
impl From<russh::client::AuthResult> for SshError {
    fn from(a: russh::client::AuthResult) -> Self {
        SshError::Auth(format!("{a:?}"))
    }
}
