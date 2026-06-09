//! EGL context bring-up around a [`TerminalRenderer`] (§5): Android's system EGL,
//! or ANGLE→Metal on iOS (the same EGL/GLES2 code, a different `libEGL`).
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

/// EGL loaded dynamically (dlopen) — Android's system `libEGL.so`, or ANGLE's
/// `libEGL.dylib` on iOS (§2). iOS uses the EGL 1.5 instance so it can select
/// ANGLE's Metal backend via `eglGetPlatformDisplay` (a 1.5 entry point);
/// Android's system EGL is fine at 1.4.
#[cfg(target_os = "android")]
type Egl = egl::DynamicInstance<egl::EGL1_4>;
#[cfg(target_os = "ios")]
type Egl = egl::DynamicInstance<egl::EGL1_5>;

/// Create the EGL display. Android uses the default system display; iOS routes
/// through ANGLE's Metal backend so alacritty's GLES2 renderer runs over Metal (§5).
#[cfg(target_os = "android")]
fn create_display(egl: &Egl) -> Result<egl::Display, String> {
	unsafe { egl.get_display(egl::DEFAULT_DISPLAY) }.ok_or_else(|| "no EGL display".to_string())
}

/// iOS: select ANGLE's Metal backend. The `EGL_PLATFORM_ANGLE_*` enums are ANGLE
/// extensions (absent from `khronos-egl`), defined inline. NOTE: requires ANGLE's
/// `libEGL` to be loadable at runtime (de-risk step 2, §2) — this path is
/// compile-checked but runtime-unverified until those binaries are vendored.
#[cfg(target_os = "ios")]
fn create_display(egl: &Egl) -> Result<egl::Display, String> {
	const EGL_PLATFORM_ANGLE_ANGLE: egl::Enum = 0x3202;
	const EGL_PLATFORM_ANGLE_TYPE_ANGLE: egl::Attrib = 0x3203;
	const EGL_PLATFORM_ANGLE_TYPE_METAL_ANGLE: egl::Attrib = 0x3489;
	let attribs = [
		EGL_PLATFORM_ANGLE_TYPE_ANGLE,
		EGL_PLATFORM_ANGLE_TYPE_METAL_ANGLE,
		egl::ATTRIB_NONE,
	];
	unsafe { egl.get_platform_display(EGL_PLATFORM_ANGLE_ANGLE, egl::DEFAULT_DISPLAY, &attribs) }
		.map_err(|e| format!("eglGetPlatformDisplay(ANGLE/Metal): {e:?}"))
}

/// Load the EGL entry points. Android dlopens the system `libEGL.so`; iOS resolves
/// from the process image instead — ANGLE's `libEGL` is linked into the app as a
/// framework (podspec `vendored_frameworks`), so dyld has already bound its symbols
/// at launch. There is no `libEGL.dylib` soname to dlopen on iOS, so the default
/// `load_required()` (which looks for `libEGL.so[.1]`) does not apply.
#[cfg(target_os = "android")]
fn load_egl() -> Result<Egl, String> {
	unsafe { Egl::load_required() }.map_err(|e| format!("load libEGL: {e}"))
}

#[cfg(target_os = "ios")]
fn load_egl() -> Result<Egl, String> {
	// ANGLE ships as frameworks EMBEDDED in the app bundle (podspec
	// `vendored_frameworks` → App.app/Frameworks/), but nothing references them at
	// link time (we resolve EGL dynamically), so the linker emits no load command
	// and dyld does NOT auto-load them at launch. So dlopen them explicitly by
	// `@rpath` — dlopen expands it via the app's LC_RPATH (@executable_path/Frameworks).
	// Load libGLESv2 first (libEGL pulls it in but does not statically depend on it)
	// and leak the handle so it stays resident for the process lifetime.
	unsafe {
		let gles = libloading::Library::new("@rpath/libGLESv2.framework/libGLESv2")
			.map_err(|e| format!("dlopen ANGLE libGLESv2: {e}"))?;
		std::mem::forget(gles);
		let egl_lib = libloading::Library::new("@rpath/libEGL.framework/libEGL")
			.map_err(|e| format!("dlopen ANGLE libEGL: {e}"))?;
		Egl::load_required_from(egl_lib).map_err(|e| format!("load ANGLE EGL API: {e}"))
	}
}

