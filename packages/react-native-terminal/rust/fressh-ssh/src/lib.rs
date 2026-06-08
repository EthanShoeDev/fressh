//! `fressh-ssh` — russh wrapper (auth, channels, byte I/O). Binding-agnostic.
//!
//! Ported from `packages/react-native-uniffi-russh/rust/uniffi-russh/src/` with
//! all `#[uniffi::*]` annotations and the JS-facing ring-buffer/broadcast/listener
//! machinery removed. The durable terminal state (the parsed `Term`) now lives in
//! `fressh-core`; this crate only speaks SSH and hands `fressh-core` a clean
//! byte stream + writer. See docs/projects/native-rendering-refactor.md §7, §9, §10.

pub mod connection;
pub mod private_key;
pub mod shell;
pub mod shell_integration;
pub mod utils;

pub use connection::{
	connect, CommandOutput, ConnectOptions, Connection, ConnectionDetails, HostKeyVerifier,
	ProgressCallback, Security, ServerPublicKeyInfo, SshConnectionInfo,
	SshConnectionInfoProgressTimings, SshConnectionProgressEvent,
};
pub use private_key::{generate_key_pair, validate_private_key, KeyType};
pub use shell::{
	Shell, ShellChunk, ShellReader, ShellWriter, StartShellOptions, StreamKind, TerminalMode,
	TerminalPixelSize, TerminalSize, TerminalType,
};
pub use utils::{now_ms, SshError};
