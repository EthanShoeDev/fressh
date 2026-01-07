import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
	bStrToBinary,
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
	type TouchScrollConfig,
} from '../src/bridge';

declare global {
	interface Window {
		terminal?: Terminal;
		fitAddon?: FitAddon;
		terminalWriteBase64?: (data: string) => void;
		__FRESSH_XTERM_OPTIONS__?: ITerminalOptions;
		ReactNativeWebView?: {
			postMessage?: (data: string) => void;
			injectedObjectJson?: () => string | undefined;
		};
		__FRESSH_XTERM_BRIDGE__?: boolean;
		__FRESSH_XTERM_MSG_HANDLER__?: (
			e: MessageEvent<BridgeOutboundMessage>,
		) => void;
	}
}

const sendToRn = (msg: BridgeInboundMessage) =>
	window.ReactNativeWebView?.postMessage?.(JSON.stringify(msg));

/**
 * Idempotent boot guard: ensure we only install once.
 * If the script happens to run twice (dev reloads, double-mounts), we bail out early.
 */
window.onload = () => {
	try {
		if (window.__FRESSH_XTERM_BRIDGE__) {
			sendToRn({
				type: 'debug',
				message: 'bridge already installed; ignoring duplicate boot',
			});
			return;
		}

		const injectedObjectJson =
			window.ReactNativeWebView?.injectedObjectJson?.();
		let injectedObject: ITerminalOptions = {};
		if (injectedObjectJson) {
			try {
				injectedObject = JSON.parse(injectedObjectJson) as ITerminalOptions;
			} catch (err) {
				if (window.__FRESSH_XTERM_OPTIONS__) {
					injectedObject = window.__FRESSH_XTERM_OPTIONS__;
					sendToRn({
						type: 'debug',
						message: 'injectedObjectJson invalid; using preloaded options',
					});
				} else {
					sendToRn({
						type: 'debug',
						message: `injectedObjectJson invalid; using defaults (${String(
							err,
						)})`,
					});
				}
			}
		} else if (window.__FRESSH_XTERM_OPTIONS__) {
			injectedObject = window.__FRESSH_XTERM_OPTIONS__;
			sendToRn({
				type: 'debug',
				message: 'injectedObjectJson not found; using preloaded options',
			});
		} else {
			sendToRn({
				type: 'debug',
				message: 'injectedObjectJson not found; using defaults',
			});
		}

		window.__FRESSH_XTERM_BRIDGE__ = true;
		const createInstanceId = () => {
			if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
				return crypto.randomUUID();
			}
			return `${Date.now().toString(36)}-${Math.random()
				.toString(36)
				.slice(2, 10)}`;
		};
		const instanceId = createInstanceId();

		// ---- Xterm setup
		const term = new Terminal(injectedObject);
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		const root = document.getElementById('terminal')!;
		term.open(root);
		fitAddon.fit();
		if (document.documentElement) {
			document.documentElement.style.overflow = 'hidden';
		}
		if (document.body) {
			document.body.style.overflow = 'hidden';
		}
		if (term.element) {
			term.element.style.position = 'relative';
			term.element.style.overflow = 'hidden';
		}
		root.style.position = 'relative';
		root.style.overflow = 'hidden';

		if (!window.ReactNativeWebView) {
			const devTheme = {
				background: '#0b1220',
				foreground: '#e2e8f0',
				selectionBackground: 'rgba(26, 115, 232, 0.35)',
				selectionInactiveBackground: 'rgba(26, 115, 232, 0.2)',
			};
			term.options.theme = {
				...(term.options.theme ?? {}),
				...devTheme,
			};
			if (document.body) {
				document.body.style.backgroundColor = devTheme.background;
			}
			term.writeln('Fressh handle dev view');
			term.writeln('Long-press to enter selection mode.');
			term.writeln('Use this page to tune selection handles.');
			term.writeln('');
			term.writeln('The quick brown fox jumps over the lazy dog.');
			term.writeln('0123456789 []{}() <>,.?/ +-*/');
		}

		// Send initial size after first fit
		if (term.cols >= 2 && term.rows >= 1) {
			sendToRn({ type: 'sizeChanged', cols: term.cols, rows: term.rows });
		}

		const applyFontFamily = (family?: string) => {
			if (!family) return;
			const rootEl = (term.element ??
				document.querySelector('.xterm')) as HTMLElement | null;
			if (rootEl) rootEl.style.fontFamily = family;
			const helper = document.querySelector(
				'.xterm-helper-textarea',
			) as HTMLElement | null;
			if (helper) helper.style.fontFamily = family;
			const measure = document.querySelector(
				'.xterm-char-measure-element',
			) as HTMLElement | null;
			if (measure) measure.style.fontFamily = family;
		};

		applyFontFamily(injectedObject.fontFamily);

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

		const createTouchScrollController = () => {
			type ScrollState = 'Idle' | 'Tracking' | 'Scrolling' | 'ScrollbackActive';
			type CopyModeState = 'off' | 'entering' | 'on';
			type CopyModeConfidence = 'uncertain' | 'confident';
			type EntryIntent = 'scroll' | 'recovery';

			// Use tmux scroll commands so the viewport moves immediately (no cursor dead zone).
			// Ctrl+Up / Ctrl+Down are bound to scroll-up / scroll-down in tmux defaults.
			const keyScrollUp = '\x1b[1;5A';
			const keyScrollDown = '\x1b[1;5B';
			const keyPageUp = '\x1b[5~';
			const keyPageDown = '\x1b[6~';

			let config: TouchScrollConfig = { enabled: false };
			let enabled = false;

			let state: ScrollState = 'Idle';
			let copyModeState: CopyModeState = 'off';
			let copyModeConfidence: CopyModeConfidence = 'uncertain';
			let entryIntent: EntryIntent | null = null;

			let scrollbackActive = false;
			let scrollbackPhase: 'dragging' | 'active' = 'active';

			let pointerIsDown = false;
			let pendingPointerUp = false;
			let activePointerId: number | null = null;
			let startX = 0;
			let startY = 0;
			let lastY = 0;
			let lastMoveTs = 0;
			let lastVelocity = 0;

			let pendingLines = 0;
			let remainderPx = 0;
			let rafId: number | null = null;

			let pendingEnterRequestId: number | null = null;
			let enterRequestCounter = 0;

			let lineHeightPx = 16;
			let target: HTMLElement | null = null;
			let listenersInstalled = false;

			const getActiveConfig = () => {
				if (!config || !config.enabled) return null;
				return {
					pxPerLine: config.pxPerLine ?? Math.max(12, lineHeightPx),
					slopPx: config.slopPx ?? 8,
					maxLinesPerFrame: config.maxLinesPerFrame ?? 6,
					flickVelocity: config.flickVelocity ?? 1.2,
					invertScroll: config.invertScroll ?? false,
					enterDelayMs: config.enterDelayMs ?? 10,
					prefixKey: config.prefixKey ?? '\x02',
					copyModeKey: config.copyModeKey ?? '[',
					exitKey: config.exitKey ?? 'q',
					cancelKey: config.cancelKey ?? 'q',
					debug: config.debug ?? false,
				};
			};

			const emitDebug = (message: string) => {
				if (!getActiveConfig()?.debug) return;
				sendToRn({ type: 'debug', message });
			};

			const emitScrollbackMode = (
				active: boolean,
				phase: 'dragging' | 'active',
				requestId?: number,
			) => {
				scrollbackActive = active;
				scrollbackPhase = phase;
				sendToRn({
					type: 'scrollbackModeChanged',
					active,
					phase,
					instanceId,
					requestId,
				});
			};

			const resetPendingScroll = () => {
				if (rafId != null) {
					cancelAnimationFrame(rafId);
					rafId = null;
				}
				pendingLines = 0;
				remainderPx = 0;
			};

			const resetPointerTracking = () => {
				pointerIsDown = false;
				pendingPointerUp = false;
				activePointerId = null;
				lastVelocity = 0;
			};

			const releasePointerCapture = () => {
				if (!target || activePointerId == null) return;
				try {
					target.releasePointerCapture(activePointerId);
				} catch {
					// Ignore if capture already released.
				}
			};

			const resetState = () => {
				resetPendingScroll();
				releasePointerCapture();
				resetPointerTracking();
				state = 'Idle';
				copyModeState = 'off';
				copyModeConfidence = 'uncertain';
				entryIntent = null;
				scrollbackActive = false;
				scrollbackPhase = 'active';
			};

			const sendScrollInput = (payload: string) => {
				sendToRn({
					type: 'input',
					str: payload,
					instanceId,
					kind: 'scroll',
				});
			};

			const isValidCancelKey = (key: string) =>
				key.length === 1 && key.charCodeAt(0) !== 0x1b;

			const beginCopyModeEntry = (intent: EntryIntent) => {
				if (copyModeState !== 'off' || pendingEnterRequestId != null) return;
				copyModeState = 'entering';
				entryIntent = intent;
				const requestId = ++enterRequestCounter;
				pendingEnterRequestId = requestId;
				sendToRn({ type: 'tmuxEnterCopyMode', instanceId, requestId });
				return true;
			};

			const handleEnterAck = (requestId: number) => {
				if (pendingEnterRequestId !== requestId) return;
				pendingEnterRequestId = null;
				copyModeState = 'on';

				const pointerDownNow = pointerIsDown;
				const phase = pointerDownNow ? 'dragging' : 'active';

				if (entryIntent === 'scroll') {
					if (!scrollbackActive) {
						emitScrollbackMode(true, phase);
					} else if (scrollbackPhase !== phase) {
						emitScrollbackMode(true, phase);
					}
				}

				if (pendingPointerUp && !pointerDownNow) {
					state = 'ScrollbackActive';
				}

				pendingPointerUp = false;

				if (entryIntent === 'recovery') {
					const cfg = getActiveConfig();
					if (cfg && isValidCancelKey(cfg.cancelKey)) {
						sendScrollInput(cfg.cancelKey);
					}
					emitScrollbackMode(false, scrollbackPhase);
					resetState();
					return;
				}

				scheduleFlush();
			};

			const scheduleFlush = () => {
				if (rafId != null) return;
				rafId = requestAnimationFrame(() => {
					rafId = null;
					flushPendingLines();
				});
			};

			const clampPendingLines = (value: number) => {
				const pageStep = Math.max(10, term.rows - 1);
				const maxPending = pageStep * 5;
				return Math.max(-maxPending, Math.min(maxPending, value));
			};

			const flushPendingLines = () => {
				const cfg = getActiveConfig();
				if (!cfg) return;
				if (copyModeState !== 'on') return;
				if (!pendingLines) return;

				const direction = pendingLines > 0 ? 1 : -1;

				const absPending = Math.abs(pendingLines);
				const pageStep = Math.max(10, term.rows - 1);

				if (
					Math.abs(lastVelocity) >= cfg.flickVelocity &&
					absPending >= 4
				) {
					sendScrollInput(direction > 0 ? keyPageUp : keyPageDown);
					pendingLines -= direction * pageStep;
				}

				const remaining = Math.abs(pendingLines);
				if (remaining) {
					const count = Math.min(remaining, cfg.maxLinesPerFrame);
					const seq = direction > 0 ? keyScrollUp : keyScrollDown;
					let payload = '';
					for (let i = 0; i < count; i += 1) {
						payload += seq;
					}
					sendScrollInput(payload);
					pendingLines -= direction * count;
					copyModeConfidence = 'confident';
				}

				if (pendingLines !== 0) scheduleFlush();
			};

			const applyTouchAction = () => {
				const value = enabled ? 'none' : '';
				if (root) root.style.touchAction = value;
				if (term.element) term.element.style.touchAction = value;
			};

			const updateLineHeight = () => {
				if (!term.element || term.rows <= 0) return;
				const height = term.element.clientHeight;
				if (height > 0) {
					lineHeightPx = Math.max(12, height / term.rows);
				}
			};

			const installListeners = () => {
				if (listenersInstalled || !enabled) return;
				target = term.element ?? root;
				if (!target) return;
				listenersInstalled = true;

				if (!('PointerEvent' in window)) {
					emitDebug('PointerEvent not supported; touch scroll disabled.');
					return;
				}

				const onPointerDown = (event: PointerEvent) => {
					if (!enabled || selectionModeEnabled) return;
					if (event.pointerType && event.pointerType !== 'touch') return;
					if (!event.isPrimary) return;
					pointerIsDown = true;
					pendingPointerUp = false;
					activePointerId = event.pointerId;
					startX = event.clientX;
					startY = event.clientY;
					lastY = startY;
					lastMoveTs = event.timeStamp;
					state = 'Tracking';
				};

				const onPointerMove = (event: PointerEvent) => {
					if (!enabled || selectionModeEnabled) return;
					if (activePointerId !== event.pointerId) return;
					if (!pointerIsDown) return;

					const cfg = getActiveConfig();
					if (!cfg) return;

					const dx = event.clientX - startX;
					const dy = event.clientY - startY;
					const distance = Math.hypot(dx, dy);

					if (state === 'Tracking') {
						if (distance < cfg.slopPx) return;

						cancelLongPress();
						state = 'Scrolling';
						copyModeConfidence = 'uncertain';
						beginCopyModeEntry('scroll');
						emitScrollbackMode(true, 'dragging');
						try {
							target?.setPointerCapture(event.pointerId);
						} catch {
							// Ignore capture errors.
						}
					}

					if (state !== 'Scrolling') return;

					const deltaY = event.clientY - lastY;
					if (deltaY !== 0) {
						const direction = cfg.invertScroll ? -1 : 1;
						remainderPx += deltaY * direction;
						const nextLines = Math.trunc(remainderPx / cfg.pxPerLine);
						if (nextLines !== 0) {
							remainderPx -= nextLines * cfg.pxPerLine;
							pendingLines = clampPendingLines(pendingLines + nextLines);
							scheduleFlush();
						}
					}

					const dt = Math.max(event.timeStamp - lastMoveTs, 8);
					lastVelocity = deltaY / dt;
					lastMoveTs = event.timeStamp;
					lastY = event.clientY;

					event.preventDefault();
					event.stopPropagation();
				};

				const onPointerUp = (event: PointerEvent) => {
					if (activePointerId !== event.pointerId) return;
					pointerIsDown = false;
					releasePointerCapture();

					if (state === 'Scrolling') {
						if (copyModeState === 'on') {
							state = 'ScrollbackActive';
							emitScrollbackMode(true, 'active');
							flushPendingLines();
						} else {
							pendingPointerUp = true;
						}
					} else if (state === 'Tracking') {
						state = scrollbackActive ? 'ScrollbackActive' : 'Idle';
					}

					activePointerId = null;
				};

				const onPointerCancel = (event: PointerEvent) => {
					if (activePointerId !== event.pointerId) return;
					pointerIsDown = false;
					releasePointerCapture();
					activePointerId = null;
					state = scrollbackActive ? 'ScrollbackActive' : 'Idle';
					resetPendingScroll();
				};

				target.addEventListener('pointerdown', onPointerDown);
				target.addEventListener('pointermove', onPointerMove);
				target.addEventListener('pointerup', onPointerUp);
				target.addEventListener('pointercancel', onPointerCancel);

				return () => {
					target?.removeEventListener('pointerdown', onPointerDown);
					target?.removeEventListener('pointermove', onPointerMove);
					target?.removeEventListener('pointerup', onPointerUp);
					target?.removeEventListener('pointercancel', onPointerCancel);
					listenersInstalled = false;
				};
			};

			let removeListeners: (() => void) | undefined;

			const setConfig = (next: TouchScrollConfig) => {
				const prev = config;
				const shouldEnable = Boolean(next?.enabled);
				if (enabled && !shouldEnable) {
					exitScrollback({ emitExit: true });
				}
				config = next;
				if (shouldEnable !== enabled) {
					enabled = shouldEnable;
					applyTouchAction();
					if (!enabled) {
						resetState();
						removeListeners?.();
						removeListeners = undefined;
					} else {
						updateLineHeight();
						removeListeners = installListeners();
					}
				}

				if (
					prev?.enabled &&
					'prefixKey' in prev &&
					'prefixKey' in next &&
					(prev.prefixKey !== next.prefixKey ||
						prev.copyModeKey !== next.copyModeKey ||
						prev.cancelKey !== next.cancelKey)
				) {
					copyModeConfidence = 'uncertain';
				}
			};

			const exitScrollback = (opts?: { emitExit?: boolean; requestId?: number }) => {
				const emitExit = opts?.emitExit ?? true;
				const requestId = opts?.requestId;
				resetPendingScroll();
				releasePointerCapture();
				state = 'Idle';
				pendingPointerUp = false;
				pointerIsDown = false;
				let recoveryRequested = false;

				if (emitExit) {
					const cfg = getActiveConfig();
					if (cfg) {
						const canSendCancel = isValidCancelKey(cfg.cancelKey);
						if (!canSendCancel) {
							emitDebug('cancelKey invalid; auto-exit disabled');
						} else if (copyModeConfidence === 'confident') {
							sendScrollInput(cfg.cancelKey);
						} else {
							entryIntent = 'recovery';
							recoveryRequested = Boolean(beginCopyModeEntry('recovery'));
							if (!recoveryRequested) entryIntent = null;
						}
					}
				}

				if (!recoveryRequested) {
					copyModeState = 'off';
					entryIntent = null;
				}
				copyModeConfidence = 'uncertain';
				emitScrollbackMode(false, scrollbackPhase, requestId);
			};

			return {
				setConfig,
				exitScrollback,
				handleEnterAck,
				updateLineHeight,
			};
		};

		installLongPressHandlers();
		const touchScrollController = createTouchScrollController();
		term.onResize(() => {
			if (selectionModeEnabled) renderSelectionHandles();
			touchScrollController.updateLineHeight();
		});

		// Expose for debugging (typed)
		window.terminal = term;
		window.fitAddon = fitAddon;

		term.onData((data) => {
			sendToRn({ type: 'input', str: data, instanceId, kind: 'typing' });
		});

		// Report terminal size changes back to RN (for PTY resize)
		term.onResize(({ cols, rows }) => {
			if (cols >= 2 && rows >= 1) {
				sendToRn({ type: 'sizeChanged', cols, rows });
			}
		});

		// Remove old handler if any (just in case)
		if (window.__FRESSH_XTERM_MSG_HANDLER__)
			window.removeEventListener(
				'message',
				window.__FRESSH_XTERM_MSG_HANDLER__!,
			);

		// RN -> WebView handler (write, resize, setFont, setTheme, setOptions, clear, focus)
		const handler = (e: MessageEvent<BridgeOutboundMessage>) => {
			try {
				const msg = e.data;

				if (!msg || typeof msg.type !== 'string') return;

				// TODO: https://xtermjs.org/docs/guides/flowcontrol/#ideas-for-a-better-mechanism
				const termWrite = (bStr: string) => {
					const bytes = bStrToBinary(bStr);
					term.write(bytes);
				};

				switch (msg.type) {
					case 'write': {
						termWrite(msg.bStr);
						break;
					}
					case 'writeMany': {
						for (const bStr of msg.chunks) {
							termWrite(bStr);
						}
						break;
					}
					case 'resize': {
						term.resize(msg.cols, msg.rows);
						break;
					}
					case 'fit': {
						fitAddon.fit();
						// Report new size after fit (onResize may not fire if size unchanged)
						if (term.cols >= 2 && term.rows >= 1) {
							sendToRn({
								type: 'sizeChanged',
								cols: term.cols,
								rows: term.rows,
							});
						}
						break;
					}
					case 'getSelection': {
						const text = term.getSelection();
						sendToRn({
							type: 'selection',
							requestId: msg.requestId,
							text,
							instanceId,
						});
						break;
					}
					case 'setSelectionMode': {
						sendToRn({
							type: 'debug',
							message: `setSelectionMode ${msg.enabled ? 'on' : 'off'}`,
						});
						applySelectionMode(msg.enabled, { force: true });
						break;
					}
					case 'setTouchScrollConfig': {
						touchScrollController.setConfig(msg.config);
						break;
					}
					case 'exitScrollback': {
						touchScrollController.exitScrollback({
							emitExit: msg.emitExit,
							requestId: msg.requestId,
						});
						break;
					}
					case 'tmuxEnterCopyModeAck': {
						if (msg.instanceId !== instanceId) return;
						touchScrollController.handleEnterAck(msg.requestId);
						break;
					}
					case 'setOptions': {
						const { theme, ...rest } = msg.opts;
						for (const key in rest) {
							if (key === 'cols' || key === 'rows') continue;
							const value = rest[key as keyof typeof rest];
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							(term.options as any)[key] = value;
						}
						if (theme) {
							term.options.theme = {
								...term.options.theme,
								...theme,
							};
						}
						applyFontFamily(msg.opts.fontFamily);
						if (theme?.background) {
							document.body.style.backgroundColor = theme.background;
						}
						break;
					}
					case 'clear': {
						term.clear();
						break;
					}
					case 'focus': {
						term.focus();
						break;
					}
				}
			} catch (err) {
				sendToRn({
					type: 'debug',
					message: `message handler error: ${String(err)}`,
				});
			}
		};

		window.__FRESSH_XTERM_MSG_HANDLER__ = handler;
		window.addEventListener('message', handler);

		// Initial handshake (send once)
		setTimeout(() => {
			const ta = document.querySelector(
				'.xterm-helper-textarea',
			) as HTMLTextAreaElement | null;
			if (!ta) throw new Error('xterm-helper-textarea not found');
			ta.setAttribute('autocomplete', 'off');
			ta.setAttribute('autocorrect', 'off');
			ta.setAttribute('autocapitalize', 'none');
			ta.setAttribute('spellcheck', 'false');
			ta.setAttribute('inputmode', 'verbatim');

			return sendToRn({ type: 'initialized', instanceId });
		}, 200);
	} catch (e) {
		sendToRn({
			type: 'debug',
			message: `error in xtermjs-webview: ${String(e)}`,
		});
	}
};
