import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
	type BridgeInboundMessage,
	type TouchScrollConfig,
} from '../src/bridge';
import { createSelectionHandles } from './selection-handles';
import { createTouchScrollController } from './touch-scroll-controller';

class FakeStyle {
	[key: string]: string | ((name: string, value: string) => void) | undefined;

	setProperty(name: string, value: string) {
		this[name] = value;
	}

	getPropertyValue(name: string) {
		const value = this[name];
		return typeof value === 'string' ? value : '';
	}
}

class FakeClassList {
	private readonly tokens = new Set<string>();

	add(...values: string[]) {
		for (const value of values) this.tokens.add(value);
	}

	remove(...values: string[]) {
		for (const value of values) this.tokens.delete(value);
	}

	toggle(value: string, force?: boolean) {
		if (force === undefined) {
			if (this.tokens.has(value)) {
				this.tokens.delete(value);
				return false;
			}
			this.tokens.add(value);
			return true;
		}
		if (force) {
			this.tokens.add(value);
			return true;
		}
		this.tokens.delete(value);
		return false;
	}

	contains(value: string) {
		return this.tokens.has(value);
	}
}

type FakeListener = (event: Event) => void;

class FakeElement {
	readonly style = new FakeStyle();
	readonly dataset: Record<string, string> = {};
	readonly classList = new FakeClassList();
	readonly children: FakeElement[] = [];
	readonly listeners = new Map<string, Set<FakeListener>>();
	parentElement: FakeElement | null = null;
	textContent = '';
	id = '';
	className = '';
	private rect = {
		left: 0,
		top: 0,
		right: 320,
		bottom: 200,
		width: 320,
		height: 200,
	};

	readonly tagName: string;

	constructor(tagName: string) {
		this.tagName = tagName;
	}

	appendChild(child: FakeElement) {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	removeChild(child: FakeElement) {
		const index = this.children.indexOf(child);
		if (index >= 0) {
			this.children.splice(index, 1);
			child.parentElement = null;
		}
		return child;
	}

	remove() {
		this.parentElement?.removeChild(this);
	}

	addEventListener(type: string, listener: FakeListener) {
		const listeners = this.listeners.get(type) ?? new Set<FakeListener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: FakeListener) {
		this.listeners.get(type)?.delete(listener);
	}

	setPointerCapture(pointerId: number) {
		FakeElement.pointerCaptures.set(pointerId, this);
	}

	releasePointerCapture(pointerId: number) {
		if (FakeElement.pointerCaptures.get(pointerId) === this) {
			FakeElement.pointerCaptures.delete(pointerId);
		}
	}

	getBoundingClientRect() {
		return this.rect;
	}

	setBoundingClientRect(
		rect: Partial<{
			left: number;
			top: number;
			right: number;
			bottom: number;
			width: number;
			height: number;
		}>,
	) {
		this.rect = { ...this.rect, ...rect };
	}

	setAttribute(name: string, value: string) {
		if (name === 'id') this.id = value;
	}

	querySelector<T extends FakeElement>(selector: string): T | null {
		const match = selector.startsWith('.')
			? selector.slice(1)
			: selector.startsWith('#')
				? selector.slice(1)
				: null;
		if (match) {
			for (const child of this.children) {
				if (
					(selector.startsWith('.') &&
						child.className.split(/\s+/).includes(match)) ||
					(selector.startsWith('#') && child.id === match)
				) {
					return child as T;
				}
				const nested = child.querySelector<T>(selector);
				if (nested) return nested;
			}
		}
		return null;
	}

	emit(type: string, event: Event) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	static pointerCaptures = new Map<number, FakeElement>();
}

class FakeDocument {
	readonly body = new FakeElement('body');
	readonly documentElement = new FakeElement('html');
	readonly head = new FakeElement('head');

	createElement(tagName: string) {
		return new FakeElement(tagName);
	}

	createElementNS(_namespace: string, tagName: string) {
		return new FakeElement(tagName);
	}