/// Owns the EGL context + the GL renderer for one native surface.
pub struct EglContext {
	egl: Egl,
	display: egl::Display,
	surface: egl::Surface,
	context: egl::Context,
	renderer: TerminalRenderer,
}

impl EglContext {
	/// Set up an EGL/GLES2 context for `window` and build a [`TerminalRenderer`]
	/// using the bundled font in `config`. `window` is an `ANativeWindow*` on
	/// Android and a `CAMetalLayer*` on iOS (ANGLE→Metal, §5) — opaque to the EGL
	/// surface creation below.
	pub fn create(window: *mut c_void, config: TerminalConfig) -> Result<Self, String> {
		let egl = load_egl()?;

		let display = create_display(&egl)?;
		egl.initialize(display)
			.map_err(|e| format!("eglInitialize: {e:?}"))?;

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

		let mut ctx = Self {
			egl,
			display,
			surface,
			context,
			renderer,
		};
		ctx.resize();
		Ok(ctx)
	}

	/// Re-query the surface size and resize the renderer. Returns the resulting
	/// grid `(columns, rows)` so the caller can reflow the `Term` + PTY to match.
	pub fn resize(&mut self) -> (usize, usize) {
		self.make_current();
		let (width, height) = self.surface_size();
		self.renderer.resize(width as f32, height as f32)
	}

	/// The EGL surface's current buffer dimensions in physical px, via
	/// `eglQuerySurface`. NOTE: this reflects the size of the buffer from the last
	/// `eglSwapBuffers`, so right after a SurfaceView resize it can lag the new
	/// geometry by a frame — callers should poll it from the draw loop (which swaps
	/// every frame) rather than trusting a one-shot read in `surfaceChanged`.
	pub fn surface_size(&self) -> (i32, i32) {
		let width = self
			.egl
			.query_surface(self.display, self.surface, egl::WIDTH)
			.unwrap_or(0);
		let height = self
			.egl
			.query_surface(self.display, self.surface, egl::HEIGHT)
			.unwrap_or(0);
		(width, height)
	}

	/// The renderer's current grid size in `(columns, rows)`.
	pub fn grid_size(&self) -> (usize, usize) {
		self.renderer.grid_size()
	}

	/// Cell metrics in physical px: `(cell_width, cell_height, padding_x, padding_y)`.
	pub fn cell_metrics(&self) -> (f32, f32, f32, f32) {
		self.renderer.cell_metrics()
	}

	/// Make this context current on the calling thread. Must run before every
	/// frame: we share the UI thread with other GL consumers (react-native-skia
	/// drives its own EGL context every frame), and EGL's current context is
	/// per-thread global state. Binding once at attach is not enough — by the next
	/// vsync another library has made its own context current, so our draws would
	/// target the wrong context (our shader program id isn't valid there ->
	/// glUseProgram fails -> GL_INVALID_OPERATION -> nothing renders).
	fn make_current(&self) {
		let _ = self.egl.make_current(
			self.display,
			Some(self.surface),
			Some(self.surface),
			Some(self.context),
		);
	}

	/// Draw one frame from `term` and present it. `input_idle_ms` is the time
	/// since the bound shell last received user input (drives cursor blink; the
	/// shim reads it from the control plane each frame).
	pub fn draw_term<T: EventListener>(&mut self, term: &Term<T>, input_idle_ms: u64) {
		self.make_current();
		self.renderer.draw(term, input_idle_ms);
		let _ = self.egl.swap_buffers(self.display, self.surface);
	}

	/// Present a cleared (background-only) frame — used before a shell is bound.
	pub fn clear(&mut self) {
		self.make_current();
		self.renderer.present_clear();
		let _ = self.egl.swap_buffers(self.display, self.surface);
	}

	/// Replace the renderer config at runtime (palette/font/padding/cursor), e.g.
	/// from RN props. Rebuilds the glyph cache if the font changed and reflows to
	/// the surface. Returns the resulting grid `(columns, rows)` so the caller can
	/// resize the PTY/`Term`. On font-rebuild failure, keeps the current font.
	pub fn set_config(&mut self, config: TerminalConfig) -> (usize, usize) {
		self.make_current();
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
