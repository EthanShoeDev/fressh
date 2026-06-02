//! `shim-uniffi` — the thin uniffi binding (shipped first, swappable). (§7, §10)
//!
//! Maps the agnostic `FresshControlSpec` (see docs §10) onto uniffi-exported
//! functions, each delegating to `fressh-core`. Designed to craby's lowest
//! common denominator so the later craby swap is wrapper-replacement only:
//!   - flat, id-keyed fns (no exported objects)
//!   - `Promise<T>` over sync/async entry points
//!   - one-way event sink (uniffi callback interface)
//!   - ArrayBuffer / structs / enums across the boundary
//!
//! Control surface (see §10 FresshControlSpec):
//!   connect, disconnect, respondToHostKey,
//!   startShell, sendData, resize, closeShell,
//!   generateKeyPair, validatePrivateKey
//! Events (one-way): connectProgress | hostKeyPending | connectionClosed | shellClosed

// TODO(scaffold): uniffi::setup_scaffolding!(); export the id-keyed fns above,
// each forwarding to fressh-core.
