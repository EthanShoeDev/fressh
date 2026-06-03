//! RN-driven terminal config + the color palette derived from it.
//!
//! We OWN this (§6): alacritty's TOML/serde config is the wrong shape for React.
//! The embedder (the RN app) supplies these values — including a **bundled
//! monospace font path**, since mobile has no fontconfig discovery.

use alacritty_renderer::display::color::Rgb;
use alacritty_terminal::term::color::{Colors, COUNT};
use alacritty_terminal::vte::ansi::NamedColor;

/// Dim colors are derived as `normal * DIM_FACTOR` (matches alacritty).
const DIM_FACTOR: f32 = 0.66;

/// The 16 ANSI colors + primaries. RN-overridable; defaults to a standard dark
/// scheme.
#[derive(Debug, Clone)]
pub struct ColorScheme {
	/// ANSI 0..8 (black, red, green, yellow, blue, magenta, cyan, white).
	pub normal: [Rgb; 8],
	/// Bright ANSI 8..16.
	pub bright: [Rgb; 8],
	pub foreground: Rgb,
	pub background: Rgb,
	pub cursor: Rgb,
}

impl Default for ColorScheme {
	fn default() -> Self {
		Self {
			normal: [
				Rgb::new(0, 0, 0),
				Rgb::new(170, 0, 0),
				Rgb::new(0, 170, 0),
				Rgb::new(170, 85, 0),
				Rgb::new(0, 0, 170),
				Rgb::new(170, 0, 170),
				Rgb::new(0, 170, 170),
				Rgb::new(170, 170, 170),
			],
			bright: [
				Rgb::new(85, 85, 85),
				Rgb::new(255, 85, 85),
				Rgb::new(85, 255, 85),
				Rgb::new(255, 255, 85),
				Rgb::new(85, 85, 255),
				Rgb::new(255, 85, 255),
				Rgb::new(85, 255, 255),
				Rgb::new(255, 255, 255),
			],
			foreground: Rgb::new(220, 220, 220),
			background: Rgb::new(0, 0, 0),
			cursor: Rgb::new(220, 220, 220),
		}
	}
}

/// Terminal configuration, driven from the RN side.
#[derive(Debug, Clone)]
pub struct TerminalConfig {
	pub colors: ColorScheme,
	/// Path to a bundled monospace `.ttf`/`.otf` (no fontconfig on mobile, §6).
	pub font_path: String,
	pub font_size_pt: f32,
	/// Bounded scrollback so durable sessions can't grow unbounded (§9).
	pub scrollback_lines: usize,
	/// Draw bold text using the bright color variants.
	pub draw_bold_text_with_bright_colors: bool,
}

impl Default for TerminalConfig {
	fn default() -> Self {
		Self {
			colors: ColorScheme::default(),
			font_path: String::new(),
			// Physical px. The embedder normally overrides this (logical pt ×
			// device density); this fallback assumes ~2× density.
			font_size_pt: 32.0,
			scrollback_lines: 10_000,
			draw_bold_text_with_bright_colors: true,
		}
	}
}

/// Resolved 256+13 color table (indexable by `NamedColor as usize` / 0..256),
/// equivalent to alacritty's `display::color::List`.
pub struct Palette {
	list: [Rgb; COUNT],
}

impl Palette {
	pub fn new(scheme: &ColorScheme) -> Self {
		let mut list = [Rgb::default(); COUNT];

		// 0..16: the named ANSI colors.
		list[0..8].copy_from_slice(&scheme.normal);
		list[8..16].copy_from_slice(&scheme.bright);

		// Primaries + dims.
		list[NamedColor::Foreground as usize] = scheme.foreground;
		list[NamedColor::Background as usize] = scheme.background;
		list[NamedColor::Cursor as usize] = scheme.cursor;
		list[NamedColor::BrightForeground as usize] = scheme.foreground;
		list[NamedColor::DimForeground as usize] = dim(scheme.foreground);
		for i in 0..8 {
			list[NamedColor::DimBlack as usize + i] = dim(scheme.normal[i]);
		}

		fill_cube(&mut list);
		fill_gray_ramp(&mut list);

		Self { list }
	}

	/// Resolve a palette index, honoring the terminal's dynamic OSC overrides.
	#[inline]
	pub fn color(&self, overrides: &Colors, index: usize) -> Rgb {
		overrides[index].map(Rgb).unwrap_or(self.list[index])
	}
}

/// 16..232: the 6×6×6 color cube.
fn fill_cube(list: &mut [Rgb; COUNT]) {
	let mut index = 16;
	for r in 0..6u8 {
		for g in 0..6u8 {
			for b in 0..6u8 {
				list[index] = Rgb::new(
					if r == 0 { 0 } else { r * 40 + 55 },
					if g == 0 { 0 } else { g * 40 + 55 },
					if b == 0 { 0 } else { b * 40 + 55 },
				);
				index += 1;
			}
		}
	}
	debug_assert_eq!(index, 232);
}

/// 232..256: the 24-step grayscale ramp.
fn fill_gray_ramp(list: &mut [Rgb; COUNT]) {
	let mut index = 232;
	for i in 0..24u8 {
		let value = i * 10 + 8;
		list[index] = Rgb::new(value, value, value);
		index += 1;
	}
	debug_assert_eq!(index, 256);
}

/// Multiply each channel by `DIM_FACTOR`.
pub(crate) fn dim(color: Rgb) -> Rgb {
	Rgb::new(
		(f32::from(color.0.r) * DIM_FACTOR) as u8,
		(f32::from(color.0.g) * DIM_FACTOR) as u8,
		(f32::from(color.0.b) * DIM_FACTOR) as u8,
	)
}