	getElementById(id: string) {
		return (
			this.head.querySelector<FakeElement>(`#${id}`) ??
			this.body.querySelector<FakeElement>(`#${id}`) ??
			this.documentElement.querySelector<FakeElement>(`#${id}`) ??
			null
		);
	}
}

const createPointerEvent = (
	type: string,
	init: {
		pointerId: number;
		clientX: number;
		clientY: number;
		timeStamp?: number;
		pointerType?: string;
		isPrimary?: boolean;
	},
) => {
	let defaultPrevented = false;
	return {
		type,
		pointerId: init.pointerId,
		clientX: init.clientX,
		clientY: init.clientY,
		timeStamp: init.timeStamp ?? 0,
		pointerType: init.pointerType ?? 'touch',
		isPrimary: init.isPrimary ?? true,
		get defaultPrevented() {
			return defaultPrevented;
		},
		preventDefault() {
			defaultPrevented = true;
		},
		stopPropagation() {},
	} as PointerEvent;
};

const dispatchPointerEvent = (
	target: FakeElement,
	type: string,
	init: Parameters<typeof createPointerEvent>[1],
) => {
	const event = createPointerEvent(type, init);
	const captureTarget =
		type === 'pointerdown'
			? undefined
			: FakeElement.pointerCaptures.get(init.pointerId);
	(captureTarget ?? target).emit(type, event as unknown as Event);
	return event;
};

const installDomGlobals = (t: TestContext) => {
	const originalWindow = (globalThis as Record<string, unknown>).window;
	const originalDocument = (globalThis as Record<string, unknown>).document;
	const document = new FakeDocument();
	const window = {
		document,
		PointerEvent: class PointerEvent {},
		getComputedStyle(element: FakeElement) {
			return {
				position: element.style.position ?? 'static',
				getPropertyValue(name: string) {
					return element.style.getPropertyValue(name);
				},
			};
		},
	};
	(globalThis as Record<string, unknown>).window = window;
	(globalThis as Record<string, unknown>).document = document;
	t.after(() => {
		(globalThis as Record<string, unknown>).window = originalWindow;
		(globalThis as Record<string, unknown>).document = originalDocument;
		FakeElement.pointerCaptures.clear();
	});
	return { document, window };
};

const createTouchScrollTerm = (element: FakeElement, rows = 24) =>
	({
		rows,
		element,
	}) as const;

const createSelectionTerm = (
	element: FakeElement,
	screenElement: FakeElement,
) =>
	({
		element,
		options: {
			disableStdin: false,
			screenReaderMode: false,
		},
		modes: {
			mouseTrackingMode: 'none',
		},
		getSelection: () => '',
		clearSelection() {},
		_core: {
			_screenElement: screenElement,
			_mouseService: {
				getCoords: () => [1, 1] as [number, number],
			},
			_bufferService: {
				cols: 80,
				rows: 24,
				buffer: {
					ydisp: 0,
					lines: {
						get: () => undefined,
					},
				},
			},
			_selectionService: {
				enable() {},
				disable() {},
				clearSelection() {},
				refresh() {},
				_model: {
					selectionStartLength: 0,
					clearSelection() {},
				},
			},
			_renderService: {
				dimensions: {
					css: {
						cell: {
							width: 10,
							height: 20,
						},
					},
				},
			},
		},
	}) as const;

void test('touch scroll cancels pending scrollback entry when selection mode takes over', (t) => {
	installDomGlobals(t);

	const root = new FakeElement('div');
	root.setBoundingClientRect({
		width: 320,
		height: 200,
		right: 320,
		bottom: 200,
	});

	const messages: BridgeInboundMessage[] = [];
	let selectionModeEnabled = false;
	const controller = createTouchScrollController({
		term: createTouchScrollTerm(root) as never,
		root: root as never,
		instanceId: 'instance-1',
		sendToRn: (message) => {
			messages.push(message);
		},
		isSelectionModeEnabled: () => selectionModeEnabled,
		cancelLongPress() {},
	});

	const config: TouchScrollConfig = { enabled: true, slopPx: 8, pxPerLine: 10 };
	controller.setConfig(config);

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 1,
		clientX: 40,
		clientY: 40,
		timeStamp: 0,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 1,
		clientX: 40,
		clientY: 64,
		timeStamp: 16,
	});

