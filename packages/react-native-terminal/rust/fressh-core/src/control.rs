//! The control plane: id-keyed `async` functions the binding shim wraps (§10).
//! These are the only entry points JS reaches through the shim; each delegates to
//! the registry + sessions and runs its work on the core runtime via
//! [`runtime::run`] so russh's internal tasks land on our runtime, not the shim's.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::term::{viewport_to_point, TermMode};
use alacritty_terminal::Term;

use fressh_ssh::{
	ConnectOptions, ConnectionDetails, KeyType, ProgressCallback, StartShellOptions, SshError,
};

use crate::events::{self, CoreEvent};
use crate::host_key::{self, ParkingVerifier};
use crate::session::{ConnectionSession, CoreListener, RenderMetrics, ShellSession};
use crate::{registry, runtime};

static CONN_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_connection_id(details: &ConnectionDetails) -> String {
	let n = CONN_COUNTER.fetch_add(1, Ordering::Relaxed);
	format!("{}@{}:{}#{}", details.username, details.host, details.port, n)
}

/// Establish + authenticate a connection. The connection id is assigned up front
/// so the `hostKeyPending` event (emitted mid-handshake, before this resolves)
/// can be answered with `respond_to_host_key(connectionId, …)`. (§7)
pub async fn connect(details: ConnectionDetails) -> Result<String, SshError> {
	runtime::run(async move {
		let connection_id = next_connection_id(&details);

		let verifier = Arc::new(ParkingVerifier { connection_id: connection_id.clone() });

		let progress_conn_id = connection_id.clone();
		let on_progress: ProgressCallback = Arc::new(move |event| {
			events::emit(CoreEvent::ConnectProgress {
				connection_id: progress_conn_id.clone(),
				event,
			});
		});

		let conn = fressh_ssh::connect(ConnectOptions {
			details,
			verifier,
			on_progress: Some(on_progress),
		})
		.await?;

		registry::insert_connection(Arc::new(ConnectionSession {
			connection_id: connection_id.clone(),
			inner: Arc::new(conn),
		}));
		Ok(connection_id)
	})
	.await
}

/// Resume a parked host-key decision (accept/reject the server key). (§7)
pub fn respond_to_host_key(connection_id: &str, accept: bool) {
	host_key::respond_to_host_key(connection_id, accept);
}

/// Open a PTY + shell on a connection, returning the new shell id. The reader
/// loop starts immediately, feeding the durable `Term`.
pub async fn start_shell(
	connection_id: String,
	opts: StartShellOptions,
	cols: usize,
	rows: usize,
	scrollback_lines: usize,
) -> Result<String, SshError> {
	runtime::run(async move {
		let conn = registry::connection(&connection_id)
			.ok_or_else(|| SshError::NotFound(connection_id.clone()))?;
		let shell = conn.inner.open_shell(opts).await?;
		let shell_id = format!("{}:{}", connection_id, shell.channel_id);
		let session = ShellSession::spawn(
			shell_id.clone(),
			connection_id,
			shell,
			cols,
			rows,
			scrollback_lines,
		);
		registry::insert_shell(session);
		Ok(shell_id)
	})
	.await
}

/// Send user input (stdin) to a shell.
pub async fn send_data(shell_id: String, data: Vec<u8>) -> Result<(), SshError> {
	let shell =
		registry::shell(&shell_id).ok_or_else(|| SshError::NotFound(shell_id.clone()))?;
	runtime::run(async move { shell.send_data(&data).await }).await
}

/// Resize a shell's terminal (reflow `Term` + SSH window-change).
pub async fn resize(shell_id: String, cols: usize, rows: usize) -> Result<(), SshError> {
	let shell =
		registry::shell(&shell_id).ok_or_else(|| SshError::NotFound(shell_id.clone()))?;
	runtime::run(async move { shell.resize(cols, rows).await }).await
}

// ─────────────────────────── touch interaction (scroll + selection) ──────────
//
// Gestures live in JS and call these by `shellId` (like `send_data`). Coordinates
// are NORMALIZED fractions of the on-screen terminal view (0..1), NOT pixels: JS
// measures the live view size and divides. We map the fraction onto the grid's
// columns/rows directly, so this is immune to the SurfaceView buffer / cell metrics
// ever lagging the view size — whatever is visible IS the grid, and a fraction of
// the view is the same fraction of the grid.

