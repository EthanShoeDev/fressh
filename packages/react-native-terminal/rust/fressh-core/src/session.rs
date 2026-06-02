//! `Session = connection + shells + Term + reader task`. The reader loop feeds
//! the parsed `Term` continuously in the background — view or no view — which is
//! exactly what makes scrollback durable across view mount/unmount (§9).

use std::sync::{Arc, Mutex};

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::Config as TermConfig;
use alacritty_terminal::vte::ansi::Processor;
use alacritty_terminal::Term;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use fressh_ssh::{Connection as SshConnection, Shell, ShellWriter, SshError, TerminalType};

use crate::events::{self, CoreEvent};
use crate::{registry, runtime};

/// Shared, lockable parsed terminal state. The reader loop writes it; the render
/// plane reads it (looked up from the registry by shell id). Std `Mutex` is fine
/// — contention is a brief per-chunk write vs a per-frame read.
pub type SharedTerm = Arc<Mutex<Term<CoreListener>>>;

/// `EventListener` for our `Term`. The only event we must act on is `PtyWrite`
/// (terminal responses to queries like cursor-position reports): we forward those
/// bytes back to the shell's stdin. Other events (title, bell, …) are ignored for
/// now. Cheap to clone; the parser calls it synchronously while the `Term` is
/// locked, so it must not block — it just enqueues onto an unbounded channel.
#[derive(Clone)]
pub struct CoreListener {
	pty_tx: mpsc::UnboundedSender<Vec<u8>>,
}

impl EventListener for CoreListener {
	fn send_event(&self, event: Event) {
		if let Event::PtyWrite(text) = event {
			let _ = self.pty_tx.send(text.into_bytes());
		}
	}
}

/// A live shell: the durable `Term`, a writer for stdin/resize, and the two
/// background tasks (the reader loop feeding `Term`, and the PTY-response drain).
pub struct ShellSession {
	pub shell_id: String,
	pub connection_id: String,
	pub channel_id: u32,
	pub term_type: TerminalType,
	pub created_at_ms: f64,
	pub term: SharedTerm,
	writer: ShellWriter,
	reader_task: JoinHandle<()>,
	pty_task: JoinHandle<()>,
}

impl ShellSession {
	/// Wrap a freshly opened [`Shell`] in a session: build the `Term`, spawn the
	/// reader loop (bytes → `Term`) and the PTY-response drain (`Term` → stdin).
	pub(crate) fn spawn(
		shell_id: String,
		connection_id: String,
		shell: Shell,
		cols: usize,
		rows: usize,
		scrollback_lines: usize,
	) -> Arc<Self> {
		let (pty_tx, mut pty_rx) = mpsc::unbounded_channel::<Vec<u8>>();
		let listener = CoreListener { pty_tx };

		let dims = GridDims { columns: cols.max(1), screen_lines: rows.max(1) };
		let config = TermConfig { scrolling_history: scrollback_lines, ..Default::default() };
		let term: SharedTerm = Arc::new(Mutex::new(Term::new(config, &dims, listener)));

		let channel_id = shell.channel_id;
		let term_type = shell.term;
		let created_at_ms = shell.created_at_ms;
		let writer = shell.writer.clone();
		let mut reader = shell.reader;

		// Reader loop: parse incoming bytes into the durable Term until EOF.
		let term_for_reader = term.clone();
		let shell_id_for_reader = shell_id.clone();
		let reader_task = runtime::handle().spawn(async move {
			let mut processor: Processor = Processor::new();
			while let Some(chunk) = reader.recv().await {
				let mut term = term_for_reader.lock().unwrap_or_else(|p| p.into_inner());
				processor.advance(&mut *term, &chunk.bytes);
			}
			// EOF → the channel closed; drop the session and notify JS.
			registry::remove_shell(&shell_id_for_reader);
			events::emit(CoreEvent::ShellClosed { shell_id: shell_id_for_reader });
		});

		// PTY-response drain: write terminal query responses back to the server.
		let writer_for_pty = writer.clone();
		let pty_task = runtime::handle().spawn(async move {
			while let Some(bytes) = pty_rx.recv().await {
				let _ = writer_for_pty.send_data(&bytes).await;
			}
		});

		Arc::new(Self {
			shell_id,
			connection_id,
			channel_id,
			term_type,
			created_at_ms,
			term,
			writer,
			reader_task,
			pty_task,
		})
	}

	/// Send user input (stdin) to the shell.
	pub async fn send_data(&self, data: &[u8]) -> Result<(), SshError> {
		self.writer.send_data(data).await
	}

	/// Resize the terminal: reflow the durable `Term` and tell the server.
	pub async fn resize(&self, cols: usize, rows: usize) -> Result<(), SshError> {
		{
			let mut term = self.term.lock().unwrap_or_else(|p| p.into_inner());
			term.resize(GridDims { columns: cols.max(1), screen_lines: rows.max(1) });
		}
		self.writer.resize(cols as u32, rows as u32, 0, 0).await
	}

	/// Close the shell: stop the background tasks and close the channel. The
	/// `Term` is dropped with the session (caller removes it from the registry).
	pub async fn close(&self) {
		self.reader_task.abort();
		self.pty_task.abort();
		let _ = self.writer.close().await;
	}
}

/// A live connection plus its registry id. Shells are tracked in the registry
/// keyed by their own ids, not nested here (flat id-keyed model, §7).
pub struct ConnectionSession {
	pub connection_id: String,
	pub inner: Arc<SshConnection>,
}

/// Grid dimensions for `Term::new`. History is configured separately via
/// `TermConfig::scrolling_history`, so `total_lines == screen_lines` here.
struct GridDims {
	columns: usize,
	screen_lines: usize,
}
impl Dimensions for GridDims {
	fn total_lines(&self) -> usize {
		self.screen_lines
	}
	fn screen_lines(&self) -> usize {
		self.screen_lines
	}
	fn columns(&self) -> usize {
		self.columns
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The `Term`'s replies to queries (here a Device Status Report) must flow
	/// through `CoreListener` onto the PTY-response channel so the drain task can
	/// write them back to the server. This is the seam the reader loop relies on.
	#[test]
	fn pty_write_is_forwarded_to_response_channel() {
		let (pty_tx, mut pty_rx) = mpsc::unbounded_channel::<Vec<u8>>();
		let listener = CoreListener { pty_tx };
		let dims = GridDims { columns: 80, screen_lines: 24 };
		let mut term = Term::new(TermConfig::default(), &dims, listener);

		// CSI 6 n = report cursor position → Term replies via Event::PtyWrite.
		let mut processor: Processor = Processor::new();
		processor.advance(&mut term, b"\x1b[6n");

		let resp = pty_rx.try_recv().expect("expected a PTY response");
		assert!(resp.starts_with(b"\x1b["), "expected a CSI response, got {resp:?}");
		assert!(resp.ends_with(b"R"), "expected a cursor-position report ending in 'R'");
	}
}
