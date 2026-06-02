//! `fressh-core` — runtime + registry + sessions. The binding-agnostic boundary.
//!
//! Everything durable and hard lives here so neither the binding tool
//! (uniffi/craby) nor the view (Nitro) leaks into the architecture.
//!
//! ## Planes (see docs/projects/native-rendering-refactor.md §10)
//! - control plane: id-keyed fns wrapped by the shim (connect/start/send/…)
//! - event plane:   one-way sink to JS (progress/hostKeyPending/closed)
//! - render plane:  C-ABI the Nitro view calls (attach/render_frame/input)
//! - data plane:    SSH bytes -> reader loop -> Term. Never leaves the .so.
//!
//! ## Lifetime
//! The registry owns sessions (tmux-style). Dropping a JS handle can't kill a
//! session; only explicit `disconnect(id)` removes the pin. (§7, §9)

// --- modules (stubs) -------------------------------------------------------

/// Self-hosted tokio runtime + accessor (`Handle`). NOT driven by the binding
/// tool — that's what keeps the core agnostic. (§7)
pub mod runtime {
	// TODO(scaffold): `static RUNTIME: OnceCell<tokio::runtime::Runtime>` + handle().
}

/// `DashMap<Id, Arc<Session>>`. Owns session lifetime. (§7)
pub mod registry {
	// TODO(scaffold): static REGISTRY + insert/get/remove keyed by string ids.
}

/// `Session = connection + shells + Term + reader task`. The reader loop feeds
/// `Term` continuously in the background, view or no view. (§9)
pub mod session {
	// TODO(scaffold): Session struct; spawn reader loop; bounded scrollback.
}

/// Host-key verification as park/resume: emit `hostKeyPending`, park a
/// `oneshot` keyed by connId, resume on `respond_to_host_key(id, accept)`.
/// Expressible identically in uniffi and craby. (§7)
pub mod host_key {
	// TODO(scaffold): pending-map of oneshot senders + respond fn.
}

/// One-way event sink to JS (the shim provides the concrete emitter). (§10)
pub mod events {
	// TODO(scaffold): trait EventSink { fn emit(&self, ev: Event); }
}

/// The C-ABI the Nitro view links against for the render plane. (§8, §10)
pub mod ffi {
	// TODO(scaffold): extern "C" attach/detach/render_frame/send_input;
	// generate the header via cbindgen in build.rs.
}