	selectionModeEnabled = true;
	dispatchPointerEvent(root, 'pointerup', {
		pointerId: 1,
		clientX: 40,
		clientY: 64,
		timeStamp: 24,
	});
	controller.handleEnterAck(1);

	const scrollbackTransitions = messages
		.filter(
			(
				message,
			): message is Extract<
				BridgeInboundMessage,
				{ type: 'scrollbackModeChanged' }
			> => message.type === 'scrollbackModeChanged',
		)
		.map(({ active, phase }) => ({ active, phase }));

	assert.deepEqual(scrollbackTransitions, [
		{ active: true, phase: 'dragging' },
		{ active: false, phase: 'dragging' },
	]);
});

void test('touch scroll batch includes the producer page step', (t) => {
	installDomGlobals(t);

	const root = new FakeElement('div');
	root.setBoundingClientRect({
		width: 320,
		height: 200,
		right: 320,
		bottom: 200,
	});

	const messages: BridgeInboundMessage[] = [];
	const controller = createTouchScrollController({
		term: createTouchScrollTerm(root, 25) as never,
		root: root as never,
		instanceId: 'instance-1',
		sendToRn: (message) => {
			messages.push(message);
		},
		isSelectionModeEnabled: () => false,
		cancelLongPress() {},
	});

	controller.setConfig({
		enabled: true,
		slopPx: 0,
		pxPerLine: 1,
		maxPagesPerFlush: 2,
		maxExtraLines: 999,
		velocityMultiplierEnabled: false,
		backlogMultiplierEnabled: false,
	});

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 1,
		clientX: 40,
		clientY: 40,
		timeStamp: 0,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 1,
		clientX: 40,
		clientY: 140,
		timeStamp: 100,
	});
	controller.handleEnterAck(1);
	dispatchPointerEvent(root, 'pointerup', {
		pointerId: 1,
		clientX: 40,
		clientY: 140,
		timeStamp: 120,
	});

	const scrollBatch = messages.find(
		(
			message,
		): message is Extract<BridgeInboundMessage, { type: 'scrollbackBatch' }> =>
			message.type === 'scrollbackBatch',
	);

	assert.equal(scrollBatch?.pageStep, 24);
});

void test('touch scroll quick release flushes after delayed enter ack', async (t) => {
	installDomGlobals(t);

	const root = new FakeElement('div');
	root.setBoundingClientRect({
		width: 320,
		height: 200,
		right: 320,
		bottom: 200,
	});

	const messages: BridgeInboundMessage[] = [];
	const controller = createTouchScrollController({
		term: createTouchScrollTerm(root, 25) as never,
		root: root as never,
		instanceId: 'instance-1',
		sendToRn: (message) => {
			messages.push(message);
		},
		isSelectionModeEnabled: () => false,
		cancelLongPress() {},
	});

	controller.setConfig({
		enabled: true,
		slopPx: 0,
		pxPerLine: 1,
		maxPagesPerFlush: 2,
		maxExtraLines: 999,
		coalesceMs: 0,
		velocityMultiplierEnabled: false,
		backlogMultiplierEnabled: false,
	});

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 1,
		clientX: 40,
		clientY: 40,
		timeStamp: 0,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 1,
		clientX: 40,
		clientY: 140,
		timeStamp: 100,
	});
	dispatchPointerEvent(root, 'pointerup', {
		pointerId: 1,
		clientX: 40,
		clientY: 140,
		timeStamp: 120,
	});

	assert.equal(
		messages.some((message) => message.type === 'scrollbackBatch'),
		false,
	);

	controller.handleEnterAck(1);
	await new Promise((resolve) => setTimeout(resolve, 0));

	const activeTransition = messages.find(
		(
			message,
		): message is Extract<
			BridgeInboundMessage,
			{ type: 'scrollbackModeChanged' }
		> =>
			message.type === 'scrollbackModeChanged' &&
			message.active &&
			message.phase === 'active',
	);
	const scrollBatches = messages.filter(
		(
			message,
		): message is Extract<BridgeInboundMessage, { type: 'scrollbackBatch' }> =>
			message.type === 'scrollbackBatch',
	);

	assert.notEqual(activeTransition, undefined);
	assert.equal(scrollBatches.length, 1);
	const [scrollBatch] = scrollBatches;
	assert.equal(scrollBatch?.pageStep, 24);
	assert.equal(scrollBatch?.direction, 'up');
});

