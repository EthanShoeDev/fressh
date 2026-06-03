//! Render-plane C-ABI (§10). Called by the Nitro view's JNI bridge (cpp-adapter).
//!
//! An attached view owns an [`EglContext`] (EGL + GL renderer for its surface) and
//! a `shellId`. Each frame it looks the shell's durable `Term` up from
//! `fressh-core`'s registry and draws it — the bytes never came through JS, and the
//! `Term` outlives the view (detach drops only the GL context), so re-attaching is
//! instant with full scrollback (§9). Input/resize are forwarded to the control
//! plane keyed by the same `shellId`.
//!
//! These symbols live in this crate (not a second one) so there is exactly ONE
//! copy of fressh-core's registry `static`s — see the crate-level note in
//! `Cargo.toml`. (§8)

use std::ffi::{c_char, c_void, CStr};
use std::slice;

use fressh_core::{runtime, send_data, shell_term};
use fressh_render::{EglContext, TerminalConfig};

/// Per-frame draw outcome, tracked so we can log on *transitions* only (the draw
/// loop runs at vsync — logging every frame would flood logcat). Purely diagnostic.
#[derive(Clone, Copy, PartialEq)]
enum DrawState {
	Unbound,
	Missing,
	Drawn,
}

/// Opaque handle returned to the native view. `shell_id == None` until bound.
pub struct AttachedTerminal {
	egl: EglContext,
	shell_id: Option<String>,
	last_state: Option<DrawState>,
}

/// Read a C string, treating null/empty as `None`.
fn cstr_opt(ptr: *const c_char) -> Option<String> {
	if ptr.is_null() {
		return None;
	}
	// SAFETY: caller guarantees `ptr` is a valid NUL-terminated C string.
	let s = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
	if s.is_empty() {
		None
	} else {
		Some(s)
	}
}

/// Create an EGL/GLES2 renderer for `window` (an `ANativeWindow*`) and optionally
/// bind it to `shell_id`. Returns null on failure (see logcat).
///
/// # Safety
/// `window` must be a valid `ANativeWindow*`. `font_path`/`shell_id` must each be
/// a valid NUL-terminated C string or null.
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_attach(
	window: *mut c_void,
	font_path: *const c_char,
	font_size_px: f32,
	shell_id: *const c_char,
) -> *mut AttachedTerminal {
	android_logger::init_once(
		android_logger::Config::default().with_max_level(log::LevelFilter::Info),
	);

	let font_path = cstr_opt(font_path).unwrap_or_default();
	let shell_id = cstr_opt(shell_id);
	let mut config = TerminalConfig { font_path, ..TerminalConfig::default() };
	if font_size_px > 0.0 {
		config.font_size_pt = font_size_px;
	}

	log::info!("fressh_terminal_attach: shell_id={shell_id:?}");
	match EglContext::create(window, config) {
		Ok(egl) => {
			log::info!("fressh_terminal_attach: created, grid={:?}", egl.grid_size());
			Box::into_raw(Box::new(AttachedTerminal { egl, shell_id, last_state: None }))
		}
		Err(err) => {
			log::error!("fressh_terminal_attach failed: {err}");
			std::ptr::null_mut()
		}
	}
}

/// (Re)bind the attached view to a shell id (e.g. once `startShell` resolves on
/// the JS side after the view already mounted).
///
/// # Safety
/// `ptr` must come from [`fressh_terminal_attach`]; `shell_id` a valid C string or null.
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_set_shell(
	ptr: *mut AttachedTerminal,
	shell_id: *const c_char,
) {
	// SAFETY: caller guarantees `ptr` is a live handle from attach.
	if let Some(attached) = unsafe { ptr.as_mut() } {
		attached.shell_id = cstr_opt(shell_id);
		attached.last_state = None; // force a fresh transition log
		log::info!("fressh_terminal_set_shell: shell_id={:?}", attached.shell_id);
	}
}

