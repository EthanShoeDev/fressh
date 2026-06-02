//! Host-key verification as **park/resume** (§7): when russh asks us to verify a
//! server key, we emit a `HostKeyPending` event to JS, park a `oneshot` keyed by
//! the (pre-assigned) connection id, and resume when JS calls
//! [`respond_to_host_key`]. Expressible identically in uniffi and craby.

use dashmap::DashMap;
use futures::future::BoxFuture;
use once_cell::sync::Lazy;
use tokio::sync::oneshot;

use fressh_ssh::{HostKeyVerifier, ServerPublicKeyInfo};

use crate::events::{self, CoreEvent};

static WAITERS: Lazy<DashMap<String, oneshot::Sender<bool>>> = Lazy::new(DashMap::new);

/// The [`HostKeyVerifier`] handed to `fressh-ssh`'s `connect`. Bound to the
/// connection id assigned before the handshake so JS can route its answer back.
pub(crate) struct ParkingVerifier {
	pub connection_id: String,
}

impl HostKeyVerifier for ParkingVerifier {
	fn verify(&self, info: ServerPublicKeyInfo) -> BoxFuture<'static, bool> {
		let connection_id = self.connection_id.clone();
		Box::pin(async move {
			let (tx, rx) = oneshot::channel();
			// If a previous attempt for this id is still parked, drop it.
			WAITERS.insert(connection_id.clone(), tx);
			events::emit(CoreEvent::HostKeyPending { connection_id, info });
			// JS resolves via respond_to_host_key; default to reject if dropped.
			rx.await.unwrap_or(false)
		})
	}
}

/// Resume a parked host-key decision. No-op if nothing is waiting on that id.
pub fn respond_to_host_key(connection_id: &str, accept: bool) {
	if let Some((_id, tx)) = WAITERS.remove(connection_id) {
		let _ = tx.send(accept);
	}
}
