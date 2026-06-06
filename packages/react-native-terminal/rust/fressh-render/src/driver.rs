//! High-level render driver: owns the GL `Renderer` + `GlyphCache` + grid
//! sizing, and draws a `Term` each frame. The native view supplies the GL
//! context seam (`get_proc_address` + `is_gles`) and calls `resize`/`draw`.
//! (§5; §10 render plane.)
//!
//! The GL context must be current on the calling thread for every method here.

use std::ffi::{CStr, c_void};
use std::time::Instant;

use alacritty_renderer::config::font::Font;
use alacritty_renderer::display::SizeInfo;
use alacritty_renderer::renderer::rects::RenderRect;
use alacritty_renderer::renderer::{GlyphCache, Renderer};
use alacritty_terminal::Term;
use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions; // brings SizeInfo::{columns, screen_lines} into scope
use alacritty_terminal::term::TermMode;
use alacritty_terminal::vte::ansi::NamedColor;
use crossfont::{Rasterize, Rasterizer};

use crate::config::{CursorStyle, Palette, TerminalConfig, MIN_BLINK_INTERVAL_MS};
use crate::content::{renderable_cells, CursorRender};

/// Cursor bar/outline thickness as a fraction of cell width (alacritty default).
const CURSOR_THICKNESS: f32 = 0.15;

#[derive(Debug, thiserror::Error)]
pub enum RenderError {
	#[error("renderer init failed: {0}")]
	Renderer(String),
	#[error("font/glyph init failed: {0}")]
	Font(String),
}

/// Everything needed to draw a terminal to the current GL context.
pub struct TerminalRenderer {
	renderer: Renderer,
	glyph_cache: GlyphCache,
	size_info: SizeInfo,
	palette: Palette,
	config: TerminalConfig,
	/// Blink phase origin: the cursor is visible for the first half-interval after
	/// this instant, hidden for the second, and so on. Restarted on input (so the
	/// cursor shows immediately on a keystroke) and when blinking (re)activates.
	blink_epoch: Instant,
	/// The shell's input-idle time (ms) seen last frame. A *drop* means a fresh
	/// keystroke arrived since (input idle resets to ~0), which restarts the
	/// phase — mirrors alacritty's `on_typing_start`.
	prev_input_idle_ms: u64,
	/// Whether blinking was active last frame, to detect the off→on edge that
	/// should restart the phase (mirrors alacritty's `update_cursor_blinking`).
	blink_was_active: bool,
}

impl TerminalRenderer {
	/// Build the renderer. The GL context must already be current;
	/// `get_proc_address` loads GL function pointers and `is_gles` selects the
	/// GLES2 vs GLSL3 shaders (the context seam, §5).
	pub fn new(
		get_proc_address: impl FnMut(&CStr) -> *const c_void,
		is_gles: bool,
		config: TerminalConfig,
	) -> Result<Self, RenderError> {
		let renderer = Renderer::new(get_proc_address, is_gles, None)
			.map_err(|err| RenderError::Renderer(format!("{err:?}")))?;

		let rasterizer = Rasterizer::new().map_err(|err| RenderError::Font(err.to_string()))?;
		let font = Font::from_path(&config.font_path, config.font_size_pt);
		let glyph_cache =
			GlyphCache::new(rasterizer, &font).map_err(|err| RenderError::Font(err.to_string()))?;

		let palette = Palette::new(&config.colors);
		let size_info = build_size_info(0.0, 0.0, &glyph_cache, &config);

		Ok(Self {
			renderer,
			glyph_cache,
			size_info,
			palette,
			config,
			blink_epoch: Instant::now(),
			prev_input_idle_ms: 0,
			blink_was_active: false,
		})
	}