void test('touch scroll pointer cancel before enter ack ignores the late ack', async (t) => {
	installDomGlobals(t);

	const root = new FakeElement('div');
	root.setBoundingClientRect({
		width: 320,
		height: 200,
		right: 320,
		bottom: 200,
	});

	const messages: BridgeInboundMessage[] = [];
	const controller = createTouchScrollController({
		term: createTouchScrollTerm(root, 25) as never,
		root: root as never,
		instanceId: 'instance-1',
		sendToRn: (message) => {
			messages.push(message);
		},
		isSelectionModeEnabled: () => false,
		cancelLongPress() {},
	});

	controller.setConfig({
		enabled: true,
		slopPx: 0,
		pxPerLine: 1,
		maxPagesPerFlush: 2,
		maxExtraLines: 999,
		coalesceMs: 0,
		velocityMultiplierEnabled: false,
		backlogMultiplierEnabled: false,
	});

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 1,
		clientX: 40,
		clientY: 40,
		timeStamp: 0,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 1,
		clientX: 40,
		clientY: 140,
		timeStamp: 100,
	});
	dispatchPointerEvent(root, 'pointercancel', {
		pointerId: 1,
		clientX: 40,
		clientY: 140,
		timeStamp: 120,
	});
	controller.handleEnterAck(1);
	await new Promise((resolve) => setTimeout(resolve, 0));

	const scrollbackTransitions = messages
		.filter(
			(
				message,
			): message is Extract<
				BridgeInboundMessage,
				{ type: 'scrollbackModeChanged' }
			> => message.type === 'scrollbackModeChanged',
		)
		.map(({ active, phase, requestId }) => ({ active, phase, requestId }));

	assert.deepEqual(scrollbackTransitions, [
		{ active: true, phase: 'dragging', requestId: undefined },
		{ active: false, phase: 'dragging', requestId: 1 },
	]);
	assert.equal(
		messages.some((message) => message.type === 'scrollbackBatch'),
		false,
	);
});

void test('touch scroll exit does not emit primary-shell cancel input after ack', (t) => {
	installDomGlobals(t);

	const root = new FakeElement('div');
	root.setBoundingClientRect({
		width: 320,
		height: 200,
		right: 320,
		bottom: 200,
	});

	const messages: BridgeInboundMessage[] = [];
	const controller = createTouchScrollController({
		term: createTouchScrollTerm(root, 25) as never,
		root: root as never,
		instanceId: 'instance-1',
		sendToRn: (message) => {
			messages.push(message);
		},
		isSelectionModeEnabled: () => false,
		cancelLongPress() {},
	});

	controller.setConfig({
		enabled: true,
		slopPx: 0,
		pxPerLine: 1,
		maxPagesPerFlush: 2,
		maxExtraLines: 999,
		velocityMultiplierEnabled: false,
		backlogMultiplierEnabled: false,
	});

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 1,
		clientX: 40,
		clientY: 40,
		timeStamp: 0,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 1,
		clientX: 40,
		clientY: 140,
		timeStamp: 100,
	});
	controller.handleEnterAck(1);
	dispatchPointerEvent(root, 'pointerup', {
		pointerId: 1,
		clientX: 40,
		clientY: 140,
		timeStamp: 120,
	});

	controller.exitScrollback({ requestId: 2 });

	const inputMessages = messages.filter(
		(message): message is Extract<BridgeInboundMessage, { type: 'input' }> =>
			message.type === 'input',
	);
	const exitTransition = messages.find(
		(
			message,
		): message is Extract<
			BridgeInboundMessage,
			{ type: 'scrollbackModeChanged' }
		> =>
			message.type === 'scrollbackModeChanged' &&
			!message.active &&
			message.requestId === 2,
	);

	assert.deepEqual(inputMessages, []);
	assert.equal(exitTransition?.active, false);
});

