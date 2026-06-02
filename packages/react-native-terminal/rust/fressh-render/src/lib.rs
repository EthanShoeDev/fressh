//! `fressh-render` — native GLES2 renderer over `alacritty_terminal::Term`.
//! Strategy A (§5). The measured cut-line (§6 "Measured cut-line") splits this
//! crate's work into VENDORED draw code vs OUR code:
//!
//! ## Vendored (from the fork submodule, via path-dep on `alacritty_renderer`)
//! The GL draw machinery: `renderer/{mod,rects,shader}.rs` + `renderer/text/*`
//! (atlas, glyph_cache, glsl3, gles2, builtin_font) + the `res/{gles2,glsl3}`
//! shaders. The fork's lib crate `#[path]`-includes these, regenerates `gl` via
//! a `build.rs`, drops `renderer/platform.rs`, and applies the ONE seam change:
//!   `Renderer::new(context: &PossiblyCurrentContext, ..)`  becomes
//!   `Renderer::new(get_proc_address: impl Fn(&CStr)->*const c_void, is_gles: bool, ..)`
//! `display.rs` and `renderer/platform.rs` are NOT kept — our own EGL context
//! bootstrap lives in the Nitro view. The context seam (get_proc_address +
//! is_gles) comes from our code, so native-EGL -> ANGLE->Metal never touches
//! the vendored code. (§5)
//!
//! ## Ours (NOT vendorable — `display/content.rs` is tangled with config/Display/
//! hints/search, see §6)
//! - `RenderableCell` — we define the struct (shape the vendored text renderer
//!   reads: character, point, fg, bg, bg_alpha, underline, flags,
//!   extra{zerowidth, hyperlink}); Point/Flags/Hyperlink are alacritty_terminal.
//! - the `Term` -> `RenderableCell` iterator — we write it, resolving colors
//!   from OUR palette (not alacritty's UiConfig).
//! - config (§6 "configuration is ours"): a small struct (palette/theme, font
//!   family+size, cursor style, scrollback limit, ...) that is RN-driven —
//!   flows JS <Terminal> props / control plane -> shim -> core -> here. This is
//!   the "configure alacritty from the app" story; alacritty's own TOML/serde/
//!   winit-keybinding config is intentionally NOT vendored.

pub mod config;
pub mod content;

pub use config::{ColorScheme, Palette, TerminalConfig};
pub use content::renderable_cells;

// Re-export the vendored renderer surface. Presence of these in our dependency
// graph alongside `alacritty_terminal` proves the cross-workspace path-dep and
// the single-engine unification compile. (§6)
pub use alacritty_renderer::display::content::{RenderableCell, RenderableCellExtra};
pub use alacritty_renderer::display::SizeInfo;
pub use alacritty_renderer::renderer::{GlyphCache, Renderer};

/// Compile-time proof that our `alacritty_terminal` and the renderer's are the
/// SAME instance: a `Point` from the engine flows into the renderer's cell type.
pub fn _engine_unification_check(point: alacritty_terminal::index::Point<usize>) -> RenderableCell {
	RenderableCell {
		character: ' ',
		point,
		fg: alacritty_renderer::display::color::Rgb::new(0, 0, 0),
		bg: alacritty_renderer::display::color::Rgb::new(0, 0, 0),
		bg_alpha: 0.0,
		underline: alacritty_renderer::display::color::Rgb::new(0, 0, 0),
		flags: alacritty_terminal::term::cell::Flags::empty(),
		extra: None,
	}
}

// TODO(scaffold): define the Term->RenderableCell iterator (ours).
// TODO(scaffold): define the RN-driven config struct (ours) + apply it.
// TODO(scaffold): glyph atlas upload via crossfont; per-frame draw; input mapping.
