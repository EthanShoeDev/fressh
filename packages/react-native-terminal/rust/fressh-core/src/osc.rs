//! Shell-integration OSC scanner (the "semantic events" seam).
//!
//! The high-frequency byte stream feeds `Term` natively and never crosses to JS
//! (§10 data plane). Semantic facts buried in it — cwd, command lifecycle, exit
//! codes — are lifted out HERE and emitted as low-frequency [`CoreEvent`]s.
//!
//! ## Why a second parser, not a `Term`/`EventListener` hook
//!
//! `Term` uses vte's HIGH-LEVEL `ansi::Handler`, whose `osc_dispatch` routes OSC 7
//! and OSC 133 to an `unhandled` arm — so they never become an alacritty `Event`
//! and `CoreListener` can't see them. vte's LOW-LEVEL `Perform::osc_dispatch`,
//! however, fires for *every* OSC. So we run a second `vte::Parser` over the same
//! bytes with this `Perform` impl that overrides only `osc_dispatch`. vte does all
//! the real parsing (framing, UTF-8, BEL-vs-ST, chunk splits, max OSC buffer); we
//! add ~one match. No fork, no hand-rolled parser. See
//! docs/projects/terminal-semantic-events.md for the full decision + perf notes.

use std::time::Instant;

// vte is re-exported by alacritty_terminal (`pub use vte;`), so we reach its
// LOW-LEVEL parser without adding a dependency — and cargo unifies it to the
// same `vte` instance the engine already pulls in.
use alacritty_terminal::vte;

use crate::events::{self, CoreEvent};

/// Per-shell OSC scanner. Implements [`vte::Perform`] but acts only on OSC 7
/// (cwd) and OSC 133 (semantic prompt). Driven by a [`vte::Parser`] owned by the
/// reader loop; holds the small lifecycle state needed to derive command
/// duration and to debounce the command-start marker across dialects.
pub struct OscScanner {
	shell_id: String,
	/// `Instant` of the most recent `CommandStart`, for the `CommandFinished`
	/// duration. `None` between commands (idle at a prompt).
	command_started_at: Option<Instant>,
	/// True once a command has started for the current prompt — so a shell that
	/// emits BOTH `133;B` and `133;C` produces a single `CommandStart`.
	in_command: bool,
}

impl OscScanner {
	pub fn new(shell_id: String) -> Self {
		Self {
			shell_id,
			command_started_at: None,
			in_command: false,
		}
	}

	fn on_prompt_start(&mut self) {
		self.in_command = false;
		self.command_started_at = None;
		events::emit(CoreEvent::PromptStart {
			shell_id: self.shell_id.clone(),
		});
	}

	fn on_command_start(&mut self) {
		// `133;B` (command line read) and `133;C` (output begins) both map to "a
		// command is running now"; emit once for whichever arrives first.
		if self.in_command {
			return;
		}
		self.in_command = true;
		self.command_started_at = Some(Instant::now());
		events::emit(CoreEvent::CommandStart {
			shell_id: self.shell_id.clone(),
		});
	}

	fn on_command_finished(&mut self, exit_code: Option<i32>) {
		let duration_ms = self
			.command_started_at
			.take()
			.map(|t| t.elapsed().as_millis() as u64);
		self.in_command = false;
		events::emit(CoreEvent::CommandFinished {
			shell_id: self.shell_id.clone(),
			exit_code,
			duration_ms,
		});
	}
}

impl vte::Perform for OscScanner {
	fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
		match params.first().copied() {
			// OSC 7 ; file://host/path  — report cwd.
			Some(b"7") => {
				if let Some(path) = parse_osc7_path(params) {
					events::emit(CoreEvent::WorkingDirectoryChanged {
						shell_id: self.shell_id.clone(),
						path,
					});
				}
			}
			// OSC 133 ; {A|B|C|D} [; ...]  — FinalTerm / iTerm2 semantic prompt.
			Some(b"133") => match params.get(1).copied() {
				Some(b"A") => self.on_prompt_start(),
				Some(b"B") | Some(b"C") => self.on_command_start(),
				Some(b"D") => self.on_command_finished(parse_exit_code(params.get(2).copied())),
				_ => {}
			},
			_ => {}
		}
	}
}

/// Extract the path from an `OSC 7 ; file://host/path` payload, percent-decoded.
/// Tolerant: accepts a bare path (no `file://`), and rejoins on `;` in case the
/// path itself contained one (vte splits OSC params on `;`).
fn parse_osc7_path(params: &[&[u8]]) -> Option<String> {
	if params.len() < 2 {
		return None;
	}
	let joined = params[1..].join(&b';');
	let s = std::str::from_utf8(&joined).ok()?;
	let path = match s.strip_prefix("file://") {
		// `rest` = `host/abs/path`; the path is everything from the first '/'.
		Some(rest) => match rest.find('/') {
			Some(i) => &rest[i..],
			None => rest,
		},
		None => s,
	};
	if path.is_empty() {
		return None;
	}
	Some(percent_decode(path))
}

/// Parse the optional `133;D` exit-code param. Absent or unparseable → `None`.
fn parse_exit_code(param: Option<&[u8]>) -> Option<i32> {
	let bytes = param?;
	if bytes.is_empty() {
		return None;
	}
	std::str::from_utf8(bytes).ok()?.trim().parse::<i32>().ok()
}