/// Change the font size (physical px) at runtime: rebuilds the glyph cache,
/// reflows to the surface, and resizes the bound shell's PTY/`Term` to the new
/// grid. Used by the `fontSize` view prop / settings.
///
/// # Safety
/// `ptr` must be a non-null handle from [`fressh_terminal_attach`].
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_set_font_size(
	ptr: *mut AttachedTerminal,
	font_size_px: f32,
) {
	// SAFETY: caller guarantees `ptr` is a live handle from attach.
	let Some(attached) = (unsafe { ptr.as_mut() }) else {
		return;
	};
	if font_size_px <= 0.0 {
		return;
	}
	let (cols, rows) = attached.egl.set_font_size(font_size_px);
	attached.last_state = None;
	log::info!("fressh_terminal_set_font_size: {font_size_px}px grid={cols}x{rows}");
	if let Some(id) = attached.shell_id.clone() {
		runtime::handle().spawn(async move {
			let _ = fressh_core::resize(id, cols, rows).await;
		});
	}
}

/// Draw one frame: the bound shell's `Term`, or a cleared frame if none.
///
/// # Safety
/// `ptr` must be a non-null handle from [`fressh_terminal_attach`].
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_draw(ptr: *mut AttachedTerminal) {
	// SAFETY: caller guarantees `ptr` is a live handle from attach.
	let Some(attached) = (unsafe { ptr.as_mut() }) else {
		return;
	};
	let state = match attached.shell_id.as_deref() {
		Some(id) => match shell_term(id) {
			Some(term) => {
				let term = term.lock().unwrap_or_else(|p| p.into_inner());
				attached.egl.draw_term(&term);
				if attached.last_state != Some(DrawState::Drawn) {
					log::info!(
						"fressh_terminal_draw: DRAWN shell_id={id} grid={:?}",
						attached.egl.grid_size()
					);
				}
				DrawState::Drawn
			}
			None => {
				if attached.last_state != Some(DrawState::Missing) {
					log::warn!("fressh_terminal_draw: shell_term MISS for shell_id={id}");
				}
				attached.egl.clear();
				DrawState::Missing
			}
		},
		None => {
			if attached.last_state != Some(DrawState::Unbound) {
				log::info!("fressh_terminal_draw: UNBOUND (no shell_id)");
			}
			attached.egl.clear();
			DrawState::Unbound
		}
	};
	attached.last_state = Some(state);
}

/// Re-query the surface size, resize the renderer, and reflow the bound shell's
/// `Term` + PTY to the new grid.
///
/// # Safety
/// `ptr` must be a non-null handle from [`fressh_terminal_attach`].
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_resize(ptr: *mut AttachedTerminal) {
	// SAFETY: caller guarantees `ptr` is a live handle from attach.
	let Some(attached) = (unsafe { ptr.as_mut() }) else {
		return;
	};
	let (cols, rows) = attached.egl.resize();
	log::info!("fressh_terminal_resize: grid={cols}x{rows} shell_id={:?}", attached.shell_id);
	if let Some(id) = attached.shell_id.clone() {
		runtime::handle().spawn(async move {
			let _ = fressh_core::resize(id, cols, rows).await;
		});
	}
}

/// Send user input (stdin) to the bound shell.
///
/// # Safety
/// `ptr` must be a non-null handle from [`fressh_terminal_attach`]; `data` must
/// point to `len` valid bytes (or be null when `len == 0`).
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_send_input(
	ptr: *mut AttachedTerminal,
	data: *const u8,
	len: usize,
) {
	// SAFETY: caller guarantees `ptr` is a live handle from attach.
	let Some(attached) = (unsafe { ptr.as_ref() }) else {
		return;
	};
	let Some(id) = attached.shell_id.clone() else {
		return;
	};
	if data.is_null() || len == 0 {
		return;
	}
	// SAFETY: caller guarantees `data..data+len` is a valid byte range.
	let bytes = unsafe { slice::from_raw_parts(data, len) }.to_vec();
	runtime::handle().spawn(async move {
		let _ = send_data(id, bytes).await;
	});
}

/// Drop the EGL context. The shell's `Term` stays alive in the registry, so a
/// later [`fressh_terminal_attach`] to the same `shellId` resumes instantly (§9).
///
/// # Safety
/// `ptr` must come from [`fressh_terminal_attach`] and not be used afterward.
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_destroy(ptr: *mut AttachedTerminal) {
	if !ptr.is_null() {
		// SAFETY: caller guarantees `ptr` came from attach and is used once.
		drop(unsafe { Box::from_raw(ptr) });
	}
}
