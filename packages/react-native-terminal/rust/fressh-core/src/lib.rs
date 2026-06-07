//! `fressh-core` — runtime + registry + sessions. The binding-agnostic boundary.
//!
//! Everything durable and hard lives here so neither the binding tool
//! (uniffi/craby) nor the view (Nitro) leaks into the architecture.
//!
//! ## Planes (see docs/projects/native-rendering-refactor.md §10)
//! - control plane: id-keyed fns wrapped by the shim ([`control`])
//! - event plane:   one-way sink to JS ([`events`])
//! - render plane:  the Nitro view looks up a shell's `Term` via
//!   [`registry::shell_term`] and draws it (C-ABI added in a later stage)
//! - data plane:    SSH bytes → reader loop → `Term` ([`session`]). Never leaves the .so.
//!
//! ## Lifetime
//! The registry owns sessions (tmux-style). Dropping a JS handle can't kill a
//! session; only explicit `disconnect`/`close_shell` removes the pin. (§7, §9)

pub mod control;
pub mod events;
pub mod host_key;
pub mod registry;
pub mod runtime;
pub mod session;
pub mod source;

// --- control plane (wrapped by the binding shim) --------------------------
pub use control::{
	close_shell, connect, create_preview, close_preview, disconnect, generate_key_pair, resize,
	respond_to_host_key, scroll, selection_clear, selection_start, selection_text,
	selection_update, send_data, set_cursor_default_blinking, set_render_metrics, start_shell,
	validate_private_key, SelectionKind,
};

// --- event plane (the shim installs the concrete sink) --------------------
pub use events::{set_event_sink, CoreEvent, EventSink};

// --- render plane (the Nitro view's C-ABI reads this) ---------------------
pub use registry::{shell_input_idle_ms, shell_term};
pub use session::{CoreListener, SharedTerm};

// --- re-exported SSH value types crossing the shim/render boundary --------
pub use fressh_ssh::{
	ConnectionDetails, KeyType, Security, ServerPublicKeyInfo, SshConnectionProgressEvent, SshError,
	StartShellOptions, StreamKind, TerminalMode, TerminalPixelSize, TerminalSize, TerminalType,
};
