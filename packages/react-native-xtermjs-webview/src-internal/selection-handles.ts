import { type Terminal } from '@xterm/xterm';
import { type BridgeInboundMessage } from '../src/bridge';

type SelectionHandlesController = {
	applySelectionMode: (enabled: boolean, opts?: { force?: boolean }) => void;
	renderSelectionHandles: () => void;
	installLongPressHandlers: () => void;
	isSelectionModeEnabled: () => boolean;
	cancelLongPress: () => void;
};

export const createSelectionHandles = ({
	term,
	instanceId,
	sendToRn,
}: {
	term: Terminal;
	instanceId: string;
	sendToRn: (msg: BridgeInboundMessage) => void;
}): SelectionHandlesController => {
	const selectionModeClass = 'fressh-selection-mode';
	const selectionModeStyleId = 'fressh-selection-mode-style';
	const baseSelectionOptions = {
		disableStdin: Boolean(term.options.disableStdin),
		screenReaderMode: Boolean(term.options.screenReaderMode),
	};
	let selectionModeEnabled = false;
	let selectionModeShownAt = 0;
	let lastSelectionText = '';
	let longPressCleanup: (() => void) | null = null;
	let touchCleanup: (() => void) | null = null;
	let selectionOverlay: HTMLDivElement | null = null;
	let startHandle: HTMLDivElement | null = null;
	let endHandle: HTMLDivElement | null = null;
	let activeHandle: 'start' | 'end' | null = null;
	let activePointerId: number | null = null;
	const selectionOverlayTint = 'rgba(0, 0, 0, 0)';
	const minHandleGapPx = 36;
	// Toggle handle debug visuals + oversized hitboxes (tuning aid).
	const debugSelectionHandles = false;
	// Lollipop handle geometry; anchor is where the circle meets the stem.
	const selectionHandleScale = debugSelectionHandles ? 5 : 1;
	const selectionHandleSizePx = 48 * selectionHandleScale;
	const selectionHandleCircleBelowStart = true;
	const lollipopViewboxWidth = 48;
	const lollipopViewboxHeight = 52;
	const lollipopViewboxMinX = 0;
	const lollipopViewboxMinY = -4;
	const lollipopViewboxMaxY =
		lollipopViewboxMinY + lollipopViewboxHeight;
	const lollipopViewboxCenterX =
		lollipopViewboxMinX + lollipopViewboxWidth / 2;
	const lollipopViewboxCenterY =
		lollipopViewboxMinY + lollipopViewboxHeight / 2;
	const lollipopViewboxFlipSumY =
		lollipopViewboxMinY + lollipopViewboxMaxY;
	const selectionHandleGlyphWidthPx =
		lollipopViewboxWidth * selectionHandleScale;
	const selectionHandleGlyphHeightPx =
		lollipopViewboxHeight * selectionHandleScale;
	const selectionHandleGlyphLeftPx = 0;
	const selectionHandleGlyphTopPx = 0;
	const selectionHandleBorder = debugSelectionHandles
		? '1px dashed #ff3b30'
		: 'none';
	const selectionHandleClipBorder = debugSelectionHandles
		? '1px solid #22c55e'
		: 'none';
	const selectionHandleClipDisplay = debugSelectionHandles ? 'block' : 'none';
	const lollipopCircleCenter = { x: 24, y: 9 };
	const lollipopCircleRadius = 10.5;
	const lollipopJunction = { x: 24, y: 17 };
	const lollipopStemWidth = 2;
	const lollipopStemTop = 15;
	const lollipopStemBottom = 36;
	const longPressTimeoutMs = 500;
	const longPressSlopPx = 8;
	// Guard against immediate hide right after long-press selection activates.
	const selectionHideGuardMs = 300;
	let cancelLongPress: () => void = () => {};

	const ensureSelectionModeStyle = () => {
		if (document.getElementById(selectionModeStyleId)) return;
		const style = document.createElement('style');
		style.id = selectionModeStyleId;
		style.type = 'text/css';
		style.textContent = `
	.${selectionModeClass} .xterm .xterm-accessibility {
		pointer-events: auto !important;
	}
	.${selectionModeClass} .xterm .xterm-accessibility-tree {
		user-select: text !important;
		-webkit-user-select: text !important;
	}
	.${selectionModeClass} .fressh-selection-handle {
		position: absolute;
		/* Hitbox scales up only when debugSelectionHandles is true. */
		width: ${selectionHandleSizePx}px;
		height: ${selectionHandleSizePx}px;
		background: transparent;
		box-sizing: border-box;
		border: ${selectionHandleBorder};
		touch-action: none;
		z-index: 30;
		pointer-events: auto;
	}
	.${selectionModeClass} .fressh-selection-handle-glyph {
		position: absolute;
		left: ${selectionHandleGlyphLeftPx}px;
		top: ${selectionHandleGlyphTopPx}px;
		width: ${selectionHandleGlyphWidthPx}px;
		height: ${selectionHandleGlyphHeightPx}px;
	}
	.${selectionModeClass} .fressh-selection-handle-glyph path,
	.${selectionModeClass} .fressh-selection-handle-glyph circle,
	.${selectionModeClass} .fressh-selection-handle-glyph rect {
		fill: #60a5fa;
		pointer-events: none;
	}
	.${selectionModeClass} .fressh-selection-handle-clip {
		position: absolute;
		border: ${selectionHandleClipBorder};
		box-sizing: border-box;
		pointer-events: none;
		display: ${selectionHandleClipDisplay};
	}
	`;
		(document.head || document.documentElement).appendChild(style);
	};

	type WorkCell = { getWidth: () => number; getChars?: () => string };
	type LineLike = {
		getCell?: (col: number) => WorkCell | null;
		loadCell?: (col: number, cell: WorkCell) => WorkCell;
	};

	const getSelectionCore = () => {
		const core = term as unknown as {
			_mouseService?: {
				getCoords: (
					event: { clientX: number; clientY: number },
					element: HTMLElement,
					cols: number,
					rows: number,
					isSelection?: boolean,
				) => [number, number] | undefined;
			};
			screenElement?: HTMLElement;
			_bufferService?: {
				cols: number;
				rows: number;
				buffer: {
					ydisp: number;
					lines: {
						get: (idx: number) =>
							| {
									getCell: (col: number) => {
										getWidth: () => number;
										getChars?: () => string;
									} | null;
							  }
							| undefined;
					};
				};
			};
			_selectionService?: {
				clearSelection: () => void;
				refresh: (isTextLayout: boolean) => void;
				_fireEventIfSelectionChanged?: () => void;
				_model: {
					selectionStart?: [number, number];
					selectionEnd?: [number, number];
					selectionStartLength: number;
					clearSelection: () => void;
				};
			};
			_core?: {
				_mouseService?: {
					getCoords: (
						event: { clientX: number; clientY: number },
						element: HTMLElement,
						cols: number,
						rows: number,
						isSelection?: boolean,
					) => [number, number] | undefined;
				};
				_screenElement?: HTMLElement;
				_bufferService?: {
					cols: number;
					rows: number;
					buffer: {
						ydisp: number;
						lines: {
							get: (idx: number) =>
								| {
										getCell: (col: number) => {
											getWidth: () => number;
											getChars?: () => string;
										} | null;
								  }
								| undefined;
						};
					};
				};
				_selectionService?: {
					clearSelection: () => void;
					refresh: (isTextLayout: boolean) => void;
					_fireEventIfSelectionChanged?: () => void;
					_model: {
						selectionStart?: [number, number];
						selectionEnd?: [number, number];
						selectionStartLength: number;
						clearSelection: () => void;
					};
				};
			};
		};

		const mouseService = core._mouseService ?? core._core?._mouseService;
		const screenElement =
			core.screenElement ??
			core._core?._screenElement ??
			(term.element?.querySelector('.xterm-screen') as HTMLElement | null);
		const bufferService = core._bufferService ?? core._core?._bufferService;
		const selectionService =
			core._selectionService ?? core._core?._selectionService;
		const workCell = (
			selectionService as { _workCell?: WorkCell } | undefined
		)?._workCell;

		if (
			!mouseService ||
			!screenElement ||
			!bufferService ||
			!selectionService
		) {
			return null;
		}
		return {
			mouseService,
			screenElement,
			bufferService,
			selectionService,
			workCell,
		};
	};

	const getCellDimensions = () => {
		const renderService =
			(
				term as unknown as {
					_core?: {
						_renderService?: {
							dimensions?: {
								css?: { cell?: { width?: number; height?: number } };
							};
						};
					};
					_renderService?: {
						dimensions?: {
							css?: { cell?: { width?: number; height?: number } };
						};
					};
				}
			)._renderService ??
			(
				term as unknown as {
					_core?: {
						_renderService?: {
							dimensions?: {
								css?: { cell?: { width?: number; height?: number } };
							};
						};
					};
				}
			)._core?._renderService;
		const cellWidth = renderService?.dimensions?.css?.cell?.width;
		const cellHeight = renderService?.dimensions?.css?.cell?.height;
		if (!cellWidth || !cellHeight) return null;
		return { cellWidth, cellHeight };
	};

	const getHandleGapPx = (
		start: [number, number],
		end: [number, number],
		dims: { cellWidth: number; cellHeight: number },
	) => {
		const dx = (end[0] - start[0]) * dims.cellWidth;
		const dy = (end[1] - start[1]) * dims.cellHeight;
		return Math.hypot(dx, dy);
	};

	const stepBufferPos = (
		pos: [number, number],
		dir: -1 | 1,
		cols: number,
	): [number, number] => {
		let [x, y] = pos;
		if (dir > 0) {
			x += 1;
			if (x >= cols) {
				x = 0;
				y += 1;
			}
		} else {
			x -= 1;
			if (x < 0) {
				x = cols - 1;
				y -= 1;
			}
		}
		return [x, y];
	};

	const moveUntilMinGap = (
		anchor: [number, number],
		moving: [number, number],
		dir: -1 | 1,
		dims: { cellWidth: number; cellHeight: number },
		bounds: { minRow: number; maxRow: number; cols: number },
	) => {
		let next = moving;
		let gap = getHandleGapPx(anchor, next, dims);
		let steps = 0;
		const maxSteps = bounds.cols * 2;
		while (gap < minHandleGapPx && steps < maxSteps) {
			const candidate = stepBufferPos(next, dir, bounds.cols);
			if (candidate[1] < bounds.minRow || candidate[1] > bounds.maxRow) break;
			next = candidate;
			gap = getHandleGapPx(anchor, next, dims);
			steps += 1;
		}
		return { pos: next, achieved: gap >= minHandleGapPx };
	};

	const toInclusiveEnd = (
		endExclusive: [number, number],
		cols: number,
		minRow: number,
	): [number, number] => {
		const [x, y] = endExclusive;
		if (x > 0) return [x - 1, y];
		if (y <= minRow) return [0, y];
		return [cols - 1, y - 1];
	};

	// Lollipop glyph in a padded viewBox: circle above the anchor, stem crosses it.

	const ensureHandleGlyph = (
		handle: HTMLDivElement,
		kind: 'start' | 'end',
	) => {
		if (handle.dataset.glyph === kind) return;
		handle.textContent = '';
		handle.dataset.glyph = kind;
		const isFlipped = kind === 'end' || selectionHandleCircleBelowStart;
		const glyph = document.createElement('div');
		glyph.className = 'fressh-selection-handle-glyph';
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', String(selectionHandleGlyphWidthPx));
		svg.setAttribute('height', String(selectionHandleGlyphHeightPx));
		svg.setAttribute(
			'viewBox',
			`${lollipopViewboxMinX} ${lollipopViewboxMinY} ${lollipopViewboxWidth} ${lollipopViewboxHeight}`,
		);
		const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		if (isFlipped) {
			// Vertical mirror: circle below the anchor.
			g.setAttribute(
				'transform',
				`translate(0 ${lollipopViewboxFlipSumY}) scale(1 -1)`,
			);
		}
		const stem = document.createElementNS(
			'http://www.w3.org/2000/svg',
			'rect',
		);
		stem.setAttribute(
			'x',
			String(lollipopJunction.x - lollipopStemWidth / 2),
		);
		stem.setAttribute('y', String(lollipopStemTop));
		stem.setAttribute('width', String(lollipopStemWidth));
		stem.setAttribute(
			'height',
			String(lollipopStemBottom - lollipopStemTop),
		);
		const circle = document.createElementNS(
			'http://www.w3.org/2000/svg',
			'circle',
		);
		circle.setAttribute('cx', String(lollipopCircleCenter.x));
		circle.setAttribute('cy', String(lollipopCircleCenter.y));
		circle.setAttribute('r', String(lollipopCircleRadius));
		// Draw stem first so the circle can cover any seam at the join.
		g.appendChild(stem);
		g.appendChild(circle);
		svg.appendChild(g);
		glyph.appendChild(svg);
		handle.appendChild(glyph);
		const clip = document.createElement('div');
		clip.className = 'fressh-selection-handle-clip';
		handle.appendChild(clip);
	};

	const getHandleGlyphBounds = (handle: HTMLDivElement) => {
		const scaleX = selectionHandleGlyphWidthPx / lollipopViewboxWidth;
		const scaleY = selectionHandleGlyphHeightPx / lollipopViewboxHeight;
		const kind = handle.dataset.glyph as 'start' | 'end' | undefined;
		const isFlipped =
			kind === 'end' || (kind === 'start' && selectionHandleCircleBelowStart);
		const circleMinX = lollipopCircleCenter.x - lollipopCircleRadius;
		const circleMaxX = lollipopCircleCenter.x + lollipopCircleRadius;
		const circleMinY = lollipopCircleCenter.y - lollipopCircleRadius;
		const circleMaxY = lollipopCircleCenter.y + lollipopCircleRadius;
		const stemMinX = lollipopJunction.x - lollipopStemWidth / 2;
		const stemMaxX = lollipopJunction.x + lollipopStemWidth / 2;
		const stemMinY = lollipopStemTop;
		const stemMaxY = lollipopStemBottom;
		const minX = Math.min(circleMinX, stemMinX);
		const maxX = Math.max(circleMaxX, stemMaxX);
		const minY = Math.min(circleMinY, stemMinY);
		const maxY = Math.max(circleMaxY, stemMaxY);
		const flippedMinY = isFlipped ? lollipopViewboxFlipSumY - maxY : minY;
		const flippedMaxY = isFlipped ? lollipopViewboxFlipSumY - minY : maxY;
		return {
			left: (minX - lollipopViewboxMinX) * scaleX,
			top: (flippedMinY - lollipopViewboxMinY) * scaleY,
			width: (maxX - minX) * scaleX,
			height: (flippedMaxY - flippedMinY) * scaleY,
		};
	};

	const getHandleLayout = (kind: 'start' | 'end') => {
		const isFlipped =
			kind === 'end' || (kind === 'start' && selectionHandleCircleBelowStart);
		const circleY =
			isFlipped
				? lollipopViewboxFlipSumY - lollipopCircleCenter.y
				: lollipopCircleCenter.y;
		const junctionY =
			isFlipped
				? lollipopViewboxFlipSumY - lollipopJunction.y
				: lollipopJunction.y;
		const glyphOffsetX =
			(lollipopViewboxCenterX - lollipopCircleCenter.x) *
			selectionHandleScale;
		const glyphOffsetY =
			(lollipopViewboxCenterY - circleY) * selectionHandleScale;
		const anchorOffsetX =
			glyphOffsetX +
			(lollipopJunction.x - lollipopViewboxMinX) * selectionHandleScale;
		const anchorOffsetY =
			glyphOffsetY +
			(junctionY - lollipopViewboxMinY) * selectionHandleScale;
		return {
			glyphLeft: selectionHandleGlyphLeftPx + glyphOffsetX,
			glyphTop: selectionHandleGlyphTopPx + glyphOffsetY,
			anchorOffsetX,
			anchorOffsetY,
		};
	};

	const ensureHandleInDom = (handle: HTMLDivElement, root: HTMLElement) => {
		if (handle.parentElement) return;
		handle.style.visibility = 'hidden';
		handle.style.left = '0px';
		handle.style.top = '0px';
		root.appendChild(handle);
	};

	const setHandleGlyphLeft = (handle: HTMLDivElement, leftPx: number) => {
		const glyph = handle.querySelector<HTMLDivElement>(
			'.fressh-selection-handle-glyph',
		);
		if (!glyph) return;
		// Allow the glyph to overflow the hitbox so we can center the circle.
		glyph.style.left = `${leftPx}px`;
	};

	const setHandleGlyphTop = (handle: HTMLDivElement, topPx: number) => {
		const glyph = handle.querySelector<HTMLDivElement>(
			'.fressh-selection-handle-glyph',
		);
		if (!glyph) return;
		// Allow the glyph to overflow the hitbox so we can center the circle.
		glyph.style.top = `${topPx}px`;
	};

	const setHandleClipRect = (
		handle: HTMLDivElement,
		left: number,
		top: number,
		width: number,
		height: number,
	) => {
		const clip = handle.querySelector<HTMLDivElement>(
			'.fressh-selection-handle-clip',
		);
		if (!clip) return;
		clip.style.left = `${left}px`;
		clip.style.top = `${top}px`;
		clip.style.width = `${width}px`;
		clip.style.height = `${height}px`;
	};

	const getBufferCoords = (
		clientX: number,
		clientY: number,
	): [number, number] | null => {
		const core = getSelectionCore();
		if (!core) return null;
		const coords = core.mouseService.getCoords(
			{ clientX, clientY },
			core.screenElement,
			core.bufferService.cols,
			core.bufferService.rows,
			true,
		);
		if (!coords) return null;
		coords[0] -= 1;
		coords[1] -= 1;
		coords[1] += core.bufferService.buffer.ydisp;
		return coords as [number, number];
	};

	const getCellData = (
		line: LineLike,
		col: number,
		core: { workCell?: WorkCell },
	) => {
		if (typeof line.getCell === 'function') {
			return line.getCell(col) ?? null;
		}
		if (typeof line.loadCell === 'function' && core.workCell) {
			return line.loadCell(col, core.workCell);
		}
		return null;
	};

	const normalizeSelectionColumn = (
		line: LineLike,
		col: number,
		core: { workCell?: WorkCell },
	) => {
		let c = Math.max(0, col);
		const initial = getCellData(line, c, core);
		if (!initial) return c;
		if (initial.getWidth() !== 0) return c;
		while (c > 0) {
			c -= 1;
			const cell = getCellData(line, c, core);
			if (cell && cell.getWidth() > 0) return c;
		}
		return c;
	};

	const expandToWord = (
		coords: [number, number],
	): { start: [number, number]; end: [number, number] } => {
		const core = getSelectionCore();
		if (!core) return { start: coords, end: coords };
		const [xRaw, y] = coords;
		const line = core.bufferService.buffer.lines.get(y);
		if (!line) {
			return { start: coords, end: coords };
		}
		const x = normalizeSelectionColumn(line, xRaw, core);
		const cell = getCellData(line, x, core);
		const char = cell?.getChars?.() ?? '';
		const separators = term.options.wordSeparator ?? '';
		const isSeparator = (value: string) =>
			value.trim().length === 0 || separators.includes(value);
		if (!char || isSeparator(char)) {
			return { start: [x, y], end: [x, y] };
		}
		let left = x;
		let right = x;
		while (left > 0) {
			const nextCol = normalizeSelectionColumn(line, left - 1, core);
			const nextCell = getCellData(line, nextCol, core);
			const nextChar = nextCell?.getChars?.() ?? '';
			if (!nextChar || isSeparator(nextChar)) break;
			left = nextCol;
			if (nextCol === 0) break;
		}
		while (right < core.bufferService.cols - 1) {
			const nextCol = normalizeSelectionColumn(line, right + 1, core);
			if (nextCol <= right) break;
			const nextCell = getCellData(line, nextCol, core);
			const nextChar = nextCell?.getChars?.() ?? '';
			if (!nextChar || isSeparator(nextChar)) break;
			right = nextCol;
			if (right >= core.bufferService.cols - 1) break;
		}
		return { start: [left, y], end: [right, y] };
	};

	const emitSelectionChanged = () => {
		let text = '';
		try {
			text = term.getSelection() || '';
		} catch {
			text = '';
		}
		if (text === lastSelectionText) return;
		lastSelectionText = text;
		sendToRn({ type: 'selectionChanged', text, instanceId });
	};

	const renderSelectionHandles = () => {
		if (!selectionModeEnabled) {
			if (startHandle) startHandle.style.display = 'none';
			if (endHandle) endHandle.style.display = 'none';
			return;
		}
		const core = getSelectionCore();
		if (!core) return;
		const selectionService =
			core.selectionService as typeof core.selectionService & {
				selectionStart?: [number, number];
				selectionEnd?: [number, number];
			};
		const model = selectionService._model;
		const selectionStart =
			selectionService.selectionStart ?? model.selectionStart;
		const selectionEnd = selectionService.selectionEnd ?? model.selectionEnd;
		if (!selectionStart || !selectionEnd) {
			if (startHandle) startHandle.style.display = 'none';
			if (endHandle) endHandle.style.display = 'none';
			return;
		}
		const dims = getCellDimensions();
		const cellWidth = dims?.cellWidth;
		const cellHeight = dims?.cellHeight;
		if (!cellWidth || !cellHeight) return;

		const rootEl = term.element;
		const screenRect = core.screenElement.getBoundingClientRect();
		const rootRect = rootEl?.getBoundingClientRect();
		if (!rootEl || !rootRect) return;

		const offsetX = screenRect.left - rootRect.left;
		const offsetY = screenRect.top - rootRect.top;
		const ydisp = core.bufferService.buffer.ydisp;
		const startRow = selectionStart[1] - ydisp;
		const endRow = selectionEnd[1] - ydisp;
		if (startRow < 0 || startRow >= core.bufferService.rows) {
			if (startHandle) startHandle.style.display = 'none';
		} else {
			const startX = offsetX + selectionStart[0] * cellWidth - 1;
			const startY =
				offsetY +
				(startRow + (selectionHandleCircleBelowStart ? 1 : 0)) *
					cellHeight;
			startHandle = startHandle ?? document.createElement('div');
			startHandle.className = 'fressh-selection-handle';
			ensureHandleGlyph(startHandle, 'start');
			ensureHandleInDom(startHandle, rootEl);
			const startBounds = getHandleGlyphBounds(startHandle) ?? {
				left: 0,
				top: 0,
				width: selectionHandleGlyphWidthPx,
				height: selectionHandleGlyphHeightPx,
			};
			const startLayout = getHandleLayout('start');
			setHandleGlyphLeft(startHandle, startLayout.glyphLeft);
			setHandleGlyphTop(startHandle, startLayout.glyphTop);
			setHandleClipRect(
				startHandle,
				startLayout.glyphLeft + startBounds.left,
				startLayout.glyphTop + startBounds.top,
				startBounds.width,
				startBounds.height,
			);
			startHandle.style.display = 'block';
			startHandle.style.left = `${startX - startLayout.anchorOffsetX}px`;
			startHandle.style.top = `${startY - startLayout.anchorOffsetY}px`;
			startHandle.style.visibility = 'visible';
			if (!startHandle.parentElement) rootEl.appendChild(startHandle);
		}

		const endRowVisible = endRow >= 0 && endRow < core.bufferService.rows;
		if (!endRowVisible) {
			if (endHandle) endHandle.style.display = 'none';
		} else {
			const endX = offsetX + selectionEnd[0] * cellWidth;
			const endY = offsetY + (endRow + 1) * cellHeight;
			endHandle = endHandle ?? document.createElement('div');
			endHandle.className = 'fressh-selection-handle';
			ensureHandleGlyph(endHandle, 'end');
			ensureHandleInDom(endHandle, rootEl);
			const endBounds = getHandleGlyphBounds(endHandle) ?? {
				left: 0,
				top: 0,
				width: selectionHandleGlyphWidthPx,
				height: selectionHandleGlyphHeightPx,
			};
			const endLayout = getHandleLayout('end');
			setHandleGlyphLeft(endHandle, endLayout.glyphLeft);
			setHandleGlyphTop(endHandle, endLayout.glyphTop);
			setHandleClipRect(
				endHandle,
				endLayout.glyphLeft + endBounds.left,
				endLayout.glyphTop + endBounds.top,
				endBounds.width,
				endBounds.height,
			);
			endHandle.style.display = 'block';
			endHandle.style.left = `${endX - endLayout.anchorOffsetX}px`;
			endHandle.style.top = `${endY - endLayout.anchorOffsetY}px`;
			endHandle.style.visibility = 'visible';
			if (!endHandle.parentElement) rootEl.appendChild(endHandle);
		}
		if (startHandle || endHandle) ensureHandleListeners();
	};

	const updateSelectionRange = (
		start: [number, number],
		end: [number, number],
	) => {
		const core = getSelectionCore();
		if (!core) return;
		sendToRn({
			type: 'debug',
			message: `updateSelectionRange start=${start[0]},${start[1]} end=${end[0]},${end[1]}`,
		});
		try {
			const maxRow =
				core.bufferService.buffer.ydisp + core.bufferService.rows - 1;
			const minRow = core.bufferService.buffer.ydisp;
			const startRow = Math.max(minRow, Math.min(start[1], maxRow));
			const endRow = Math.max(minRow, Math.min(end[1], maxRow));
			const clampColInclusive = (value: number) =>
				Math.max(0, Math.min(value, core.bufferService.cols - 1));
			let [sx, sy] = [clampColInclusive(start[0]), startRow];
			let [exInclusive, ey] = [clampColInclusive(end[0]), endRow];
			if (sy > ey || (sy === ey && sx > exInclusive)) {
				if (activeHandle === 'start') {
					sy = ey;
					sx = exInclusive;
				} else if (activeHandle === 'end') {
					ey = sy;
					exInclusive = sx;
				}
			}
			const dims = getCellDimensions();
			if (dims) {
				const bounds = {
					minRow,
					maxRow,
					cols: core.bufferService.cols,
				};
				const gap = getHandleGapPx([sx, sy], [exInclusive, ey], dims);
				if (gap < minHandleGapPx) {
					if (activeHandle === 'start' || activeHandle === 'end') {
						const isStartActive = activeHandle === 'start';
						const anchor: [number, number] = isStartActive
							? [exInclusive, ey]
							: [sx, sy];
						const moving: [number, number] = isStartActive
							? [sx, sy]
							: [exInclusive, ey];
						const dir: -1 | 1 = isStartActive ? -1 : 1;
						const result = moveUntilMinGap(anchor, moving, dir, dims, bounds);
						if (result.achieved) {
							if (isStartActive) {
								sx = result.pos[0];
								sy = result.pos[1];
							} else {
								exInclusive = result.pos[0];
								ey = result.pos[1];
							}
						} else {
							const fallback = moveUntilMinGap(
								moving,
								anchor,
								(dir * -1) as -1 | 1,
								dims,
								bounds,
							);
							if (fallback.achieved) {
								if (isStartActive) {
									exInclusive = fallback.pos[0];
									ey = fallback.pos[1];
								} else {
									sx = fallback.pos[0];
									sy = fallback.pos[1];
								}
							}
						}
					} else {
						const result = moveUntilMinGap(
							[sx, sy],
							[exInclusive, ey],
							1,
							dims,
							bounds,
						);
						if (result.achieved) {
							exInclusive = result.pos[0];
							ey = result.pos[1];
						} else {
							const fallback = moveUntilMinGap(
								[exInclusive, ey],
								[sx, sy],
								-1,
								dims,
								bounds,
							);
							if (fallback.achieved) {
								sx = fallback.pos[0];
								sy = fallback.pos[1];
							}
						}
					}
				}
			}
			const endExclusive =
				exInclusive < core.bufferService.cols - 1
					? exInclusive + 1
					: core.bufferService.cols;
			const ex = endExclusive;
			const length = Math.max(
				1,
				(ey - sy) * core.bufferService.cols + (ex - sx),
			);
			const selectionService =
				core.selectionService as typeof core.selectionService & {
					setSelection?: (col: number, row: number, length: number) => void;
				};
			if (selectionService.setSelection) {
				selectionService.setSelection(sx, sy, length);
			} else {
				core.selectionService._model.selectionStart = [sx, sy];
				core.selectionService._model.selectionEnd = [ex, ey];
				core.selectionService._model.selectionStartLength = 0;
				core.selectionService.refresh(true);
				core.selectionService._fireEventIfSelectionChanged?.();
			}
			try {
				const selectionText = term.getSelection() || '';
				sendToRn({
					type: 'debug',
					message: `selection updated len=${selectionText.length} start=${sx},${sy} end=${ex},${ey} ydisp=${core.bufferService.buffer.ydisp}`,
				});
			} catch {
				sendToRn({
					type: 'debug',
					message: `selection updated start=${sx},${sy} end=${ex},${ey} ydisp=${core.bufferService.buffer.ydisp}`,
				});
			}
			renderSelectionHandles();
		} catch (err) {
			sendToRn({
				type: 'debug',
				message: `selection update error: ${String(err)}`,
			});
		}
	};

	const ensureHandleListeners = () => {
		const rootEl = term.element;
		if (!rootEl) return;
		const attach = (handle: HTMLDivElement, kind: 'start' | 'end') => {
			if (handle.dataset.listenersAttached === 'true') return;
			let dragStart: { x: number; y: number } | null = null;
			let dragOffset: { x: number; y: number } | null = null;
			let dragging = false;

			const resetDrag = () => {
				dragStart = null;
				dragOffset = null;
				dragging = false;
			};

			const onPointerDown = (event: PointerEvent) => {
				if (!selectionModeEnabled) return;
				activeHandle = kind;
				activePointerId = event.pointerId;
				const layout = getHandleLayout(kind);
				const rect = handle.getBoundingClientRect();
				const anchorX = rect.left + layout.anchorOffsetX;
				const anchorY = rect.top + layout.anchorOffsetY;
				// Keep the handle anchor fixed relative to the finger until dragging begins.
				dragStart = { x: event.clientX, y: event.clientY };
				dragOffset = {
					x: event.clientX - anchorX,
					y: event.clientY - anchorY,
				};
				dragging = false;
				handle.setPointerCapture(event.pointerId);
				event.preventDefault();
				event.stopPropagation();
			};
			const onPointerMove = (event: PointerEvent) => {
				if (!selectionModeEnabled) return;
				if (activeHandle !== kind || activePointerId !== event.pointerId)
					return;
				if (!dragStart || !dragOffset) return;
				const dx = event.clientX - dragStart.x;
				const dy = event.clientY - dragStart.y;
				if (!dragging) {
					if (Math.hypot(dx, dy) <= longPressSlopPx) {
						event.preventDefault();
						event.stopPropagation();
						return;
					}
					dragging = true;
				}
				const core = getSelectionCore();
				if (!core) return;
				const screenRect = core.screenElement.getBoundingClientRect();
				// Clamp to the screen bounds so getBufferCoords stays valid.
				const adjustedX = event.clientX - dragOffset.x;
				const adjustedY = event.clientY - dragOffset.y;
				const maxX = Math.max(screenRect.left, screenRect.right - 1);
				const maxY = Math.max(screenRect.top, screenRect.bottom - 1);
				const clampedX = Math.min(
					Math.max(adjustedX, screenRect.left),
					maxX,
				);
				const clampedY = Math.min(
					Math.max(adjustedY, screenRect.top),
					maxY,
				);
				const coords = getBufferCoords(clampedX, clampedY);
				if (!coords) return;
				const line = core.bufferService.buffer.lines.get(coords[1]);
				const normalizedCol = line
					? normalizeSelectionColumn(line, coords[0], core)
					: coords[0];
				const selectionService =
					core.selectionService as typeof core.selectionService & {
						selectionStart?: [number, number];
						selectionEnd?: [number, number];
					};
				const model = selectionService._model;
				const start =
					selectionService.selectionStart ?? model.selectionStart ?? coords;
				const endExclusive =
					selectionService.selectionEnd ?? model.selectionEnd ?? coords;
				const end = toInclusiveEnd(
					endExclusive,
					core.bufferService.cols,
					core.bufferService.buffer.ydisp,
				);
				if (kind === 'start') {
					updateSelectionRange([normalizedCol, coords[1]], end);
				} else {
					updateSelectionRange(start, [normalizedCol, coords[1]]);
				}
				event.preventDefault();
				event.stopPropagation();
			};
			const onPointerUp = (event: PointerEvent) => {
				if (activePointerId !== event.pointerId) return;
				activeHandle = null;
				activePointerId = null;
				resetDrag();
				handle.releasePointerCapture(event.pointerId);
				emitSelectionChanged();
				event.preventDefault();
				event.stopPropagation();
			};
			const onPointerCancel = (event: PointerEvent) => {
				if (activePointerId !== event.pointerId) return;
				activeHandle = null;
				activePointerId = null;
				resetDrag();
				handle.releasePointerCapture(event.pointerId);
				event.preventDefault();
				event.stopPropagation();
			};
			handle.addEventListener('pointerdown', onPointerDown);
			handle.addEventListener('pointermove', onPointerMove);
			handle.addEventListener('pointerup', onPointerUp);
			handle.addEventListener('pointercancel', onPointerCancel);
			handle.dataset.listenersAttached = 'true';
		};
		if (startHandle) attach(startHandle, 'start');
		if (endHandle) attach(endHandle, 'end');
	};

	const applySelectionMode = (
		enabled: boolean,
		opts: { force?: boolean } = {},
	) => {
		if (!enabled && selectionModeEnabled && !opts.force) {
			if (Date.now() - selectionModeShownAt < selectionHideGuardMs) return;
		}
		if (selectionModeEnabled === enabled) return;
		selectionModeEnabled = enabled;
		if (enabled) selectionModeShownAt = Date.now();
		ensureSelectionModeStyle();
		const rootEl = document.body || document.documentElement;
		rootEl?.classList.toggle(selectionModeClass, enabled);
		if (document.body) {
			document.body.style.boxShadow = '';
		}
		sendToRn({ type: 'selectionModeChanged', enabled, instanceId });
		sendToRn({
			type: 'debug',
			message: `selection mode ${enabled ? 'enabled' : 'disabled'}`,
		});

		const termInternals = term as unknown as {
			_selectionService?: { enable?: () => void; disable?: () => void };
			_core?: {
				_selectionService?: { enable?: () => void; disable?: () => void };
			};
		};
		const selectionService =
			termInternals._selectionService ??
			termInternals._core?._selectionService;

		let mouseTrackingActive = false;
		try {
			const mode = term.modes?.mouseTrackingMode;
			mouseTrackingActive = Boolean(mode && mode !== 'none');
		} catch {
			mouseTrackingActive = false;
		}

		if (enabled) {
			try {
				term.options.disableStdin = true;
				term.options.screenReaderMode = true;
			} catch (err) {
				sendToRn({
					type: 'debug',
					message: `selection options set error: ${String(err)}`,
				});
			}
			selectionService?.enable?.();
			term.element?.classList.remove('enable-mouse-events');
			sendToRn({
				type: 'debug',
				message: `selection internals ${selectionService ? 'ok' : 'missing'}`,
			});
			if (!touchCleanup) {
				touchCleanup = (() => {
					const target = term.element;
					if (!target) return null;

					const ensureOverlay = () => {
						if (selectionOverlay) return selectionOverlay;
						const overlay = document.createElement('div');
						overlay.style.position = 'absolute';
						overlay.style.left = '0';
						overlay.style.right = '0';
						overlay.style.top = '0';
						overlay.style.bottom = '0';
						overlay.style.background = selectionOverlayTint;
						overlay.style.border = 'none';
						overlay.style.zIndex = '20';
						overlay.style.touchAction = 'none';
						overlay.style.pointerEvents = 'auto';
						const computed = window.getComputedStyle(target);
						if (computed.position === 'static') {
							target.style.position = 'relative';
						}
						target.appendChild(overlay);
						selectionOverlay = overlay;
						return overlay;
					};

					const overlay = ensureOverlay();
					term.element?.style.setProperty('outline', 'none');

					let tapStart: { x: number; y: number } | null = null;
					const onTouchStart = (event: TouchEvent) => {
						if (!selectionModeEnabled) return;
						if (event.touches.length !== 1) return;
						const touch = event.touches.item(0);
						if (!touch) return;
						tapStart = { x: touch.clientX, y: touch.clientY };
						event.preventDefault();
					};
					const onTouchMove = (event: TouchEvent) => {
						if (!tapStart) return;
						const touch = event.touches.item(0);
						if (!touch) return;
						const dx = touch.clientX - tapStart.x;
						const dy = touch.clientY - tapStart.y;
						if (Math.hypot(dx, dy) > longPressSlopPx) {
							tapStart = null;
						}
						event.preventDefault();
					};
					const onTouchEnd = (event: TouchEvent) => {
						if (!tapStart) return;
						tapStart = null;
						applySelectionMode(false);
						event.preventDefault();
					};
					const onTouchCancel = (event: TouchEvent) => {
						tapStart = null;
						event.preventDefault();
					};

					overlay.addEventListener('touchstart', onTouchStart, {
						passive: false,
					});
					overlay.addEventListener('touchmove', onTouchMove, {
						passive: false,
					});
					overlay.addEventListener('touchend', onTouchEnd, {
						passive: false,
					});
					overlay.addEventListener('touchcancel', onTouchCancel, {
						passive: false,
					});

					return () => {
						overlay.removeEventListener('touchstart', onTouchStart);
						overlay.removeEventListener('touchmove', onTouchMove);
						overlay.removeEventListener('touchend', onTouchEnd);
						overlay.removeEventListener('touchcancel', onTouchCancel);
						overlay.style.pointerEvents = 'none';
						overlay.style.display = 'none';
						term.element?.style.setProperty('outline', 'none');
					};
				})();
			}
			if (selectionOverlay) {
				selectionOverlay.style.pointerEvents = 'auto';
				selectionOverlay.style.display = 'block';
			}
			renderSelectionHandles();
		} else {
			try {
				term.options.disableStdin = baseSelectionOptions.disableStdin;
				term.options.screenReaderMode = baseSelectionOptions.screenReaderMode;
			} catch (err) {
				sendToRn({
					type: 'debug',
					message: `selection options reset error: ${String(err)}`,
				});
			}
			if (mouseTrackingActive) {
				selectionService?.disable?.();
				term.element?.classList.add('enable-mouse-events');
			} else {
				selectionService?.enable?.();
				term.element?.classList.remove('enable-mouse-events');
			}
			activeHandle = null;
			activePointerId = null;
			term.clearSelection();
			if (startHandle) startHandle.style.display = 'none';
			if (endHandle) endHandle.style.display = 'none';
			emitSelectionChanged();
			if (touchCleanup) {
				touchCleanup();
				touchCleanup = null;
			}
		}
	};

	const installLongPressHandlers = () => {
		if (longPressCleanup) return;
		const target = getSelectionCore()?.screenElement ?? term.element;
		if (!target) return;

		let longPressTimer: ReturnType<typeof setTimeout> | null = null;
		let startPoint: { x: number; y: number } | null = null;
		let longPressFired = false;
		let activePointerId: number | null = null;

		const clearLongPress = () => {
			if (longPressTimer) {
				clearTimeout(longPressTimer);
				longPressTimer = null;
			}
			startPoint = null;
			longPressFired = false;
			activePointerId = null;
		};
		cancelLongPress = clearLongPress;

		const startLongPress = (x: number, y: number) => {
			if (selectionModeEnabled) return;
			startPoint = { x, y };
			longPressFired = false;
			longPressTimer = setTimeout(() => {
				if (!startPoint) return;
				const coords = getBufferCoords(startPoint.x, startPoint.y);
				if (!coords) {
					sendToRn({
						type: 'debug',
						message: `long-press coords unavailable at ${startPoint.x},${startPoint.y}`,
					});
					return;
				}
				// Enter selection mode on long-press and seed selection around the touch.
				applySelectionMode(true, { force: true });
				sendToRn({
					type: 'debug',
					message: `long-press coords ${coords[0]},${coords[1]}`,
				});
				let expanded = { start: coords, end: coords };
				try {
					expanded = expandToWord(coords);
					sendToRn({
						type: 'debug',
						message: `expandToWord start=${expanded.start[0]},${expanded.start[1]} end=${expanded.end[0]},${expanded.end[1]}`,
					});
				} catch (err) {
					sendToRn({
						type: 'debug',
						message: `expandToWord error: ${String(err)}`,
					});
				}
				sendToRn({
					type: 'debug',
					message: `apply selection start=${expanded.start[0]},${expanded.start[1]} end=${expanded.end[0]},${expanded.end[1]}`,
				});
				updateSelectionRange(expanded.start, expanded.end);
				renderSelectionHandles();
				emitSelectionChanged();
				longPressFired = true;
			}, longPressTimeoutMs);
		};

		const moveLongPress = (x: number, y: number) => {
			if (!startPoint || !longPressTimer) return;
			const dx = x - startPoint.x;
			const dy = y - startPoint.y;
			if (Math.hypot(dx, dy) > longPressSlopPx) {
				clearLongPress();
			}
		};

		const finishLongPress = (event?: Event) => {
			if (longPressFired) {
				event?.preventDefault?.();
			}
			clearLongPress();
		};

		if ('PointerEvent' in window) {
			const onPointerDown = (event: PointerEvent) => {
				if (selectionModeEnabled) return;
				if (event.pointerType && event.pointerType !== 'touch') return;
				activePointerId = event.pointerId;
				startLongPress(event.clientX, event.clientY);
			};
			const onPointerMove = (event: PointerEvent) => {
				if (activePointerId !== event.pointerId) return;
				moveLongPress(event.clientX, event.clientY);
			};
			const onPointerUp = (event: PointerEvent) => {
				if (activePointerId !== event.pointerId) return;
				finishLongPress(event);
			};
			const onPointerCancel = (event: PointerEvent) => {
				if (activePointerId !== event.pointerId) return;
				clearLongPress();
			};
			target.addEventListener('pointerdown', onPointerDown);
			target.addEventListener('pointermove', onPointerMove);
			target.addEventListener('pointerup', onPointerUp);
			target.addEventListener('pointercancel', onPointerCancel);

			longPressCleanup = () => {
				target.removeEventListener('pointerdown', onPointerDown);
				target.removeEventListener('pointermove', onPointerMove);
				target.removeEventListener('pointerup', onPointerUp);
				target.removeEventListener('pointercancel', onPointerCancel);
				clearLongPress();
			};
			return;
		}

		const onTouchStart = (event: TouchEvent) => {
			if (selectionModeEnabled) return;
			if (event.touches.length !== 1) return;
			const touch = event.touches.item(0);
			if (!touch) return;
			startLongPress(touch.clientX, touch.clientY);
		};
		const onTouchMove = (event: TouchEvent) => {
			if (!startPoint || !longPressTimer) return;
			const touch = event.touches.item(0);
			if (!touch) return;
			moveLongPress(touch.clientX, touch.clientY);
		};
		const onTouchEnd = (event: TouchEvent) => {
			finishLongPress(event);
		};
		const onTouchCancel = () => {
			clearLongPress();
		};

		target.addEventListener('touchstart', onTouchStart, { passive: true });
		target.addEventListener('touchmove', onTouchMove, { passive: true });
		target.addEventListener('touchend', onTouchEnd, { passive: false });
		target.addEventListener('touchcancel', onTouchCancel, {
			passive: true,
		});

		longPressCleanup = () => {
			target.removeEventListener('touchstart', onTouchStart);
			target.removeEventListener('touchmove', onTouchMove);
			target.removeEventListener('touchend', onTouchEnd);
			target.removeEventListener('touchcancel', onTouchCancel);
			clearLongPress();
		};
	};
	const isSelectionModeEnabled = () => selectionModeEnabled;
	const cancelLongPressNow = () => {
		cancelLongPress();
	};

	return {
		applySelectionMode,
		renderSelectionHandles,
		installLongPressHandlers,
		isSelectionModeEnabled,
		cancelLongPress: cancelLongPressNow,
	};
};
