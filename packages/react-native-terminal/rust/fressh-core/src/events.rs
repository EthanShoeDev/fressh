//! One-way event sink to JS (the shim supplies the concrete emitter). (§10)
//!
//! These are the LOW-FREQUENCY events that must reach JS: connection progress,
//! a pending host-key decision, and close notifications. The high-frequency byte
//! stream never comes through here — it feeds `Term` natively. (§10 data plane.)

use std::sync::Arc;

use once_cell::sync::Lazy;
use std::sync::Mutex;

use fressh_ssh::{ServerPublicKeyInfo, SshConnectionProgressEvent};

/// Events emitted from the core to the binding shim (uniffi callback / craby Signal).
#[derive(Debug, Clone)]
pub enum CoreEvent {
	ConnectProgress {
		connection_id: String,
		event: SshConnectionProgressEvent,
	},
	HostKeyPending {
		connection_id: String,
		info: ServerPublicKeyInfo,
	},
	ConnectionClosed {
		connection_id: String,
	},
	ShellClosed {
		shell_id: String,
	},

	// ── Shell-integration semantic events (OSC 7 + OSC 133 + OSC 633). ─────
	// Lifted out of the byte stream by the `OscScanner` (`osc.rs`), which runs a
	// second low-level `vte::Parser` in the reader loop. Emitted when the remote
	// shell has shell integration enabled — either the user's own setup (which
	// typically emits 7/133) or fressh's auto-injected scripts (which emit 633,
	// VS Code's superset). See docs/projects/terminal-semantic-events.md.
	/// OSC 7 / OSC 633;P;Cwd: the interactive shell's cwd changed.
	WorkingDirectoryChanged {
		shell_id: String,
		path: String,
	},
	/// OSC 133;A / OSC 633;A: a new prompt is being drawn.
	PromptStart {
		shell_id: String,
	},
	/// OSC 133;C / OSC 633;C: a command began running (output region starts).
	CommandStart {
		shell_id: String,
	},
	/// OSC 133;D / OSC 633;D: the command finished. `exit_code` is absent when the
	/// shell omits it; `duration_ms` is measured from the matching `CommandStart`.
	CommandFinished {
		shell_id: String,
		exit_code: Option<i32>,
		duration_ms: Option<u64>,
	},
	/// OSC 633;E: the literal command line that ran. The 633 superset carries this;
	/// plain 133 does not. Powers command history / per-command scrollback / AI.
	CommandText {
		shell_id: String,
		command: String,
	},
}

/// Implemented by the binding shim; receives [`CoreEvent`]s on a background thread.
pub trait EventSink: Send + Sync {
	fn emit(&self, event: CoreEvent);
}

static SINK: Lazy<Mutex<Option<Arc<dyn EventSink>>>> = Lazy::new(|| Mutex::new(None));

/// Install (or replace) the process-wide event sink. The shim calls this once at
/// init with its callback bridge.
pub fn set_event_sink(sink: Arc<dyn EventSink>) {
	*SINK.lock().unwrap_or_else(|p| p.into_inner()) = Some(sink);
}

/// Emit an event to the installed sink (no-op if none installed yet).
pub(crate) fn emit(event: CoreEvent) {
	let sink = {
		let guard = SINK.lock().unwrap_or_else(|p| p.into_inner());
		guard.clone()
	};
	if let Some(sink) = sink {
		sink.emit(event);
	}
}
