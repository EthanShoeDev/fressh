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

use fressh_core::{runtime, send_data, set_render_metrics, shell_term};
use fressh_render::{ColorScheme, CursorStyle, EglContext, TerminalConfig};
use serde::Deserialize;

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
	/// Resolved bundled-font path, kept so live config updates can rebuild the
	/// glyph cache without RN re-sending it.
	font_path: String,
	shell_id: Option<String>,
	last_state: Option<DrawState>,
	/// The surface buffer size we last reflowed the grid to. We poll the real size
	/// from the draw loop and resize when it actually changes — `eglQuerySurface`
	/// lags the SurfaceView geometry by a frame, so a one-shot read in
	/// `surfaceChanged` is unreliable (esp. on GROW). See `sync_surface_size`.
	last_surface_size: (i32, i32),
}

/// Re-sync the renderer + bound shell to the surface's *current* buffer size, but
/// only when it actually changed since the last sync. Called every frame from the
/// draw loop (which runs after `eglSwapBuffers`, so the queried size has settled)
/// and from `surfaceChanged`. This is what keeps the grid/`SizeInfo`/PTY in lockstep
/// with the on-screen view in BOTH directions when the keyboard opens/closes.
fn sync_surface_size(attached: &mut AttachedTerminal) {
	let size = attached.egl.surface_size();
	if size == attached.last_surface_size || size.0 <= 0 || size.1 <= 0 {
		return;
	}
	attached.last_surface_size = size;
	let (cols, rows) = attached.egl.resize();
	let (cw, ch, px, py) = attached.egl.cell_metrics();
	if let Some(id) = attached.shell_id.clone() {
		set_render_metrics(&id, cw, ch, px, py);
		runtime::handle().spawn(async move {
			let _ = fressh_core::resize(id, cols, rows).await;
		});
	}
}

/// The render config as it crosses the C-ABI: a JSON blob assembled by the Kotlin
/// view from the RN `<Terminal config={...}>` prop. All fields optional (missing →
/// renderer default). Sizes are PHYSICAL px — the JS wrapper already scaled logical
/// pt by device pixel density. This is the "assemble config in RN, pass it" seam.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct WireConfig {
	font_size_px: f32,
	padding_x_px: f32,
	padding_y_px: f32,
	cursor_style: String,
	color_scheme: String,
	bold_is_bright: Option<bool>,
}

/// Parse a `WireConfig` JSON blob (null/empty/invalid → defaults) and fold it onto
/// a [`TerminalConfig`] with the given resolved `font_path`.
fn build_config(font_path: String, config_json: *const c_char) -> TerminalConfig {
	let wire: WireConfig = cstr_opt(config_json)
		.and_then(|s| match serde_json::from_str::<WireConfig>(&s) {
			Ok(w) => Some(w),
			Err(err) => {
				log::warn!("fressh_terminal: config parse failed: {err}; using defaults");
				None
			}
		})
		.unwrap_or_default();

	let mut config = TerminalConfig { font_path, ..TerminalConfig::default() };
	if wire.font_size_px > 0.0 {
		config.font_size_pt = wire.font_size_px;
	}
	config.padding_x = wire.padding_x_px.max(0.0);
	config.padding_y = wire.padding_y_px.max(0.0);
	if !wire.cursor_style.is_empty() {
		config.cursor_style = CursorStyle::from_wire(&wire.cursor_style);
	}
	if !wire.color_scheme.is_empty() {
		config.colors = ColorScheme::by_name(&wire.color_scheme);
	}
	if let Some(bold) = wire.bold_is_bright {
		config.draw_bold_text_with_bright_colors = bold;
	}
	config
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
/// `window` must be a valid `ANativeWindow*`. `font_path`/`config_json`/`shell_id`
/// must each be a valid NUL-terminated C string or null.
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_attach(
	window: *mut c_void,
	font_path: *const c_char,
	config_json: *const c_char,
	shell_id: *const c_char,
) -> *mut AttachedTerminal {
	android_logger::init_once(
		android_logger::Config::default().with_max_level(log::LevelFilter::Info),
	);

	let font_path = cstr_opt(font_path).unwrap_or_default();
	let shell_id = cstr_opt(shell_id);
	let config = build_config(font_path.clone(), config_json);

	log::info!("fressh_terminal_attach: shell_id={shell_id:?} config={config:?}");
	match EglContext::create(window, config) {
		Ok(egl) => {
			log::info!("fressh_terminal_attach: created, grid={:?}", egl.grid_size());
			Box::into_raw(Box::new(AttachedTerminal {
				egl,
				font_path,
				shell_id,
				last_state: None,
				// (0,0) so the first draw-loop sync reflows the grid + Term to the real size.
				last_surface_size: (0, 0),
			}))
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

/// Apply a new render config (JSON, physical px) at runtime: swaps the palette,
/// rebuilds the glyph cache if the font changed, applies padding/cursor, reflows
/// to the surface, and resizes the bound shell's PTY/`Term` to the new grid. Used
/// by the `<Terminal config={...}>` prop / settings. Live config changes are a
/// bonus over desktop alacritty's restart-to-apply.
///
/// # Safety
/// `ptr` must be a non-null handle from [`fressh_terminal_attach`]; `config_json`
/// a valid C string or null.
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_set_config(
	ptr: *mut AttachedTerminal,
	config_json: *const c_char,
) {
	// SAFETY: caller guarantees `ptr` is a live handle from attach.
	let Some(attached) = (unsafe { ptr.as_mut() }) else {
		return;
	};
	let config = build_config(attached.font_path.clone(), config_json);
	let (cols, rows) = attached.egl.set_config(config);
	attached.last_state = None;
	log::info!("fressh_terminal_set_config: grid={cols}x{rows}");
	if let Some(id) = attached.shell_id.clone() {
		let (cw, ch, px, py) = attached.egl.cell_metrics();
		set_render_metrics(&id, cw, ch, px, py);
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
	// Poll the real surface size every frame and reflow if it changed. eglQuerySurface
	// lags the SurfaceView geometry right after a resize, so this (post-swap) is the
	// reliable place to catch keyboard-open/close size changes in both directions.
	sync_surface_size(attached);
	let state = match attached.shell_id.as_deref() {
		Some(id) => match shell_term(id) {
			Some(term) => {
				let term = term.lock().unwrap_or_else(|p| p.into_inner());
				attached.egl.draw_term(&term);
				if attached.last_state != Some(DrawState::Drawn) {
					log::info!(
						"fressh_terminal_draw: DRAWN shell_id={id} surface_grid={:?}",
						attached.egl.grid_size(),
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

/// Surface geometry changed (the SurfaceView's `surfaceChanged`). We don't trust
/// the size read here — `eglQuerySurface` lags the new geometry by a frame — so we
/// just run the same poll the draw loop runs; it no-ops until the size has actually
/// settled and the draw loop then catches it. Kept so a paused draw loop still
/// eventually reflows.
///
/// # Safety
/// `ptr` must be a non-null handle from [`fressh_terminal_attach`].
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_resize(ptr: *mut AttachedTerminal) {
	// SAFETY: caller guarantees `ptr` is a live handle from attach.
	if let Some(attached) = unsafe { ptr.as_mut() } {
		sync_surface_size(attached);
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