/// Which kind of text selection to start. Mirrors alacritty's `SelectionType`.
#[derive(Clone, Copy)]
pub enum SelectionKind {
	/// Track cells exactly as dragged.
	Simple,
	/// Expand to word boundaries (long-press default).
	Word,
	/// Select whole lines.
	Line,
}

/// Seed a shell's `Term` default cursor blink (the `On`/`Off` default a program
/// can override). Called by the render plane when the blink config is applied, so
/// `On`/`Always` start blinking on already-open shells. No-op if the shell is gone.
pub fn set_cursor_default_blinking(shell_id: &str, blinking: bool) {
	if let Some(shell) = registry::shell(shell_id) {
		shell.set_cursor_default_blinking(blinking);
	}
}

/// Record the renderer's current cell metrics for a shell. Still called by the
/// render plane on resize; retained for diagnostics (the touch mapping works in
/// grid fractions now and no longer reads these).
pub fn set_render_metrics(
	shell_id: &str,
	cell_width: f32,
	cell_height: f32,
	padding_x: f32,
	padding_y: f32,
) {
	if let Some(shell) = registry::shell(shell_id) {
		*shell.metrics.lock().unwrap_or_else(|p| p.into_inner()) =
			RenderMetrics { cell_width, cell_height, padding_x, padding_y };
	}
}

/// Scroll by `dy_frac` = vertical drag distance as a fraction of the view height
/// (positive = finger dragged down = reveal older content). Converted to whole grid
/// rows (× screen_lines), carrying the sub-row remainder forward for smooth slow
/// drags. Honors mouse-reporting / alt-screen modes; else moves scrollback.
pub async fn scroll(shell_id: String, dy_frac: f32) -> Result<(), SshError> {
	let shell =
		registry::shell(&shell_id).ok_or_else(|| SshError::NotFound(shell_id.clone()))?;

	let bytes = {
		let mut term = shell.term.lock().unwrap_or_else(|p| p.into_inner());
		let screen_lines = term.grid().screen_lines().max(1) as f32;
		let lines = {
			let mut rem = shell.scroll_remainder.lock().unwrap_or_else(|p| p.into_inner());
			let total = *rem + dy_frac * screen_lines;
			let whole = total.trunc();
			*rem = total - whole;
			whole as i32
		};
		if lines == 0 {
			None
		} else {
			let mode = *term.mode();
			if mode.intersects(TermMode::MOUSE_MODE) {
				Some(wheel_report(mode, lines))
			} else if mode.contains(TermMode::ALT_SCREEN) {
				Some(arrow_keys(mode, lines))
			} else {
				term.scroll_display(Scroll::Delta(lines));
				None
			}
		}
	};

	if let Some(bytes) = bytes {
		runtime::run(async move { shell.send_data(&bytes).await }).await?;
	}
	Ok(())
}

/// Begin a selection at a normalized view point (`fx`, `fy` ∈ 0..1). Replaces any
/// existing selection.
pub fn selection_start(shell_id: &str, fx: f32, fy: f32, kind: SelectionKind) {
	let Some(shell) = registry::shell(shell_id) else {
		return;
	};
	let mut term = shell.term.lock().unwrap_or_else(|p| p.into_inner());
	let (point, side) = frac_to_point(&term, fx, fy);
	let ty = match kind {
		SelectionKind::Simple => SelectionType::Simple,
		SelectionKind::Word => SelectionType::Semantic,
		SelectionKind::Line => SelectionType::Lines,
	};
	term.selection = Some(Selection::new(ty, point, side));
	// A following drag extends the selection — don't let leftover scroll remainder
	// bleed into it.
	*shell.scroll_remainder.lock().unwrap_or_else(|p| p.into_inner()) = 0.0;
}

/// Extend the active selection to a normalized view point. No-op if none.
pub fn selection_update(shell_id: &str, fx: f32, fy: f32) {
	let Some(shell) = registry::shell(shell_id) else {
		return;
	};
	let mut term = shell.term.lock().unwrap_or_else(|p| p.into_inner());
	let (point, side) = frac_to_point(&term, fx, fy);
	if let Some(selection) = term.selection.as_mut() {
		selection.update(point, side);
	}
}

/// Clear any active selection.
pub fn selection_clear(shell_id: &str) {
	if let Some(shell) = registry::shell(shell_id) {
		shell.term.lock().unwrap_or_else(|p| p.into_inner()).selection = None;
	}
}

