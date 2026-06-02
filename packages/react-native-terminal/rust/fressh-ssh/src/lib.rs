//! `fressh-ssh` — russh wrapper (auth, channels, byte I/O). Binding-agnostic.
//!
//! Port target: the russh logic currently in
//! `packages/react-native-uniffi-russh/rust/uniffi-russh/src/`:
//!   - `ssh_connection.rs` — connect/auth, host-key verification, channels
//!   - `ssh_shell.rs`      — shell channel, the persistent reader loop
//!   - `private_key.rs`    — key generation/validation
//!
//! What changes vs the original: strip every `#[uniffi::...]` annotation and the
//! `uniffi`-shaped callback traits. This crate exposes plain Rust types/Futures.
//! Lifetime + the tokio runtime live in `fressh-core` (the registry owns
//! sessions); this crate just speaks SSH.
//!
//! See docs/projects/native-rendering-refactor.md §7, §10.

// TODO(scaffold): port connection/auth/channel/shell/key logic here.
