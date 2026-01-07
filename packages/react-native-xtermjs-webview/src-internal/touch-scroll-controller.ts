import { type Terminal } from '@xterm/xterm';
import { type BridgeInboundMessage, type TouchScrollConfig } from '../src/bridge';

type TouchScrollController = {
	setConfig: (next: TouchScrollConfig) => void;
	exitScrollback: (opts?: { emitExit?: boolean; requestId?: number }) => void;
	handleEnterAck: (requestId: number) => void;
	updateLineHeight: () => void;
};

export const createTouchScrollController = ({
	term,
	root,
	instanceId,
	sendToRn,
	isSelectionModeEnabled,
	cancelLongPress,
}: {
	term: Terminal;
	root: HTMLElement;
	instanceId: string;
	sendToRn: (msg: BridgeInboundMessage) => void;
	isSelectionModeEnabled: () => boolean;
	cancelLongPress: () => void;
}): TouchScrollController => {
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
			if (!enabled || isSelectionModeEnabled()) return;
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
			if (!enabled || isSelectionModeEnabled()) return;
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
