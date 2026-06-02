//! A shell channel split into a [`ShellReader`] (incoming bytes) and a cloneable
//! [`ShellWriter`] (stdin / resize / close).
//!
//! Unlike the uniffi-russh original, there is **no ring buffer, broadcast, or
//! listener machinery here** — the durable state is now the parsed
//! `alacritty_terminal::Term` owned by `fressh-core`. This crate just turns the
//! russh channel into a clean byte stream; `fressh-core` spawns the reader loop
//! that feeds `Term`. (See docs/projects/native-rendering-refactor.md §9.)

use std::sync::Arc;

use bytes::Bytes;
use russh::{client, ChannelMsg, ChannelWriteHalf};
use tokio::sync::Mutex as AsyncMutex;

use crate::utils::SshError;

// Note: russh accepts an untyped string for the terminal type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
	pub fn as_ssh_name(self) -> &'static str {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
	Stdout,
	Stderr,
}

/// One run of bytes read from the shell channel, tagged with its stream.
#[derive(Debug, Clone)]
pub struct ShellChunk {
	pub stream: StreamKind,
	pub bytes: Bytes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalMode {
	pub opcode: u8, // PTY opcode (matches russh::Pty discriminants)
	pub value: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TerminalSize {
	pub row_height: Option<u32>,
	pub col_width: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TerminalPixelSize {
	pub pixel_width: Option<u32>,
	pub pixel_height: Option<u32>,
}

#[derive(Clone)]
pub struct StartShellOptions {
	pub term: TerminalType,
	pub terminal_mode: Option<Vec<TerminalMode>>,
	pub terminal_size: Option<TerminalSize>,
	pub terminal_pixel_size: Option<TerminalPixelSize>,
}

impl Default for StartShellOptions {
	fn default() -> Self {
		Self {
			term: TerminalType::Xterm256,
			terminal_mode: None,
			terminal_size: None,
			terminal_pixel_size: None,
		}
	}
}

pub static DEFAULT_TERMINAL_MODES: &[(russh::Pty, u32)] = &[
	(russh::Pty::ECHO, 1), // Echo characters back to the client.
	(russh::Pty::ECHOK, 1), // After the line-kill character, echo a newline.
	(russh::Pty::ECHOE, 1), // Visually erase on backspace.
	(russh::Pty::ICANON, 1), // Canonical (cooked) mode: line editing.
	(russh::Pty::ISIG, 1), // Generate signals on special chars (Ctrl+C, Ctrl+Z).
	(russh::Pty::ICRNL, 1), // Convert CR to NL on input.
	(russh::Pty::ONLCR, 1), // Convert NL to CR+NL on output.
	(russh::Pty::TTY_OP_ISPEED, 38400), // Input baud rate.
	(russh::Pty::TTY_OP_OSPEED, 38400), // Output baud rate.
];

pub static DEFAULT_TERM_ROW_HEIGHT: u32 = 24;
pub static DEFAULT_TERM_COL_WIDTH: u32 = 80;
pub static DEFAULT_TERM_PIXEL_WIDTH: u32 = 0;
pub static DEFAULT_TERM_PIXEL_HEIGHT: u32 = 0;

/// The read half of a shell channel. Call [`recv`](ShellReader::recv) in a loop
/// until it returns `None` (channel closed).
pub struct ShellReader {
	inner: russh::ChannelReadHalf,
}

impl ShellReader {
	pub(crate) fn new(inner: russh::ChannelReadHalf) -> Self {
		Self { inner }
	}

	/// Await the next chunk of shell output. Returns `None` once the channel is
	/// closed (EOF). Non-data control messages are skipped transparently.
	pub async fn recv(&mut self) -> Option<ShellChunk> {
		loop {
			match self.inner.wait().await {
				Some(ChannelMsg::Data { data }) => {
					return Some(ShellChunk {
						stream: StreamKind::Stdout,
						bytes: Bytes::copy_from_slice(&data),
					});
				}
				Some(ChannelMsg::ExtendedData { data, .. }) => {
					return Some(ShellChunk {
						stream: StreamKind::Stderr,
						bytes: Bytes::copy_from_slice(&data),
					});
				}
				Some(ChannelMsg::Close) | None => return None,
				Some(_) => continue,
			}
		}
	}
}

/// The write half of a shell channel. Cheaply cloneable so the user-input path
/// and the `Term`'s PTY-response path can share one channel. (See `fressh-core`.)
#[derive(Clone)]
pub struct ShellWriter {
	inner: Arc<AsyncMutex<ChannelWriteHalf<client::Msg>>>,
}

impl ShellWriter {
	pub(crate) fn new(inner: ChannelWriteHalf<client::Msg>) -> Self {
		Self { inner: Arc::new(AsyncMutex::new(inner)) }
	}

	/// Send bytes to the shell (stdin).
	pub async fn send_data(&self, data: &[u8]) -> Result<(), SshError> {
		self.inner.lock().await.data(data).await?;
		Ok(())
	}

	/// Inform the server of a new terminal size (SSH `window-change`).
	pub async fn resize(
		&self,
		cols: u32,
		rows: u32,
		pixel_width: u32,
		pixel_height: u32,
	) -> Result<(), SshError> {
		self.inner.lock().await.window_change(cols, rows, pixel_width, pixel_height).await?;
		Ok(())
	}

	/// Close the shell channel (best effort).
	pub async fn close(&self) -> Result<(), SshError> {
		self.inner.lock().await.close().await.ok();
		Ok(())
	}
}

/// A freshly opened shell: its reader half, a cloneable writer, and metadata.
pub struct Shell {
	pub channel_id: u32,
	pub term: TerminalType,
	pub created_at_ms: f64,
	pub reader: ShellReader,
	pub writer: ShellWriter,
}