void test('touch scroll clears pending scrollback entry when scrollback is force-closed without ack', (t) => {
	installDomGlobals(t);

	const root = new FakeElement('div');
	root.setBoundingClientRect({
		width: 320,
		height: 200,
		right: 320,
		bottom: 200,
	});

	const messages: BridgeInboundMessage[] = [];
	const controller = createTouchScrollController({
		term: createTouchScrollTerm(root) as never,
		root: root as never,
		instanceId: 'instance-1',
		sendToRn: (message) => {
			messages.push(message);
		},
		isSelectionModeEnabled: () => false,
		cancelLongPress() {},
	});

	const config: TouchScrollConfig = { enabled: true, slopPx: 8, pxPerLine: 10 };
	controller.setConfig(config);

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 1,
		clientX: 40,
		clientY: 40,
		timeStamp: 0,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 1,
		clientX: 40,
		clientY: 64,
		timeStamp: 16,
	});

	controller.exitScrollback({ requestId: 1 });

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 2,
		clientX: 48,
		clientY: 48,
		timeStamp: 32,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 2,
		clientX: 48,
		clientY: 72,
		timeStamp: 48,
	});

	const entryRequests = messages.filter(
		(
			message,
		): message is Extract<
			BridgeInboundMessage,
			{ type: 'scrollbackEnterRequested' }
		> => message.type === 'scrollbackEnterRequested',
	);

	assert.equal(entryRequests.length, 2);
	assert.deepEqual(
		entryRequests.map(({ requestId }) => requestId),
		[1, 2],
	);
});

void test('touch scroll clears pending scrollback entry when enter ack is lost', async (t) => {
	installDomGlobals(t);

	const root = new FakeElement('div');
	root.setBoundingClientRect({
		width: 320,
		height: 200,
		right: 320,
		bottom: 200,
	});

	const messages: BridgeInboundMessage[] = [];
	const controller = createTouchScrollController({
		term: createTouchScrollTerm(root) as never,
		root: root as never,
		instanceId: 'instance-1',
		sendToRn: (message) => {
			messages.push(message);
		},
		isSelectionModeEnabled: () => false,
		cancelLongPress() {},
		scrollbackEnterTimeoutMs: 1,
	});

	controller.setConfig({ enabled: true, slopPx: 8, pxPerLine: 10 });

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 1,
		clientX: 40,
		clientY: 40,
		timeStamp: 0,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 1,
		clientX: 40,
		clientY: 64,
		timeStamp: 16,
	});

	await new Promise((resolve) => setTimeout(resolve, 5));

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 2,
		clientX: 48,
		clientY: 48,
		timeStamp: 32,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 2,
		clientX: 48,
		clientY: 72,
		timeStamp: 48,
	});

	const entryRequests = messages.filter(
		(
			message,
		): message is Extract<
			BridgeInboundMessage,
			{ type: 'scrollbackEnterRequested' }
		> => message.type === 'scrollbackEnterRequested',
	);
	const timeoutExit = messages.find(
		(
			message,
		): message is Extract<
			BridgeInboundMessage,
			{ type: 'scrollbackModeChanged' }
		> =>
			message.type === 'scrollbackModeChanged' &&
			!message.active &&
			message.requestId === 1,
	);

	assert.deepEqual(
		entryRequests.map(({ requestId }) => requestId),
		[1, 2],
	);
	assert.notEqual(timeoutExit, undefined);
});

