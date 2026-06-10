//! `DashMap<Id, Arc<…>>` for connections and shells. The registry OWNS session
//! lifetime (§7): dropping a JS handle can't kill a session; only an explicit
//! `disconnect`/`close_shell` removes the pin. This is what enables tmux-style
//! reattach — the `Term` keeps living (and being fed) while no view is mounted.

use std::sync::Arc;

use dashmap::DashMap;
use once_cell::sync::Lazy;

use crate::session::{ConnectionSession, SharedTerm, ShellSession};

static CONNECTIONS: Lazy<DashMap<String, Arc<ConnectionSession>>> = Lazy::new(DashMap::new);
static SHELLS: Lazy<DashMap<String, Arc<ShellSession>>> = Lazy::new(DashMap::new);

pub(crate) fn insert_connection(conn: Arc<ConnectionSession>) {
	CONNECTIONS.insert(conn.connection_id.clone(), conn);
}
pub(crate) fn connection(id: &str) -> Option<Arc<ConnectionSession>> {
	CONNECTIONS.get(id).map(|e| e.clone())
}
pub(crate) fn remove_connection(id: &str) -> Option<Arc<ConnectionSession>> {
	CONNECTIONS.remove(id).map(|(_, v)| v)
}

pub(crate) fn insert_shell(shell: Arc<ShellSession>) {
	SHELLS.insert(shell.shell_id.clone(), shell);
}
pub(crate) fn shell(id: &str) -> Option<Arc<ShellSession>> {
	SHELLS.get(id).map(|e| e.clone())
}
pub(crate) fn remove_shell(id: &str) -> Option<Arc<ShellSession>> {
	SHELLS.remove(id).map(|(_, v)| v)
}
pub(crate) fn shells_for_connection(connection_id: &str) -> Vec<Arc<ShellSession>> {
	SHELLS
		.iter()
		.filter(|e| e.connection_id == connection_id)
		.map(|e| e.clone())
		.collect()
}

/// Render-plane accessor: the shared `Term` for a shell id. The Nitro view's
/// C-ABI looks this up by `shellId` to draw the current grid each frame, then
/// drops the clone — the registry keeps the real one alive. (§10 render plane.)
pub fn shell_term(shell_id: &str) -> Option<SharedTerm> {
	SHELLS.get(shell_id).map(|e| e.term.clone())
}

/// Render-plane accessor: time (ms) since the shell last received user input.
/// Drives the cursor blink timeout/reset; read once per frame alongside the
/// `Term`. `None` if the shell is gone.
pub fn shell_input_idle_ms(shell_id: &str) -> Option<u64> {
	SHELLS.get(shell_id).map(|e| e.input_idle_ms())
}