	/// Resolve whether the cursor should be drawn this frame, advancing the blink
	/// phase. Mirrors alacritty's `update_cursor_blinking` + the `BlinkCursor`
	/// toggle, but computed from a monotonic clock instead of an event-loop timer
	/// (the draw loop already reposts every vsync, so this animates for free).
	///
	/// `input_idle_ms` is how long since the shell last received user input
	/// (supplied by the control plane, where keystrokes actually land): it drives
	/// the inactivity timeout and — when it drops between frames — restarts the
	/// blink phase so the cursor shows immediately on a keystroke.
	fn cursor_blink_on<T: EventListener>(&mut self, term: &Term<T>, input_idle_ms: u64) -> bool {
		// `blinking_override` forces Never/Always; Off/On defer to the program's
		// DECSCUSR / `CSI ? 12 h/l` state (seeded with the On/Always default at
		// shell creation). Gate on SHOW_CURSOR like upstream.
		let program_blink = term.cursor_style().blinking;
		let active = self.config.cursor_blink.blinking_override().unwrap_or(program_blink)
			&& term.mode().contains(TermMode::SHOW_CURSOR);

		// Restart the phase (cursor shows now) on a fresh keystroke (idle dropped)
		// or on the off→on edge — both mirror alacritty rescheduling the blink.
		if input_idle_ms < self.prev_input_idle_ms || (active && !self.blink_was_active) {
			self.blink_epoch = Instant::now();
		}
		self.prev_input_idle_ms = input_idle_ms;
		self.blink_was_active = active;

		if !active {
			return true;
		}

		// Inactivity timeout (alacritty's `blink_timeout`): once elapsed, stop
		// blinking and leave the cursor visible. `0` disables it. The effective
		// window is at least one full cycle (`interval * 2`).
		let interval_ms = self.config.blink_interval_ms.max(MIN_BLINK_INTERVAL_MS);
		if self.config.blink_timeout_s != 0 {
			let timeout_ms = (interval_ms * 2).max(self.config.blink_timeout_s * 1000);
			if input_idle_ms >= timeout_ms {
				return true;
			}
		}

		// Visible for the even half-intervals, hidden for the odd ones.
		(self.blink_epoch.elapsed().as_millis() / u128::from(interval_ms)) % 2 == 0
	}

	/// Resize to a physical-pixel surface size (DPR already applied by the
	/// embedder). Returns the resulting grid `(columns, rows)` so the caller can
	/// resize the PTY/`Term` to match.
	pub fn resize(&mut self, width_px: f32, height_px: f32) -> (usize, usize) {
		self.size_info = build_size_info(width_px, height_px, &self.glyph_cache, &self.config);
		self.renderer.resize(&self.size_info);
		self.grid_size()
	}

	/// Current grid size in `(columns, rows)`.
	pub fn grid_size(&self) -> (usize, usize) {
		(self.size_info.columns(), self.size_info.screen_lines())
	}

	/// Current cell metrics in physical px: `(cell_width, cell_height, padding_x,
	/// padding_y)`. The render plane publishes these to the control plane so it can
	/// map touch pixels → grid cells for scroll/selection.
	pub fn cell_metrics(&self) -> (f32, f32, f32, f32) {
		(
			self.size_info.cell_width(),
			self.size_info.cell_height(),
			self.size_info.padding_x(),
			self.size_info.padding_y(),
		)
	}

	/// Draw one frame from the terminal state. The caller swaps buffers after.
	/// `input_idle_ms` is the time since the bound shell last received user input
	/// (drives the cursor blink timeout + reset; see [`Self::cursor_blink_on`]).
	pub fn draw<T: EventListener>(&mut self, term: &Term<T>, input_idle_ms: u64) {
		let background = self.palette.color(term.colors(), NamedColor::Background as usize);
		self.renderer.clear(background, 1.0);

		let blink_on = self.cursor_blink_on(term, input_idle_ms);
		let (cells, cursor) = renderable_cells(
			term,
			&self.palette,
			self.config.draw_bold_text_with_bright_colors,
			self.config.cursor_style,
			blink_on,
		);
		self.renderer.draw_cells(&self.size_info, &mut self.glyph_cache, cells.into_iter());

		// Non-block cursors (beam/underline/hollow) overlay as rects after cells.
		if let Some(cursor) = cursor {
			let rects = cursor_rects(&cursor, &self.size_info);
			if !rects.is_empty() {
				let metrics = self.glyph_cache.font_metrics();
				self.renderer.draw_rects(&self.size_info, &metrics, rects);
				// `draw_rects` restores blend state to dual-source (GL_SRC1_COLOR),
				// which is alacritty's normal *desktop* GLSL3 blend but is INVALID on
				// our GLES context — it raises GL_INVALID_ENUM. Functionally harmless
				// (the next frame's draw_cells resets blend), but the error lingers in
				// the GL queue and would be picked up by the strict glGetError check in
				// a later `Renderer::new` (re-attach), failing it. Drain it here.
				// Full write-up + complete-fix options: docs/gles-renderer-blend-limitation.md
				drain_gl_errors();
			}
		}

		self.renderer.finish();
	}

