//! High-level render driver: owns the GL `Renderer` + `GlyphCache` + grid
//! sizing, and draws a `Term` each frame. The native view supplies the GL
//! context seam (`get_proc_address` + `is_gles`) and calls `resize`/`draw`.
//! (§5; §10 render plane.)
//!
//! The GL context must be current on the calling thread for every method here.

use std::ffi::{CStr, c_void};

use alacritty_renderer::config::font::Font;
use alacritty_renderer::display::SizeInfo;
use alacritty_renderer::renderer::{GlyphCache, Renderer};
use alacritty_terminal::Term;
use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions; // brings SizeInfo::{columns, screen_lines} into scope
use alacritty_terminal::vte::ansi::NamedColor;
use crossfont::{Rasterize, Rasterizer};

use crate::config::{Palette, TerminalConfig};
use crate::content::renderable_cells;

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
		let size_info = build_size_info(0.0, 0.0, &glyph_cache);

		Ok(Self { renderer, glyph_cache, size_info, palette, config })
	}

	/// Resize to a physical-pixel surface size (DPR already applied by the
	/// embedder). Returns the resulting grid `(columns, rows)` so the caller can
	/// resize the PTY/`Term` to match.
	pub fn resize(&mut self, width_px: f32, height_px: f32) -> (usize, usize) {
		self.size_info = build_size_info(width_px, height_px, &self.glyph_cache);
		self.renderer.resize(&self.size_info);
		self.grid_size()
	}

	/// Current grid size in `(columns, rows)`.
	pub fn grid_size(&self) -> (usize, usize) {
		(self.size_info.columns(), self.size_info.screen_lines())
	}

	/// Draw one frame from the terminal state. The caller swaps buffers after.
	pub fn draw<T: EventListener>(&mut self, term: &Term<T>) {
		let background = self.palette.color(term.colors(), NamedColor::Background as usize);
		self.renderer.clear(background, 1.0);

		let cells =
			renderable_cells(term, &self.palette, self.config.draw_bold_text_with_bright_colors);
		self.renderer.draw_cells(&self.size_info, &mut self.glyph_cache, cells.into_iter());

		self.renderer.finish();
	}

	/// Replace the config (palette/font/etc.) at runtime, e.g. from RN props.
	/// Font changes require rebuilding the glyph cache (TODO).
	pub fn set_palette(&mut self, config: TerminalConfig) {
		self.palette = Palette::new(&config.colors);
		self.config = config;
	}
}

/// Derive a `SizeInfo` from the surface size and the font's cell metrics.
fn build_size_info(width_px: f32, height_px: f32, glyph_cache: &GlyphCache) -> SizeInfo {
	let metrics = glyph_cache.font_metrics();
	SizeInfo::new(
		width_px,
		height_px,
		metrics.average_advance as f32,
		metrics.line_height as f32,
		0.0,
		0.0,
		false,
	)
}
