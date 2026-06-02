//! `Term` → `RenderableCell` mapping. We OWN this (§6): alacritty's producer
//! (`display/content.rs`) is tangled with the binary crate's config/Display/
//! hints/search, so we reimplement a focused version that resolves colors from
//! our [`Palette`] and yields the cells the vendored renderer's `draw_cells`
//! consumes.
//!
//! v1 scope: cells + colors (named/indexed/spec, dim/bold→bright), INVERSE,
//! block cursor, zerowidth/hyperlink. Not yet: selection, search, hint overlays.

use alacritty_renderer::display::color::Rgb;
use alacritty_renderer::display::content::{RenderableCell, RenderableCellExtra};
use alacritty_terminal::event::EventListener;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::color::Colors;
use alacritty_terminal::term::point_to_viewport;
use alacritty_terminal::vte::ansi::{Color, CursorShape, NamedColor};
use alacritty_terminal::Term;

use crate::config::{dim, Palette};

/// Build the renderable cells for the terminal's current viewport.
///
/// Returns an owned `Vec` (one allocation per frame for now; a reusable buffer
/// is a later optimization). `draw_bold_bright` mirrors the config option.
pub fn renderable_cells<T: EventListener>(
	term: &Term<T>,
	palette: &Palette,
	draw_bold_bright: bool,
) -> Vec<RenderableCell> {
	let content = term.renderable_content();
	let overrides = content.colors;
	let display_offset = content.display_offset;
	let cursor = content.cursor;
	let cursor_visible = cursor.shape != CursorShape::Hidden;

	let mut cells = Vec::new();

	for indexed in content.display_iter {
		let flags = indexed.flags;

		let mut fg = compute_fg(palette, overrides, indexed.fg, flags, draw_bold_bright);
		let mut bg = compute_bg(palette, overrides, indexed.bg);
		let bg_alpha = if flags.contains(Flags::INVERSE) {
			std::mem::swap(&mut fg, &mut bg);
			1.0
		} else {
			compute_bg_alpha(indexed.bg)
		};

		let point = match point_to_viewport(display_offset, indexed.point) {
			Some(point) => point,
			None => continue,
		};

		let underline = indexed.underline_color().map_or(fg, |color| {
			compute_fg(palette, overrides, color, flags, draw_bold_bright)
		});

		let zerowidth = indexed.zerowidth();
		let hyperlink = indexed.hyperlink();
		let extra = (zerowidth.is_some() || hyperlink.is_some()).then(|| {
			Box::new(RenderableCellExtra {
				zerowidth: zerowidth.map(<[char]>::to_vec),
				hyperlink,
			})
		});

		let mut cell = RenderableCell {
			character: indexed.c,
			point,
			fg,
			bg,
			bg_alpha,
			underline,
			flags,
			extra,
		};

		let is_cursor = cursor_visible && indexed.point == cursor.point;
		if is_cursor && cursor.shape == CursorShape::Block {
			// Paint a block cursor: fill the cell with the cursor color and draw
			// the glyph in the cell's background color.
			cell.fg = bg;
			cell.bg = palette.color(overrides, NamedColor::Cursor as usize);
			cell.bg_alpha = 1.0;
			cells.push(cell);
		} else if !is_empty(&cell) && !flags.contains(Flags::WIDE_CHAR_SPACER) {
			cells.push(cell);
		}
	}

	cells
}

/// Resolve a cell's foreground color (with dim/bold→bright handling).
fn compute_fg(
	palette: &Palette,
	overrides: &Colors,
	fg: Color,
	flags: Flags,
	draw_bold_bright: bool,
) -> Rgb {
	match fg {
		Color::Spec(rgb) => {
			let rgb = Rgb(rgb);
			if flags.contains(Flags::DIM) {
				dim(rgb)
			} else {
				rgb
			}
		}
		Color::Named(ansi) => {
			let dim_bold = flags & Flags::DIM_BOLD;
			let index = if dim_bold == Flags::BOLD && draw_bold_bright {
				ansi.to_bright() as usize
			} else if dim_bold == Flags::DIM || (dim_bold == Flags::DIM_BOLD && !draw_bold_bright) {
				ansi.to_dim() as usize
			} else {
				ansi as usize
			};
			palette.color(overrides, index)
		}
		Color::Indexed(idx) => {
			let dim_bold = flags & Flags::DIM_BOLD;
			let index = match idx {
				0..=7 if dim_bold == Flags::BOLD && draw_bold_bright => idx as usize + 8,
				8..=15 if dim_bold == Flags::DIM => idx as usize - 8,
				0..=7 if dim_bold == Flags::DIM => NamedColor::DimBlack as usize + idx as usize,
				_ => idx as usize,
			};
			palette.color(overrides, index)
		}
	}
}

/// Resolve a cell's background color.
fn compute_bg(palette: &Palette, overrides: &Colors, bg: Color) -> Rgb {
	match bg {
		Color::Spec(rgb) => Rgb(rgb),
		Color::Named(ansi) => palette.color(overrides, ansi as usize),
		Color::Indexed(idx) => palette.color(overrides, idx as usize),
	}
}

/// Background is transparent only when it's the default background color.
fn compute_bg_alpha(bg: Color) -> f32 {
	match bg {
		Color::Named(NamedColor::Background) => 0.0,
		_ => 1.0,
	}
}

/// A cell with nothing to draw (transparent bg, blank glyph, no decorations).
fn is_empty(cell: &RenderableCell) -> bool {
	cell.bg_alpha == 0.0
		&& cell.character == ' '
		&& cell.extra.is_none()
		&& !cell
			.flags
			.intersects(Flags::ALL_UNDERLINES | Flags::STRIKEOUT)
}
