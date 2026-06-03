//! Android EGL context bring-up around a [`TerminalRenderer`] (§5).
//!
//! This is a *pure renderer* surface: it owns the EGL display/surface/context and
//! a `TerminalRenderer`, and draws whatever `Term` it's handed. It does NOT own
//! the `Term` and exposes NO C-ABI — the render-plane C-ABI lives in the single
//! native crate (`shim-uniffi`), which looks the `Term` up from `fressh-core`'s
//! registry by `shellId` and calls [`EglContext::draw_term`]. (§8, §10)

use std::ffi::{c_void, CStr};

use alacritty_terminal::event::EventListener;
use alacritty_terminal::Term;
use khronos_egl as egl;

use crate::config::TerminalConfig;
use crate::driver::TerminalRenderer;

/// EGL loaded dynamically (libEGL.so via dlopen) — see Cargo.toml.
type Egl = egl::DynamicInstance<egl::EGL1_4>;

/// Owns the EGL context + the GL renderer for one native surface.
pub struct EglContext {
	egl: Egl,
	display: egl::Display,
	surface: egl::Surface,
	context: egl::Context,
	renderer: TerminalRenderer,
}

impl EglContext {
	/// Set up an EGL/GLES2 context for `window` (an `ANativeWindow*`) and build a
	/// [`TerminalRenderer`] using the bundled font in `config`.
	pub fn create(window: *mut c_void, config: TerminalConfig) -> Result<Self, String> {
		let egl = unsafe { Egl::load_required() }.map_err(|e| format!("load libEGL: {e}"))?;

		let display = unsafe { egl.get_display(egl::DEFAULT_DISPLAY) }.ok_or("no EGL display")?;
		egl.initialize(display).map_err(|e| format!("eglInitialize: {e:?}"))?;

		let config_attribs = [
			egl::SURFACE_TYPE,
			egl::WINDOW_BIT,
			egl::RENDERABLE_TYPE,
			egl::OPENGL_ES2_BIT,
			egl::RED_SIZE,
			8,
			egl::GREEN_SIZE,
			8,
			egl::BLUE_SIZE,
			8,
			egl::ALPHA_SIZE,
			8,
			egl::NONE,
		];
		let egl_config = egl
			.choose_first_config(display, &config_attribs)
			.map_err(|e| format!("eglChooseConfig: {e:?}"))?
			.ok_or("no matching EGL config")?;

		let surface = unsafe {
			egl.create_window_surface(display, egl_config, window as egl::NativeWindowType, None)
		}
		.map_err(|e| format!("eglCreateWindowSurface: {e:?}"))?;

		let context_attribs = [egl::CONTEXT_CLIENT_VERSION, 2, egl::NONE];
		let context = egl
			.create_context(display, egl_config, None, &context_attribs)
			.map_err(|e| format!("eglCreateContext: {e:?}"))?;

		egl.make_current(display, Some(surface), Some(surface), Some(context))
			.map_err(|e| format!("eglMakeCurrent: {e:?}"))?;

		// GL function loader via eglGetProcAddress (GLES2 is detected by the seam).
		let get_proc = |name: &CStr| -> *const c_void {
			match name.to_str().ok().and_then(|n| egl.get_proc_address(n)) {
				Some(f) => f as *const c_void,
				None => std::ptr::null(),
			}
		};

		let renderer = TerminalRenderer::new(get_proc, true, config)
			.map_err(|e| format!("renderer init: {e}"))?;

		let mut ctx = Self { egl, display, surface, context, renderer };
		ctx.resize();
		Ok(ctx)
	}

	/// Re-query the surface size and resize the renderer. Returns the resulting
	/// grid `(columns, rows)` so the caller can reflow the `Term` + PTY to match.
	pub fn resize(&mut self) -> (usize, usize) {
		let width = self.egl.query_surface(self.display, self.surface, egl::WIDTH).unwrap_or(0);
		let height = self.egl.query_surface(self.display, self.surface, egl::HEIGHT).unwrap_or(0);
		self.renderer.resize(width as f32, height as f32)
	}

	/// The renderer's current grid size in `(columns, rows)`.
	pub fn grid_size(&self) -> (usize, usize) {
		self.renderer.grid_size()
	}

	/// Draw one frame from `term` and present it.
	pub fn draw_term<T: EventListener>(&mut self, term: &Term<T>) {
		self.renderer.draw(term);
		let _ = self.egl.swap_buffers(self.display, self.surface);
	}

	/// Present a cleared (background-only) frame — used before a shell is bound.
	pub fn clear(&mut self) {
		self.renderer.present_clear();
		let _ = self.egl.swap_buffers(self.display, self.surface);
	}

	/// Replace the renderer config at runtime (palette/font/padding/cursor), e.g.
	/// from RN props. Rebuilds the glyph cache if the font changed and reflows to
	/// the surface. Returns the resulting grid `(columns, rows)` so the caller can
	/// resize the PTY/`Term`. On font-rebuild failure, keeps the current font.
	pub fn set_config(&mut self, config: TerminalConfig) -> (usize, usize) {
		if let Err(err) = self.renderer.apply_config(config) {
			log::error!("set_config: apply_config failed: {err}");
			return self.grid_size();
		}
		self.resize()
	}
}

impl Drop for EglContext {
	fn drop(&mut self) {
		let _ = self.egl.make_current(self.display, None, None, None);
		let _ = self.egl.destroy_surface(self.display, self.surface);
		let _ = self.egl.destroy_context(self.display, self.context);
		let _ = self.egl.terminate(self.display);
	}
}
