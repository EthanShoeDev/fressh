use futures::FutureExt;
use std::{
    future::Future,
    panic::{catch_unwind, AssertUnwindSafe},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;

pub(crate) const CLOSE_TIMEOUT: Duration = Duration::from_millis(500);

pub(crate) fn now_ms() -> f64 {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    d.as_millis() as f64
}

pub(crate) fn catch_foreign_callback_unwind(callback: impl FnOnce()) -> bool {
    catch_unwind(AssertUnwindSafe(callback)).is_ok()
}

pub(crate) async fn catch_foreign_callback_future_unwind<T>(
    callback: impl Future<Output = T>,
) -> Option<T> {
    AssertUnwindSafe(callback).catch_unwind().await.ok()
}

// TODO: Split this into different errors for each public function
#[derive(Debug, Error, uniffi::Error)]
pub enum SshError {
    #[error("Disconnected")]
    Disconnected,
    #[error("Unsupported key type")]
    UnsupportedKeyType,
    #[error("Auth failed: {0}")]
    Auth(String),
    #[error("Shell already running")]
    ShellAlreadyRunning,
    #[error("Tmux attach failed: {0}")]
    TmuxAttachFailed(String),
    #[error("russh error: {0}")]
    Russh(String),
    #[error("russh-keys error: {0}")]
    RusshKeys(String),
}
impl From<russh::Error> for SshError {
    fn from(e: russh::Error) -> Self {
        SshError::Russh(e.to_string())
    }
}
impl From<russh_keys::Error> for SshError {
    fn from(e: russh_keys::Error) -> Self {
        SshError::RusshKeys(e.to_string())
    }
}
impl From<russh_keys::ssh_key::Error> for SshError {
    fn from(e: russh_keys::ssh_key::Error) -> Self {
        SshError::RusshKeys(e.to_string())
    }
}
impl From<russh::keys::ssh_key::Error> for SshError {
    fn from(e: russh::keys::ssh_key::Error) -> Self {
        SshError::RusshKeys(e.to_string())
    }
}
impl From<std::io::Error> for SshError {
    fn from(e: std::io::Error) -> Self {
        SshError::Russh(e.to_string())
    }
}
impl From<russh::client::AuthResult> for SshError {
    fn from(a: russh::client::AuthResult) -> Self {
        SshError::Auth(format!("{a:?}"))
    }
}
