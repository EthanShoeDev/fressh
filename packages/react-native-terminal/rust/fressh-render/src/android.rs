//! Android EGL bring-up + C-ABI render-plane entry point (PoC). (§5, §10)
//!
//! The native view (Nitro/JNI) creates a `Surface`, obtains its `ANativeWindow*`
//! via `ANativeWindow_fromSurface`, and passes the pointer here. We set up a
//! GLES2 context, build a [`TerminalRenderer`], and draw a hardcoded `Term`.
//! SSH/registry come later — this exists to prove first pixels on a device.

use std::ffi::{CStr, c_char, c_void};

use alacritty_terminal::Term;
use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::Config as TermConfig;
use alacritty_terminal::vte::ansi::Processor;
use khronos_egl as egl;

use crate::config::TerminalConfig;
use crate::driver::TerminalRenderer;

/// Demo content shown by the PoC before SSH is wired.
const DEMO: &str = "\x1b[1;32mfressh\x1b[0m native terminal\r\n\
	\x1b[31mred \x1b[32mgreen \x1b[33myellow \x1b[34mblue\x1b[0m\r\n\
	$ echo it works\r\nit works\r\n$ ";

struct NoopListener;
impl EventListener for NoopListener {}

struct GridDims {
	columns: usize,
	screen_lines: usize,
}
impl Dimensions for GridDims {
	fn total_lines(&self) -> usize {
		self.screen_lines
	}
	fn screen_lines(&self) -> usize {
		self.screen_lines
	}
	fn columns(&self) -> usize {
		self.columns
	}
}

/// EGL loaded dynamically (libEGL.so via dlopen) — see Cargo.toml.
type Egl = egl::DynamicInstance<egl::EGL1_4>;

/// Owns the EGL context + renderer + the demo terminal.
pub struct AndroidTerminal {
	egl: Egl,
	display: egl::Display,
	surface: egl::Surface,
	context: egl::Context,
	renderer: TerminalRenderer,
	term: Term<NoopListener>,
}

impl AndroidTerminal {
	fn create(window: *mut c_void, font_path: &str) -> Result<Self, String> {
		let egl = unsafe { Egl::load_required() }.map_err(|e| format!("load libEGL: {e}"))?;

		let display =
			unsafe { egl.get_display(egl::DEFAULT_DISPLAY) }.ok_or("no EGL display")?;
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
		let config = egl
			.choose_first_config(display, &config_attribs)
			.map_err(|e| format!("eglChooseConfig: {e:?}"))?
			.ok_or("no matching EGL config")?;

		let surface = unsafe {
			egl.create_window_surface(display, config, window as egl::NativeWindowType, None)
		}
		.map_err(|e| format!("eglCreateWindowSurface: {e:?}"))?;

		let context_attribs = [egl::CONTEXT_CLIENT_VERSION, 2, egl::NONE];
		let context = egl
			.create_context(display, config, None, &context_attribs)
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

		let config_data =
			TerminalConfig { font_path: font_path.to_owned(), ..TerminalConfig::default() };
		let mut renderer = TerminalRenderer::new(get_proc, true, config_data)
			.map_err(|e| format!("renderer init: {e}"))?;

		let width = egl.query_surface(display, surface, egl::WIDTH).unwrap_or(0);
		let height = egl.query_surface(display, surface, egl::HEIGHT).unwrap_or(0);
		let (columns, screen_lines) = renderer.resize(width as f32, height as f32);

		let dims = GridDims { columns: columns.max(1), screen_lines: screen_lines.max(1) };
		let mut term = Term::new(TermConfig::default(), &dims, NoopListener);
		let mut parser: Processor = Processor::new();
		parser.advance(&mut term, DEMO.as_bytes());

		Ok(Self { egl, display, surface, context, renderer, term })
	}

	fn draw(&mut self) {
		self.renderer.draw(&self.term);
		let _ = self.egl.swap_buffers(self.display, self.surface);
	}
}

impl Drop for AndroidTerminal {
	fn drop(&mut self) {
		let _ = self.egl.make_current(self.display, None, None, None);
		let _ = self.egl.destroy_surface(self.display, self.surface);
		let _ = self.egl.destroy_context(self.display, self.context);
		let _ = self.egl.terminate(self.display);
	}
}

// ───────────────────────── C-ABI (called by the native view) ─────────────────

/// Create the renderer for an `ANativeWindow*`. Returns null on failure (see
/// logcat). `font_path` is a bundled monospace font file path.
///
/// # Safety
/// `window` must be a valid `ANativeWindow*`; `font_path` a valid C string.
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_create(
	window: *mut c_void,
	font_path: *const c_char,
) -> *mut AndroidTerminal {
	android_logger::init_once(
		android_logger::Config::default().with_max_level(log::LevelFilter::Info),
	);

	let font_path = unsafe { CStr::from_ptr(font_path) }.to_string_lossy().into_owned();
	match AndroidTerminal::create(window, &font_path) {
		Ok(terminal) => Box::into_raw(Box::new(terminal)),
		Err(err) => {
			log::error!("fressh_terminal_create failed: {err}");
			std::ptr::null_mut()
		},
	}
}

/// Draw one frame and swap buffers.
///
/// # Safety
/// `ptr` must be a non-null pointer from [`fressh_terminal_create`].
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_draw(ptr: *mut AndroidTerminal) {
	if let Some(terminal) = unsafe { ptr.as_mut() } {
		terminal.draw();
	}
}

/// Destroy the renderer and tear down EGL.
///
/// # Safety
/// `ptr` must come from [`fressh_terminal_create`] and not be used afterward.
#[no_mangle]
pub unsafe extern "C" fn fressh_terminal_destroy(ptr: *mut AndroidTerminal) {
	if !ptr.is_null() {
		drop(unsafe { Box::from_raw(ptr) });
	}
}
