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

/// Cursor shape, driven from the RN side. Unlike desktop alacritty (where the
/// program can override via DECSCUSR), this is a fixed override for predictability
/// — we always render this shape unless the program hides the cursor. Maps to the
/// rect math in [`crate::content`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CursorStyle {
	#[default]
	Block,
	Beam,
	Underline,
	HollowBlock,
}

impl CursorStyle {
	/// Parse the wire string (RN side). Unknown values fall back to `Block`.
	pub fn from_wire(s: &str) -> Self {
		match s {
			"beam" => Self::Beam,
			"underline" => Self::Underline,
			"hollow" | "hollowBlock" => Self::HollowBlock,
			_ => Self::Block,
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
	/// Inner padding in physical px (the embedder scales logical pt × density).
	pub padding_x: f32,
	pub padding_y: f32,
	/// The cursor shape to render.
	pub cursor_style: CursorStyle,
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
			padding_x: 0.0,
			padding_y: 0.0,
			cursor_style: CursorStyle::Block,
			draw_bold_text_with_bright_colors: true,
		}
	}
}

/// Build a [`ColorScheme`] from raw `(r,g,b)` triples for the 8 normal + 8 bright
/// ANSI colors plus fg/bg/cursor. Keeps the preset table below readable.
fn scheme(
	normal: [(u8, u8, u8); 8],
	bright: [(u8, u8, u8); 8],
	foreground: (u8, u8, u8),
	background: (u8, u8, u8),
	cursor: (u8, u8, u8),
) -> ColorScheme {
	let rgb = |(r, g, b): (u8, u8, u8)| Rgb::new(r, g, b);
	ColorScheme {
		normal: normal.map(rgb),
		bright: bright.map(rgb),
		foreground: rgb(foreground),
		background: rgb(background),
		cursor: rgb(cursor),
	}
}

impl ColorScheme {
	/// Resolve a named preset (RN passes the name). Unknown names → the default
	/// dark scheme. Keep the names in sync with the Settings UI presets.
	pub fn by_name(name: &str) -> Self {
		match name {
			"solarizedDark" => scheme(
				[
					(7, 54, 66),
					(220, 50, 47),
					(133, 153, 0),
					(181, 137, 0),
					(38, 139, 210),
					(211, 54, 130),
					(42, 161, 152),
					(238, 232, 213),
				],
				[
					(0, 43, 54),
					(203, 75, 22),
					(88, 110, 117),
					(101, 123, 131),
					(131, 148, 150),
					(108, 113, 196),
					(147, 161, 161),
					(253, 246, 227),
				],
				(131, 148, 150),
				(0, 43, 54),
				(147, 161, 161),
			),
			"solarizedLight" => scheme(
				[
					(7, 54, 66),
					(220, 50, 47),
					(133, 153, 0),
					(181, 137, 0),
					(38, 139, 210),
					(211, 54, 130),
					(42, 161, 152),
					(238, 232, 213),
				],
				[
					(0, 43, 54),
					(203, 75, 22),
					(88, 110, 117),
					(101, 123, 131),
					(131, 148, 150),
					(108, 113, 196),
					(147, 161, 161),
					(253, 246, 227),
				],
				(101, 123, 131),
				(253, 246, 227),
				(88, 110, 117),
			),
			"dracula" => scheme(
				[
					(33, 34, 44),
					(255, 85, 85),
					(80, 250, 123),
					(241, 250, 140),
					(189, 147, 249),
					(255, 121, 198),
					(139, 233, 253),
					(248, 248, 242),
				],
				[
					(98, 114, 164),
					(255, 110, 110),
					(105, 255, 148),
					(255, 255, 165),
					(214, 172, 255),
					(255, 146, 223),
					(164, 255, 255),
					(255, 255, 255),
				],
				(248, 248, 242),
				(40, 42, 54),
				(248, 248, 242),
			),
			"gruvboxDark" => scheme(
				[
					(40, 40, 40),
					(204, 36, 29),
					(152, 151, 26),
					(215, 153, 33),
					(69, 133, 136),
					(177, 98, 134),
					(104, 157, 106),
					(168, 153, 132),
				],
				[
					(146, 131, 116),
					(251, 73, 52),
					(184, 187, 38),
					(250, 189, 47),
					(131, 165, 152),
					(211, 134, 155),
					(142, 192, 124),
					(235, 219, 178),
				],
				(235, 219, 178),
				(40, 40, 40),
				(235, 219, 178),
			),
			// "default" and anything unknown.
			_ => ColorScheme::default(),
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