/// The currently selected text, if any (empty selections return `None`).
pub fn selection_text(shell_id: &str) -> Option<String> {
	let shell = registry::shell(shell_id)?;
	let term = shell.term.lock().unwrap_or_else(|p| p.into_inner());
	term.selection_to_string().filter(|s| !s.is_empty())
}

/// Map a normalized view point (`fx`, `fy` ∈ 0..1) to a grid `Point` + cell side,
/// accounting for the current scrollback offset. Grid-fraction based (no pixel
/// metrics), so it cannot drift from the surface buffer size.
fn frac_to_point(term: &Term<CoreListener>, fx: f32, fy: f32) -> (Point, Side) {
	let columns = term.grid().columns().max(1);
	let screen_lines = term.grid().screen_lines().max(1);
	let display_offset = term.grid().display_offset();
	let fx = fx.clamp(0.0, 1.0);
	let fy = fy.clamp(0.0, 1.0);
	let col_f = fx * columns as f32;
	let col = (col_f as usize).min(columns - 1);
	let viewport_line = ((fy * screen_lines as f32) as usize).min(screen_lines - 1);
	let side = if (col_f - col as f32) < 0.5 { Side::Left } else { Side::Right };
	let point = viewport_to_point(display_offset, Point::new(viewport_line, Column(col)));
	(point, side)
}

/// Encode mouse wheel reports for an app in mouse-reporting mode. Positive `lines`
/// (finger dragged down) = wheel up (older content). Reported at the top-left cell
/// — for scrolling, apps care about the wheel button, not the exact position.
fn wheel_report(mode: TermMode, lines: i32) -> Vec<u8> {
	let count = lines.unsigned_abs() as usize;
	let button: i32 = if lines > 0 { 64 } else { 65 }; // 64 = wheel up, 65 = wheel down
	let mut out = Vec::new();
	for _ in 0..count {
		if mode.contains(TermMode::SGR_MOUSE) {
			out.extend_from_slice(format!("\x1b[<{button};1;1M").as_bytes());
		} else {
			out.extend_from_slice(&[0x1b, b'[', b'M', (32 + button) as u8, 33, 33]);
		}
	}
	out
}

/// Encode cursor-key presses for an alt-screen app without its own scrollback.
/// Positive `lines` (finger down) = scroll toward older content = Up arrow.
fn arrow_keys(mode: TermMode, lines: i32) -> Vec<u8> {
	let count = lines.unsigned_abs() as usize;
	let app_cursor = mode.contains(TermMode::APP_CURSOR);
	let seq: &[u8] = match (lines > 0, app_cursor) {
		(true, false) => b"\x1b[A",
		(true, true) => b"\x1bOA",
		(false, false) => b"\x1b[B",
		(false, true) => b"\x1bOB",
	};
	seq.repeat(count)
}

/// Close a shell channel and drop its `Term`.
pub async fn close_shell(shell_id: String) -> Result<(), SshError> {
	if let Some(shell) = registry::remove_shell(&shell_id) {
		runtime::run(async move { shell.close().await }).await;
		events::emit(CoreEvent::ShellClosed { shell_id });
	}
	Ok(())
}

/// Disconnect a connection: close its shells, then drop the connection.
pub async fn disconnect(connection_id: String) -> Result<(), SshError> {
	runtime::run(async move {
		for shell in registry::shells_for_connection(&connection_id) {
			registry::remove_shell(&shell.shell_id);
			shell.close().await;
			events::emit(CoreEvent::ShellClosed { shell_id: shell.shell_id.clone() });
		}
		if let Some(conn) = registry::remove_connection(&connection_id) {
			let _ = conn.inner.disconnect().await;
			events::emit(CoreEvent::ConnectionClosed { connection_id });
		}
		Ok(())
	})
	.await
}

/// Generate a new key pair (OpenSSH private-key string). Sync; no runtime needed.
pub fn generate_key_pair(key_type: KeyType) -> Result<String, SshError> {
	fressh_ssh::generate_key_pair(key_type)
}

/// Validate a private key, returning its canonical OpenSSH form. Sync.
pub fn validate_private_key(pem: &str) -> Result<String, SshError> {
	fressh_ssh::validate_private_key(pem)
}
