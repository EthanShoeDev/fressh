//! Self-hosted tokio runtime. NOT driven by the binding tool — that's what keeps
//! the core agnostic (§7). All persistent work (the russh session task, the
//! per-shell reader loop, PTY-response drains) is spawned onto THIS runtime via
//! [`handle`], so it lives independently of whichever shim (uniffi/craby) is
//! awaiting a control-plane future.

use once_cell::sync::OnceCell;
use tokio::runtime::{Builder, Handle, Runtime};

static RUNTIME: OnceCell<Runtime> = OnceCell::new();

fn runtime() -> &'static Runtime {
	RUNTIME.get_or_init(|| {
		Builder::new_multi_thread()
			.enable_all()
			.thread_name("fressh-core")
			.build()
			.expect("failed to build fressh-core tokio runtime")
	})
}

/// A handle to the core runtime. Spawn persistent tasks here.
pub fn handle() -> Handle {
	runtime().handle().clone()
}

/// Run `fut` to completion **on the core runtime** and return its output.
///
/// Control-plane entry points use this so the actual work (and any tasks russh
/// spawns internally via `Handle::current()`) runs on our runtime, not on the
/// shim's. The returned future just awaits the spawned task, so it can itself be
/// awaited from any executor (uniffi/craby).
pub async fn run<F, T>(fut: F) -> T
where
	F: std::future::Future<Output = T> + Send + 'static,
	T: Send + 'static,
{
	handle()
		.spawn(fut)
		.await
		.expect("core runtime task panicked")
}
