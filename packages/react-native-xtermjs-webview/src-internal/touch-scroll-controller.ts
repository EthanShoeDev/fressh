import { type Terminal } from '@xterm/xterm';
import {
	type BridgeInboundDraftMessage,
	type TouchScrollConfig,
} from '../src/bridge';

type TouchScrollController = {
	setConfig: (next: TouchScrollConfig) => void;
	exitScrollback: (opts?: { requestId?: number }) => void;
	handleEnterAck: (requestId: number) => void;
	updateLineHeight: () => void;
};

type TerminalWithPrivateBuffer = Terminal & {
	_core?: {
		_bufferService?: {
			buffer?: {
				ydisp?: number;
			};
		};
	};
	_bufferService?: {
		buffer?: {
			ydisp?: number;
		};
	};
	scrollToBottom?: () => void;
};

const touchScrollOwnerClass = 'fressh-touch-scroll-enabled';

export const createTouchScrollController = ({
	term,
	root,
	instanceId,
	sendToRn,
	isSelectionModeEnabled,
	cancelLongPress,
	scrollbackEnterTimeoutMs = 2_000,
}: {
	term: Terminal;
	root: HTMLElement;
	instanceId: string;
	sendToRn: (msg: BridgeInboundDraftMessage) => void;
	isSelectionModeEnabled: () => boolean;
	cancelLongPress: () => void;
	scrollbackEnterTimeoutMs?: number;
}): TouchScrollController => {
	type ScrollState = 'Idle' | 'Tracking' | 'Scrolling' | 'ScrollbackActive';
	type ScrollbackEnterState = 'off' | 'entering' | 'on';

	let config: TouchScrollConfig = { enabled: false };
	let enabled = false;

	let state: ScrollState = 'Idle';
	let scrollbackEnterState: ScrollbackEnterState = 'off';

	let scrollbackActive = false;
	let scrollbackPhase: 'dragging' | 'active' = 'active';

	let pointerIsDown = false;
	let pendingPointerUp = false;
	let activePointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let lastY = 0;
	let lastMoveTs = 0;
	let velocityEwma = 0;
	let lastScrollDirection = 0;
	let lastDirectionChangeTs = 0;

	let desiredLines = 0;
	let sentLines = 0;
	let flushTimerId: ReturnType<typeof setTimeout> | null = null;
	let rttEstimateMs = 80;
	let lastFlushTs = 0;
	let inFlightFlushes: number[] = [];
	let scrollBatchSeq = 0;
	let debugOverlayEl: HTMLDivElement | null = null;
	let debugOverlayLastTs = 0;
	let debugTelemetryLastTs = 0;
	let lastBatch: {
		direction: 'up' | 'down';
		pages: number;
		lines: number;
		totalLines: number;
		pendingLines: number;
	} | null = null;

	let pendingEnterRequestId: number | null = null;
	let enterRequestCounter = 0;
	let pendingEnterTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let pointerGeneration = 0;
	let pendingEnterPointerGeneration: number | null = null;

	let lineHeightPx = 16;
	let target: HTMLElement | null = null;
	let listenersInstalled = false;

	const getPageStep = () => Math.max(10, term.rows - 1);

	const getActiveConfig = () => {
		if (!config || !config.enabled) return null;
		const pageStep = getPageStep();
		const fallbackExtraLines = Math.max(1, Math.min(24, pageStep));
		return {
			pxPerLine: config.pxPerLine ?? Math.max(12, lineHeightPx),
			slopPx: config.slopPx ?? 8,
			invertScroll: config.invertScroll ?? false,
			coalesceMs: config.coalesceMs ?? 24,
			minFlushMs: config.minFlushMs ?? 16,
			maxFlushMs: config.maxFlushMs ?? 80,
			maxPagesPerFlush: config.maxPagesPerFlush ?? 6,
			maxExtraLines:
				config.maxExtraLines ?? config.maxLinesPerFrame ?? fallbackExtraLines,
			maxBacklogPages: config.maxBacklogPages ?? 50,
			velocityMultiplierEnabled: config.velocityMultiplierEnabled ?? true,
			velocityThreshold: config.velocityThreshold ?? config.flickVelocity ?? 1,
			velocityBoost: config.velocityBoost ?? 0.8,
			velocityBoostMax: config.velocityBoostMax ?? 6,
			velocitySmoothing: config.velocitySmoothing ?? 0.2,
			backlogMultiplierEnabled: config.backlogMultiplierEnabled ?? true,
			backlogBoostRefPages: config.backlogBoostRefPages ?? 2,
			backlogBoostMax: config.backlogBoostMax ?? 2,
			rttEwmaAlpha: config.rttEwmaAlpha ?? 0.2,
			debugOverlay: config.debugOverlay ?? false,
			debugTelemetry: config.debugTelemetry ?? false,
			debugTelemetryIntervalMs: config.debugTelemetryIntervalMs ?? 120,
			debug: config.debug ?? false,
		};
	};

	const nowMs = () =>
		typeof performance !== 'undefined' && performance.now
			? performance.now()
			: Date.now();

	const emitDebug = (message: string) => {
		if (!getActiveConfig()?.debug) return;
		sendToRn({ type: 'debug', message });
	};

	const getLocalScrollDiagnostics = () => {
		const privateTerm = term as TerminalWithPrivateBuffer;
		const buffer =
			privateTerm._bufferService?.buffer ??
			privateTerm._core?._bufferService?.buffer;
		const viewport =
			term.element?.querySelector<HTMLElement>('.xterm-viewport') ?? null;
		const screen =
			term.element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
		const viewportScrollable =
			viewport && viewport.scrollHeight > viewport.clientHeight ? 1 : 0;
		const rootScrollable =
			root && root.scrollHeight > root.clientHeight ? 1 : 0;
		return [
			'localScroll',
			`scrollback=${String(term.options.scrollback ?? 'unknown')}`,
			`ydisp=${String(buffer?.ydisp ?? 'unknown')}`,
			`rows=${String(term.rows ?? 'unknown')}`,
			`lineHeight=${String(lineHeightPx)}`,
			`viewportTop=${String(viewport?.scrollTop ?? 'missing')}`,
			`viewportScrollable=${viewportScrollable}`,
			`viewportClient=${String(viewport?.clientHeight ?? 'missing')}`,
			`viewportScroll=${String(viewport?.scrollHeight ?? 'missing')}`,
			`screenClient=${String(screen?.clientHeight ?? 'missing')}`,
			`screenScroll=${String(screen?.scrollHeight ?? 'missing')}`,
			`rootTop=${String(root?.scrollTop ?? 'missing')}`,
			`rootScrollable=${rootScrollable}`,
			`rootClient=${String(root?.clientHeight ?? 'missing')}`,
			`rootScroll=${String(root?.scrollHeight ?? 'missing')}`,
		].join(' ');
	};

	const pinLocalViewportToBottom = () => {
		const privateTerm = term as TerminalWithPrivateBuffer;
		try {
			privateTerm.scrollToBottom?.();
		} catch {
			// Best effort; the DOM fallback below handles the usual xterm viewport.
		}
		const viewport =
			term.element?.querySelector<HTMLElement>('.xterm-viewport') ?? null;
		if (!viewport) return;
		const bottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
		if (viewport.scrollTop !== bottom) viewport.scrollTop = bottom;
	};

	const ensureDebugOverlay = () => {
		if (debugOverlayEl || !root) return;
		const el = document.createElement('div');
		el.style.position = 'absolute';
		el.style.top = '8px';
		el.style.left = '8px';
		el.style.padding = '6px 8px';
		el.style.background = 'rgba(15, 23, 42, 0.88)';
		el.style.border = '1px solid rgba(148, 163, 184, 0.5)';
		el.style.borderRadius = '6px';
		el.style.fontFamily =
			'"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
		el.style.fontSize = '11px';
		el.style.lineHeight = '1.3';
		el.style.color = '#e2e8f0';
		el.style.zIndex = '10';
		el.style.pointerEvents = 'none';
		el.style.whiteSpace = 'pre';
		el.textContent = 'touch scroll debug...';
		root.appendChild(el);
		debugOverlayEl = el;
	};

	const removeDebugOverlay = () => {
		if (!debugOverlayEl) return;
		debugOverlayEl.remove();
		debugOverlayEl = null;
	};

	const emitTelemetry = (message: string, opts?: { force?: boolean }) => {
		const cfg = getActiveConfig();
		if (!cfg?.debugTelemetry) return;
		const now = nowMs();
		if (
			!opts?.force &&
			now - debugTelemetryLastTs < cfg.debugTelemetryIntervalMs
		) {
			return;
		}
		debugTelemetryLastTs = now;
		sendToRn({ type: 'debug', message });
	};

	const updateDebugOverlay = (opts?: { force?: boolean }) => {
		const cfg = getActiveConfig();
		if (!cfg?.debugOverlay) {
			removeDebugOverlay();
			return;
		}
		ensureDebugOverlay();
		if (!debugOverlayEl) return;
		const now = nowMs();
		if (
			!opts?.force &&
			now - debugOverlayLastTs < cfg.debugTelemetryIntervalMs
		) {
			return;
		}
		debugOverlayLastTs = now;
		const pending = Math.trunc(desiredLines - sentLines);
		const batch = lastBatch
			? `${lastBatch.direction} p${lastBatch.pages} l${lastBatch.lines}`
			: '—';
		const lines = [
			`state=${state} enter=${scrollbackEnterState} sb=${scrollbackActive ? '1' : '0'}`,
			`pending=${pending} desired=${desiredLines.toFixed(1)} sent=${sentLines.toFixed(1)}`,
			`vel=${velocityEwma.toFixed(2)} rtt=${Math.round(rttEstimateMs)}ms inflight=${inFlightFlushes.length}`,
			`batch=${batch}`,
		];
		debugOverlayEl.textContent = lines.join('\n');
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
		if (flushTimerId != null) {
			clearTimeout(flushTimerId);
			flushTimerId = null;
		}
		desiredLines = 0;
		sentLines = 0;
		velocityEwma = 0;
		lastScrollDirection = 0;
		lastDirectionChangeTs = 0;
		rttEstimateMs = 80;
		lastFlushTs = 0;
		inFlightFlushes = [];
		lastBatch = null;
		debugOverlayLastTs = 0;
		debugTelemetryLastTs = 0;
		updateDebugOverlay({ force: true });
	};

	const clearPendingEnterTimeout = () => {
		if (pendingEnterTimeoutId == null) return;
		clearTimeout(pendingEnterTimeoutId);
		pendingEnterTimeoutId = null;
	};

	const clearPendingEnterRequest = () => {
		clearPendingEnterTimeout();
		pendingEnterRequestId = null;
		pendingEnterPointerGeneration = null;
	};

	const resetPointerTracking = () => {
		pointerIsDown = false;
		pendingPointerUp = false;
		activePointerId = null;
		velocityEwma = 0;
		lastScrollDirection = 0;
		lastDirectionChangeTs = 0;
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
		clearPendingEnterRequest();
		releasePointerCapture();
		resetPointerTracking();
		state = 'Idle';
		scrollbackEnterState = 'off';
		scrollbackActive = false;
		scrollbackPhase = 'active';
	};

	const sendScrollBatch = (payload: {
		direction: 'up' | 'down';
		pages: number;
		lines: number;
		pageStep: number;
	}) => {
		scrollBatchSeq += 1;
		sendToRn({
			type: 'scrollbackBatch',
			direction: payload.direction,
			pages: payload.pages,
			lines: payload.lines,
			pageStep: payload.pageStep,
			instanceId,
			seq: scrollBatchSeq,
			ts: Date.now(),
		});
	};

	const clamp = (value: number, min: number, max: number) =>
		Math.max(min, Math.min(max, value));

	const clampDesiredLines = (value: number) => {
		const cfg = getActiveConfig();
		if (!cfg) return value;
		const pageStep = getPageStep();
		const maxBacklogLines = Math.max(pageStep, cfg.maxBacklogPages * pageStep);
		const delta = value - sentLines;
		if (Math.abs(delta) > maxBacklogLines) {
			return sentLines + Math.sign(delta) * maxBacklogLines;
		}
		return value;
	};

	const scheduleFlush = (delayMs?: number) => {
		if (flushTimerId != null) return;
		const cfg = getActiveConfig();
		if (!cfg) return;
		const delay = Math.max(0, delayMs ?? cfg.coalesceMs);
		flushTimerId = setTimeout(() => {
			flushTimerId = null;
			flushPendingLines();
		}, delay);
	};

	const flushPendingLines = (opts?: { force?: boolean }) => {
		const cfg = getActiveConfig();
		if (!cfg) return;
		if (scrollbackEnterState !== 'on') return;

		const pending = Math.trunc(desiredLines - sentLines);
		if (!pending) return;

		const absPending = Math.abs(pending);
		const pageStep = getPageStep();
		const now = nowMs();
		const inFlightCount = inFlightFlushes.length;

		const targetInterval = clamp(
			rttEstimateMs / 2,
			cfg.minFlushMs,
			cfg.maxFlushMs,
		);
		const backlogThreshold = pageStep;

		if (
			!opts?.force &&
			inFlightCount > 0 &&
			now - lastFlushTs < targetInterval &&
			absPending < backlogThreshold
		) {
			scheduleFlush(targetInterval - (now - lastFlushTs));
			return;
		}

		const maxPagesPerFlush = Math.max(1, cfg.maxPagesPerFlush);
		const basePages = Math.min(2, maxPagesPerFlush);
		const backlogPages = absPending / pageStep;
		let dynamicMaxPages = basePages;
		if (backlogPages > basePages) {
			dynamicMaxPages = Math.min(maxPagesPerFlush, Math.ceil(backlogPages / 2));
		}
		if (rttEstimateMs > 120) {
			dynamicMaxPages = Math.min(maxPagesPerFlush, dynamicMaxPages + 1);
		}

		const maxExtraLines = Math.max(
			0,
			Math.min(cfg.maxExtraLines, pageStep - 1),
		);

		const pages = Math.min(dynamicMaxPages, Math.floor(absPending / pageStep));
		let lines = absPending - pages * pageStep;
		if (lines > maxExtraLines) lines = maxExtraLines;

		const totalLines = pages * pageStep + lines;
		if (!totalLines) return;

		lastBatch = {
			direction: pending > 0 ? 'up' : 'down',
			pages,
			lines,
			totalLines,
			pendingLines: pending,
		};
		sendScrollBatch({
			direction: pending > 0 ? 'up' : 'down',
			pages,
			lines,
			pageStep,
		});
		sentLines += (pending > 0 ? 1 : -1) * totalLines;
		lastFlushTs = now;
		inFlightFlushes.push(now);
		emitTelemetry(
			`[touch-scroll] batch dir=${pending > 0 ? 'up' : 'down'} pages=${pages} lines=${lines} pending=${pending} rtt=${Math.round(
				rttEstimateMs,
			)}ms inflight=${inFlightCount}`,
		);
		updateDebugOverlay();

		if (Math.trunc(desiredLines - sentLines) !== 0) scheduleFlush();
	};

	const requestScrollbackEnter = () => {
		if (scrollbackEnterState !== 'off' || pendingEnterRequestId != null)
			return;
		scrollbackEnterState = 'entering';
		const requestId = ++enterRequestCounter;
		pendingEnterRequestId = requestId;
		pendingEnterPointerGeneration = pointerGeneration;
		clearPendingEnterTimeout();
		pendingEnterTimeoutId = setTimeout(() => {
			if (pendingEnterRequestId !== requestId) return;
			if (
				pointerIsDown &&
				activePointerId != null &&
				pendingEnterPointerGeneration !== pointerGeneration
			) {
				clearPendingEnterRequest();
				scrollbackEnterState = 'off';
				emitScrollbackMode(false, scrollbackPhase, requestId);
				requestScrollbackEnter();
				return;
			}
			exitScrollback({ requestId });
		}, scrollbackEnterTimeoutMs);
		sendToRn({ type: 'scrollbackEnterRequested', instanceId, requestId });
		return true;
	};

	const handleEnterAck = (requestId: number) => {
		if (pendingEnterRequestId !== requestId) return;
		clearPendingEnterRequest();
		scrollbackEnterState = 'on';
		pinLocalViewportToBottom();

		const pointerDownNow = pointerIsDown;
		const phase = pointerDownNow ? 'dragging' : 'active';

		if (!scrollbackActive) {
			emitScrollbackMode(true, phase);
		} else if (scrollbackPhase !== phase) {
			emitScrollbackMode(true, phase);
		}

		if (pendingPointerUp && !pointerDownNow) {
			state = 'ScrollbackActive';
		}

		pendingPointerUp = false;

		scheduleFlush();
	};

	const applyTouchAction = () => {
		const value = enabled ? 'none' : '';
		document.body?.classList.toggle(touchScrollOwnerClass, enabled);
		const touchTargets = [
			root,
			term.element,
			term.element?.querySelector<HTMLElement>('.xterm-viewport') ?? null,
			term.element?.querySelector<HTMLElement>('.xterm-screen') ?? null,
		];
		for (const target of touchTargets) {
			if (target) target.style.touchAction = value;
		}
	};

	const updateLineHeight = () => {
		if (!term.element || term.rows <= 0) return;
		const height = term.element.clientHeight;
		if (height > 0) {
			lineHeightPx = Math.max(12, height / term.rows);
		}
	};

	const cancelTrackingForSelectionMode = () => {
		const previousPhase = scrollbackPhase;
		clearPendingEnterRequest();
		scrollbackEnterState = 'off';
		resetPendingScroll();
		releasePointerCapture();
		resetPointerTracking();
		state = 'Idle';
		if (scrollbackActive) {
			emitScrollbackMode(false, previousPhase);
		}
		updateDebugOverlay({ force: true });
	};

	const installListeners = () => {
		if (listenersInstalled || !enabled) return;
		target = term.element ?? root;
		if (!target) return;
		listenersInstalled = true;

		const supportsPointerEvents = 'PointerEvent' in window;
		if (!supportsPointerEvents) {
			emitDebug('PointerEvent not supported; touch scroll disabled.');
		}

		const onPointerDown = (event: PointerEvent) => {
			if (!enabled) return;
			if (isSelectionModeEnabled()) {
				cancelTrackingForSelectionMode();
				return;
			}
			if (event.pointerType && event.pointerType !== 'touch') return;
			if (!event.isPrimary) return;
			pointerGeneration += 1;
			pointerIsDown = true;
			pendingPointerUp = false;
			activePointerId = event.pointerId;
			startX = event.clientX;
			startY = event.clientY;
				lastY = startY;
				lastMoveTs = event.timeStamp;
				state = 'Tracking';
				pinLocalViewportToBottom();
				emitTelemetry(
					`touch-scroll down state=${state} ${getLocalScrollDiagnostics()}`,
					{ force: true },
				);
			};

		const onPointerMove = (event: PointerEvent) => {
			if (!enabled) return;
			if (isSelectionModeEnabled()) {
				cancelTrackingForSelectionMode();
				return;
			}
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
					requestScrollbackEnter();
					emitScrollbackMode(true, 'dragging');
					pinLocalViewportToBottom();
					emitTelemetry(
						`touch-scroll start distance=${distance.toFixed(1)} ${getLocalScrollDiagnostics()}`,
						{ force: true },
					);
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
				const deltaLines = (deltaY * direction) / cfg.pxPerLine;
				if (deltaLines !== 0) {
					const now = nowMs();
					const dt = Math.max(event.timeStamp - lastMoveTs, 8);
					const speed = Math.abs(deltaY) / dt;
					velocityEwma =
						velocityEwma + (speed - velocityEwma) * cfg.velocitySmoothing;

					const scrollDirection = Math.sign(deltaLines);
					if (scrollDirection && scrollDirection !== lastScrollDirection) {
						lastScrollDirection = scrollDirection;
						velocityEwma = 0;
						lastDirectionChangeTs = now;
					}

					let multiplier = 1;
					if (cfg.velocityMultiplierEnabled) {
						if (velocityEwma > cfg.velocityThreshold) {
							multiplier +=
								cfg.velocityBoost * (velocityEwma - cfg.velocityThreshold);
						}
						multiplier = Math.min(multiplier, cfg.velocityBoostMax);
					}
					if (cfg.backlogMultiplierEnabled) {
						const backlogLines = Math.abs(desiredLines - sentLines);
						const backlogRefLines =
							Math.max(1, cfg.backlogBoostRefPages) * Math.max(1, term.rows);
						const backlogBoost = Math.min(
							backlogLines / backlogRefLines,
							cfg.backlogBoostMax,
						);
						multiplier *= 1 + backlogBoost;
					}
					if (lastDirectionChangeTs && now - lastDirectionChangeTs < 80) {
						multiplier *= 0.6;
					}

					desiredLines = clampDesiredLines(
						desiredLines + deltaLines * multiplier,
					);
					scheduleFlush();
					updateDebugOverlay();
					}
				}

				pinLocalViewportToBottom();
				emitTelemetry(
					`touch-scroll move dy=${deltaY.toFixed(1)} desired=${desiredLines.toFixed(1)} sent=${sentLines.toFixed(1)} ${getLocalScrollDiagnostics()}`,
				);

				lastMoveTs = event.timeStamp;
				lastY = event.clientY;

			event.preventDefault();
			event.stopPropagation();
		};

		const onPointerUp = (event: PointerEvent) => {
			if (isSelectionModeEnabled()) {
				cancelTrackingForSelectionMode();
				return;
			}
			if (activePointerId !== event.pointerId) return;
			pointerIsDown = false;
			releasePointerCapture();

			if (state === 'Scrolling') {
				if (scrollbackEnterState === 'on') {
					state = 'ScrollbackActive';
					emitScrollbackMode(true, 'active');
					flushPendingLines({ force: true });
				} else {
					pendingPointerUp = true;
				}
				} else if (state === 'Tracking') {
					state = scrollbackActive ? 'ScrollbackActive' : 'Idle';
				}

				pinLocalViewportToBottom();
				emitTelemetry(
					`touch-scroll up state=${state} ${getLocalScrollDiagnostics()}`,
					{ force: true },
				);
				activePointerId = null;
			};

		const onPointerCancel = (event: PointerEvent) => {
			if (isSelectionModeEnabled()) {
				cancelTrackingForSelectionMode();
				return;
			}
			if (activePointerId !== event.pointerId) return;
			const requestId = pendingEnterRequestId ?? undefined;
			pointerIsDown = false;
			releasePointerCapture();
			activePointerId = null;
			if (scrollbackActive || pendingEnterRequestId != null) {
				exitScrollback({ requestId });
			} else {
				state = 'Idle';
				resetPendingScroll();
			}
		};

		const touchToPointerEvent = (
			type: string,
			event: TouchEvent,
			touch: Touch,
		) =>
			({
				type,
				pointerId: touch.identifier,
				clientX: touch.clientX,
				clientY: touch.clientY,
				timeStamp: event.timeStamp,
				pointerType: 'touch',
				isPrimary: true,
				preventDefault: () => event.preventDefault(),
				stopPropagation: () => event.stopPropagation(),
			}) as PointerEvent;

		const getTouchForActivePointer = (event: TouchEvent) => {
			for (const touch of Array.from(event.changedTouches)) {
				if (activePointerId === touch.identifier) return touch;
			}
			return null;
		};

		const consumeTouchScrollEvent = (event: TouchEvent) => {
			event.preventDefault();
			event.stopPropagation();
		};

		const onTouchStart = (event: TouchEvent) => {
			if (!enabled) return;
			if (isSelectionModeEnabled()) return;
			if (pointerIsDown) return;
			if (event.touches.length !== 1) return;
			const touch = event.changedTouches[0] ?? event.touches[0];
			if (!touch) return;
			onPointerDown(touchToPointerEvent('pointerdown', event, touch));
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!enabled) return;
			const touch = getTouchForActivePointer(event);
			if (!touch) return;
			onPointerMove(touchToPointerEvent('pointermove', event, touch));
			if (state === 'Scrolling' || state === 'ScrollbackActive') {
				consumeTouchScrollEvent(event);
			}
		};

		const onTouchEnd = (event: TouchEvent) => {
			const touch = getTouchForActivePointer(event);
			if (!touch) return;
			onPointerUp(touchToPointerEvent('pointerup', event, touch));
		};

		const onTouchCancel = (event: TouchEvent) => {
			const touch = getTouchForActivePointer(event);
			if (!touch) return;
			onPointerCancel(touchToPointerEvent('pointercancel', event, touch));
		};

		if (supportsPointerEvents) {
			target.addEventListener('pointerdown', onPointerDown);
			target.addEventListener('pointermove', onPointerMove);
			target.addEventListener('pointerup', onPointerUp);
			target.addEventListener('pointercancel', onPointerCancel);
		}
		target.addEventListener('touchstart', onTouchStart, {
			capture: true,
			passive: false,
		});
		target.addEventListener('touchmove', onTouchMove, {
			capture: true,
			passive: false,
		});
		target.addEventListener('touchend', onTouchEnd, {
			capture: true,
			passive: false,
		});
		target.addEventListener('touchcancel', onTouchCancel, {
			capture: true,
			passive: false,
		});

		return () => {
			if (supportsPointerEvents) {
				target?.removeEventListener('pointerdown', onPointerDown);
				target?.removeEventListener('pointermove', onPointerMove);
				target?.removeEventListener('pointerup', onPointerUp);
				target?.removeEventListener('pointercancel', onPointerCancel);
			}
			target?.removeEventListener('touchstart', onTouchStart, { capture: true });
			target?.removeEventListener('touchmove', onTouchMove, { capture: true });
			target?.removeEventListener('touchend', onTouchEnd, { capture: true });
			target?.removeEventListener('touchcancel', onTouchCancel, {
				capture: true,
			});
			listenersInstalled = false;
		};
	};

	let removeListeners: (() => void) | undefined;

	const setConfig = (next: TouchScrollConfig) => {
		const shouldEnable = Boolean(next?.enabled);
		if (enabled && !shouldEnable) {
			exitScrollback();
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
		updateDebugOverlay({ force: true });
	};

	const exitScrollback = (opts?: { requestId?: number }) => {
		const requestId = opts?.requestId;
		resetPendingScroll();
		clearPendingEnterRequest();
		releasePointerCapture();
		state = 'Idle';
		pendingPointerUp = false;
		pointerIsDown = false;
		scrollbackEnterState = 'off';
		emitScrollbackMode(false, scrollbackPhase, requestId);
	};

	const installAckListener = () => {
		const termWithHooks = term as Terminal & {
			onWriteParsed?: (cb: () => void) => { dispose: () => void };
			onRender?: (cb: () => void) => { dispose: () => void };
		};
		const handleScrollAck = () => {
			if (!inFlightFlushes.length) return;
			const now = nowMs();
			const sentAt = inFlightFlushes.shift();
			if (sentAt != null) {
				const cfg = getActiveConfig();
				const alpha = cfg?.rttEwmaAlpha ?? 0.2;
				const sample = now - sentAt;
				rttEstimateMs =
					rttEstimateMs === 0
						? sample
						: rttEstimateMs * (1 - alpha) + sample * alpha;
			}
			if (inFlightFlushes.length === 0) scheduleFlush(0);
			updateDebugOverlay();
		};

		return (
			termWithHooks.onWriteParsed?.(handleScrollAck) ??
			termWithHooks.onRender?.(handleScrollAck)
		);
	};

	installAckListener();

	return {
		setConfig,
		exitScrollback,
		handleEnterAck,
		updateLineHeight,
	};
};