/// Minimal `%XX` percent-decoder for OSC 7 file URIs (kept dependency-free).
/// Invalid escapes are passed through verbatim. Decoded bytes are UTF-8 where
/// valid, else lossily replaced — cwd paths are display-only here.
fn percent_decode(s: &str) -> String {
	let bytes = s.as_bytes();
	let mut out = Vec::with_capacity(bytes.len());
	let mut i = 0;
	while i < bytes.len() {
		if bytes[i] == b'%' && i + 2 < bytes.len() {
			if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
				out.push((h << 4) | l);
				i += 3;
				continue;
			}
		}
		out.push(bytes[i]);
		i += 1;
	}
	String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
	match b {
		b'0'..=b'9' => Some(b - b'0'),
		b'a'..=b'f' => Some(b - b'a' + 10),
		b'A'..=b'F' => Some(b - b'A' + 10),
		_ => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::events::{self, CoreEvent, EventSink};
	use std::sync::{Arc, Mutex};

	/// Captures emitted events for assertions. Installed as the process-wide sink;
	/// tests run serially (one sink slot) so they share `#[serial]`-like care via
	/// a fresh capture per test + draining what THIS scanner emitted.
	#[derive(Default)]
	struct Capture(Mutex<Vec<CoreEvent>>);
	impl EventSink for Capture {
		fn emit(&self, event: CoreEvent) {
			self.0.lock().unwrap().push(event);
		}
	}

	/// Feed `bytes` through a real `vte::Parser` + `OscScanner` and return the
	/// events emitted for THIS shell id (filtered, so a shared global sink across
	/// serially-run tests doesn't cross-contaminate assertions).
	fn run(shell_id: &str, chunks: &[&[u8]]) -> Vec<CoreEvent> {
		// The event sink is a process-wide static (last-writer-wins), so parallel
		// tests would clobber each other's sink mid-run. Serialize them.
		static TEST_LOCK: Mutex<()> = Mutex::new(());
		let _guard = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());

		let cap = Arc::new(Capture::default());
		events::set_event_sink(cap.clone());
		let mut parser = vte::Parser::new();
		let mut scanner = OscScanner::new(shell_id.to_string());
		for chunk in chunks {
			parser.advance(&mut scanner, chunk);
		}
		let events = cap
			.0
			.lock()
			.unwrap()
			.iter()
			.filter(|e| event_shell_id(e) == Some(shell_id))
			.cloned()
			.collect();
		events
	}

	fn event_shell_id(e: &CoreEvent) -> Option<&str> {
		match e {
			CoreEvent::WorkingDirectoryChanged { shell_id, .. }
			| CoreEvent::PromptStart { shell_id }
			| CoreEvent::CommandStart { shell_id }
			| CoreEvent::CommandFinished { shell_id, .. } => Some(shell_id),
			_ => None,
		}
	}

	#[test]
	fn osc7_emits_decoded_cwd() {
		let evs = run("s-osc7", &[b"\x1b]7;file://host/home/ethan/my%20dir\x07"]);
		assert!(matches!(
			evs.as_slice(),
			[CoreEvent::WorkingDirectoryChanged { path, .. }] if path == "/home/ethan/my dir"
		));
	}

	#[test]
	fn osc7_bare_path_no_scheme() {
		let evs = run("s-bare", &[b"\x1b]7;/var/log\x1b\\"]); // ST-terminated
		assert!(matches!(
			evs.as_slice(),
			[CoreEvent::WorkingDirectoryChanged { path, .. }] if path == "/var/log"
		));
	}

	#[test]
	fn osc133_full_lifecycle_with_exit_code() {
		let evs = run(
			"s-life",
			&[b"\x1b]133;A\x07", b"\x1b]133;C\x07", b"\x1b]133;D;3\x07"],
		);
		assert!(matches!(evs[0], CoreEvent::PromptStart { .. }));
		assert!(matches!(evs[1], CoreEvent::CommandStart { .. }));
		assert!(matches!(
			evs[2],
			CoreEvent::CommandFinished {
				exit_code: Some(3),
				..
			}
		));
		assert_eq!(evs.len(), 3);
	}

	#[test]
	fn osc133_b_and_c_emit_single_command_start() {
		let evs = run("s-bc", &[b"\x1b]133;A\x07\x1b]133;B\x07\x1b]133;C\x07"]);
		let starts = evs
			.iter()
			.filter(|e| matches!(e, CoreEvent::CommandStart { .. }))
			.count();
		assert_eq!(starts, 1, "B and C must coalesce into one CommandStart");
	}

	#[test]
	fn osc133_d_without_exit_code() {
		let evs = run("s-noexit", &[b"\x1b]133;D\x07"]);
		assert!(matches!(
			evs.as_slice(),
			[CoreEvent::CommandFinished {
				exit_code: None,
				duration_ms: None,
				..
			}]
		));
	}

	#[test]
	fn sequence_split_across_chunks_is_reassembled() {
		// vte buffers the partial OSC across `advance` calls — the whole point of
		// using it instead of scanning chunks by hand.
		let evs = run("s-split", &[b"\x1b]7;file://h/a", b"/b/c\x07"]);
		assert!(matches!(
			evs.as_slice(),
			[CoreEvent::WorkingDirectoryChanged { path, .. }] if path == "/a/b/c"
		));
	}

	#[test]
	fn plain_text_emits_nothing() {
		let evs = run("s-plain", &[b"hello \x1b[31mworld\x1b[0m\r\n$ "]);
		assert!(evs.is_empty());
	}
}
