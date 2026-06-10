//! The byte-source seam for a [`ShellSession`](crate::session::ShellSession)'s
//! durable `Term` (the data plane, §11).
//!
//! `ShellSession` is deliberately source-agnostic: it owns the parsed `Term`, the
//! reader loop that feeds it, and the PTY-response drain. The ONLY source-specific
//! parts are the **read half** (a byte stream the loop pulls until EOF) and the
//! **write half** (stdin / resize / close). This module factors those behind two
//! small *closed* enums so one `Term` can be driven by:
//!   - SSH today ([`ReadSource::Ssh`] / [`WriteSink::Ssh`]),
//!   - a canned snippet for the Terminal-settings live preview
//!     ([`ReadSource::Canned`] / [`WriteSink::Noop`]),
//!   - and a local PTY tomorrow (the on-device-shell project adds `Local` arms).
//!
//! Enums (not trait objects) because the source set is small and entirely in-tree:
//! no dynamic dispatch, and adding a source is a localized match-arm change.

use bytes::Bytes;

use fressh_ssh::{Shell, ShellReader, ShellWriter, SshError, TerminalType};

/// The read half: the reader loop awaits [`recv`](ReadSource::recv) until it
/// returns `None` (EOF → the session is torn down). Each variant is one source.
pub enum ReadSource {
	/// Live SSH channel output.
	Ssh(ShellReader),
	/// A fixed snippet delivered once, then the stream parks forever — so a
	/// preview `Term` is fed its demo content and then stays alive and bound like
	/// a real shell instead of hitting the EOF branch that removes it.
	Canned(Option<Bytes>),
}

impl ReadSource {
	/// Await the next output chunk. `None` means EOF — only the SSH arm ever
	/// returns it; the canned arm yields its snippet once and then never resolves.
	pub async fn recv(&mut self) -> Option<Bytes> {
		match self {
			ReadSource::Ssh(reader) => reader.recv().await.map(|chunk| chunk.bytes),
			ReadSource::Canned(pending) => match pending.take() {
				Some(bytes) => Some(bytes),
				// Already delivered: park forever so the reader loop never sees EOF
				// and the preview `Term` is kept alive by the registry.
				None => std::future::pending().await,
			},
		}
	}
}

/// The write half: stdin, terminal resize, and channel close. Cheap to clone (the
/// session shares one between the user-input path and the PTY-response drain).
#[derive(Clone)]
pub enum WriteSink {
	/// Live SSH channel input.
	Ssh(ShellWriter),
	/// A sink that swallows everything — a canned preview has nowhere to write
	/// (no stdin, no remote to inform of a resize).
	Noop,
}

impl WriteSink {
	/// Send bytes to the source's stdin (no-op for a preview).
	pub async fn send_data(&self, data: &[u8]) -> Result<(), SshError> {
		match self {
			WriteSink::Ssh(writer) => writer.send_data(data).await,
			WriteSink::Noop => Ok(()),
		}
	}

	/// Inform the source of a new terminal size (no-op for a preview — the local
	/// `Term` is still reflowed by the session before this is called).
	pub async fn resize(&self, cols: u32, rows: u32) -> Result<(), SshError> {
		match self {
			WriteSink::Ssh(writer) => writer.resize(cols, rows, 0, 0).await,
			WriteSink::Noop => Ok(()),
		}
	}

	/// Close the underlying channel (no-op for a preview).
	pub async fn close(&self) -> Result<(), SshError> {
		match self {
			WriteSink::Ssh(writer) => writer.close().await,
			WriteSink::Noop => Ok(()),
		}
	}
}

/// A `Term` byte source handed to [`ShellSession::spawn`](crate::session::ShellSession::spawn):
/// a read half, a write half, and the metadata the session records. SSH builds one
/// from a freshly opened channel; the settings preview builds a canned one.
pub struct ShellBackend {
	pub channel_id: u32,
	pub term_type: TerminalType,
	pub created_at_ms: f64,
	pub reader: ReadSource,
	pub writer: WriteSink,
}

impl ShellBackend {
	/// Wrap a freshly opened SSH [`Shell`] (the live-session path).
	pub fn from_ssh(shell: Shell) -> Self {
		Self {
			channel_id: shell.channel_id,
			term_type: shell.term,
			created_at_ms: shell.created_at_ms,
			reader: ReadSource::Ssh(shell.reader),
			writer: WriteSink::Ssh(shell.writer),
		}
	}

	/// A non-SSH source that feeds `demo` once and then idles, with a no-op writer.
	/// Used by the Terminal-settings live preview. The metadata is synthetic — a
	/// preview has no channel — but harmless: it lives in the registry under a
	/// reserved id and is filtered out of connection-scoped operations.
	pub fn canned(demo: Bytes) -> Self {
		Self {
			channel_id: 0,
			term_type: TerminalType::Xterm256,
			created_at_ms: 0.0,
			reader: ReadSource::Canned(Some(demo)),
			writer: WriteSink::Noop,
		}
	}
}