void test('touch scroll lost ack timeout restarts enter for newer active drag', async (t) => {
	installDomGlobals(t);

	const root = new FakeElement('div');
	root.setBoundingClientRect({
		width: 320,
		height: 200,
		right: 320,
		bottom: 200,
	});

	const messages: BridgeInboundMessage[] = [];
	const controller = createTouchScrollController({
		term: createTouchScrollTerm(root) as never,
		root: root as never,
		instanceId: 'instance-1',
		sendToRn: (message) => {
			messages.push(message);
		},
		isSelectionModeEnabled: () => false,
		cancelLongPress() {},
		scrollbackEnterTimeoutMs: 8,
	});

	controller.setConfig({ enabled: true, slopPx: 8, pxPerLine: 10 });

	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 1,
		clientX: 40,
		clientY: 40,
		timeStamp: 0,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 1,
		clientX: 40,
		clientY: 64,
		timeStamp: 16,
	});
	dispatchPointerEvent(root, 'pointerup', {
		pointerId: 1,
		clientX: 40,
		clientY: 64,
		timeStamp: 20,
	});
	dispatchPointerEvent(root, 'pointerdown', {
		pointerId: 2,
		clientX: 48,
		clientY: 48,
		timeStamp: 24,
	});
	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 2,
		clientX: 48,
		clientY: 72,
		timeStamp: 32,
	});

	await new Promise((resolve) => setTimeout(resolve, 12));

	dispatchPointerEvent(root, 'pointermove', {
		pointerId: 2,
		clientX: 48,
		clientY: 96,
		timeStamp: 48,
	});
	controller.handleEnterAck(2);
	dispatchPointerEvent(root, 'pointerup', {
		pointerId: 2,
		clientX: 48,
		clientY: 96,
		timeStamp: 64,
	});

	const entryRequests = messages.filter(
		(
			message,
		): message is Extract<
			BridgeInboundMessage,
			{ type: 'scrollbackEnterRequested' }
		> => message.type === 'scrollbackEnterRequested',
	);
	const timeoutExit = messages.find(
		(
			message,
		): message is Extract<
			BridgeInboundMessage,
			{ type: 'scrollbackModeChanged' }
		> =>
			message.type === 'scrollbackModeChanged' &&
			!message.active &&
			message.requestId === 1,
	);
	const scrollBatches = messages.filter(
		(
			message,
		): message is Extract<BridgeInboundMessage, { type: 'scrollbackBatch' }> =>
			message.type === 'scrollbackBatch',
	);

	assert.deepEqual(
		entryRequests.map(({ requestId }) => requestId),
		[1, 2],
	);
	assert.notEqual(timeoutExit, undefined);
	assert.equal(scrollBatches.length, 1);
	assert.equal(scrollBatches[0]?.direction, 'up');
});

void test('selection overlay tap exits even when pointer releases outside the overlay', (t) => {
	const { document } = installDomGlobals(t);
	const originalDateNow = Date.now;
	let now = 1_000;
	Date.now = () => now;
	t.after(() => {
		Date.now = originalDateNow;
	});

	const termElement = new FakeElement('div');
	const screenElement = new FakeElement('div');
	termElement.setBoundingClientRect({
		left: 0,
		top: 0,
		right: 320,
		bottom: 200,
		width: 320,
		height: 200,
	});
	screenElement.setBoundingClientRect({
		left: 0,
		top: 0,
		right: 320,
		bottom: 200,
		width: 320,
		height: 200,
	});

	const selectionHandles = createSelectionHandles({
		term: createSelectionTerm(termElement, screenElement) as never,
		instanceId: 'instance-1',
		sendToRn() {},
	});

	selectionHandles.applySelectionMode(true, { force: true });
	now += 301;

	const overlay = termElement.children.find(
		(child) => child.style.zIndex === '20',
	);
	assert.ok(overlay);
	assert.equal(selectionHandles.isSelectionModeEnabled(), true);

	const outside = document.createElement('div');

	dispatchPointerEvent(overlay, 'pointerdown', {
		pointerId: 7,
		clientX: 24,
		clientY: 24,
	});
	dispatchPointerEvent(outside, 'pointerup', {
		pointerId: 7,
		clientX: 24,
		clientY: 24,
	});

	assert.equal(selectionHandles.isSelectionModeEnabled(), false);
});
