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
	ConnectProgress { connection_id: String, event: SshConnectionProgressEvent },
	HostKeyPending { connection_id: String, info: ServerPublicKeyInfo },
	ConnectionClosed { connection_id: String },
	ShellClosed { shell_id: String },
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