	/// Present a single cleared frame (background color only). Used by the view
	/// before a shell `Term` is bound, so the surface shows the theme background
	/// instead of uninitialized GL memory.
	pub fn present_clear(&mut self) {
		use alacritty_terminal::term::color::Colors;
		let background = self.palette.color(&Colors::default(), NamedColor::Background as usize);
		self.renderer.clear(background, 1.0);
		self.renderer.finish();
	}

	/// Apply a new config at runtime (e.g. from RN props): rebuild the glyph cache
	/// if the font path or size changed, swap the color palette, and store the rest
	/// (padding/cursor/bold are read on the next `resize`/`draw`). The GL context
	/// must be current; the caller should `resize` afterwards so the grid reflows to
	/// the new cell metrics + padding.
	pub fn apply_config(&mut self, config: TerminalConfig) -> Result<(), RenderError> {
		let font_changed = config.font_path != self.config.font_path
			|| (config.font_size_pt - self.config.font_size_pt).abs() >= f32::EPSILON;
		if font_changed {
			let rasterizer = Rasterizer::new().map_err(|err| RenderError::Font(err.to_string()))?;
			let font = Font::from_path(&config.font_path, config.font_size_pt);
			self.glyph_cache = GlyphCache::new(rasterizer, &font)
				.map_err(|err| RenderError::Font(err.to_string()))?;
		}
		self.palette = Palette::new(&config.colors);
		self.config = config;
		// A config change restarts the blink phase (alacritty re-runs
		// `update_cursor_blinking`), so a settings tweak shows the cursor at once.
		self.blink_epoch = Instant::now();
		Ok(())
	}
}

/// Derive a `SizeInfo` from the surface size, the font's cell metrics, and the
/// configured inner padding (physical px).
fn build_size_info(
	width_px: f32,
	height_px: f32,
	glyph_cache: &GlyphCache,
	config: &TerminalConfig,
) -> SizeInfo {
	let metrics = glyph_cache.font_metrics();
	SizeInfo::new(
		width_px,
		height_px,
		metrics.average_advance as f32,
		metrics.line_height as f32,
		config.padding_x,
		config.padding_y,
		false,
	)
}

/// Pixel rects for a non-block cursor. Mirrors alacritty's `display/cursor.rs`
/// math (beam = left bar, underline = bottom bar, hollow = 4-sided outline).
fn cursor_rects(cursor: &CursorRender, size: &SizeInfo) -> Vec<RenderRect> {
	let x = cursor.point.column.0 as f32 * size.cell_width() + size.padding_x();
	let y = cursor.point.line as f32 * size.cell_height() + size.padding_y();
	let width = size.cell_width();
	let height = size.cell_height();
	let thickness = (CURSOR_THICKNESS * width).round().max(1.0);
	let color = cursor.color;

	match cursor.style {
		CursorStyle::Beam => vec![RenderRect::new(x, y, thickness, height, color, 1.0)],
		CursorStyle::Underline => {
			let y = y + height - thickness;
			vec![RenderRect::new(x, y, width, thickness, color, 1.0)]
		}
		CursorStyle::HollowBlock => {
			let vertical_y = y + thickness;
			let vertical_height = height - 2.0 * thickness;
			vec![
				RenderRect::new(x, y, width, thickness, color, 1.0),
				RenderRect::new(x, y + height - thickness, width, thickness, color, 1.0),
				RenderRect::new(x, vertical_y, thickness, vertical_height, color, 1.0),
				RenderRect::new(x + width - thickness, vertical_y, thickness, vertical_height, color, 1.0),
			]
		}
		// Block cursors are rendered as inverted cells in `content`, not rects.
		CursorStyle::Block => Vec::new(),
	}
}

/// Drain the GL error queue (see the call site in `draw`). The GL context must be
/// current. Bounded so a driver that perpetually reports errors can't hang us.
fn drain_gl_errors() {
	use alacritty_renderer::gl;
	// SAFETY: the GL context is current throughout `draw`.
	unsafe {
		let mut guard = 0;
		while gl::GetError() != gl::NO_ERROR && guard < 64 {
			guard += 1;
		}
	}
}
