import { type KeyboardSlot, type MacroDef } from '@/generated/keyboard-config';
import { type ActionId } from '@/lib/keyboard-actions';

type MacroStep =
	| { type: 'text'; data: string; delayMs?: number; repeat?: number }
	| { type: 'enter'; delayMs?: number; repeat?: number }
	| { type: 'arrowDown'; delayMs?: number; repeat?: number }
	| { type: 'arrowUp'; delayMs?: number; repeat?: number }
	| { type: 'esc'; delayMs?: number; repeat?: number }
	| { type: 'space'; delayMs?: number; repeat?: number }
	| { type: 'tab'; delayMs?: number; repeat?: number };

// Runtime helpers for executing generated keyboard slots and macros.
type MacroPayload =
	| { type: 'command'; value: string; enter?: boolean }
	| { type: 'text'; value: string; enter?: boolean }
	| { type: 'sequence'; value: string }
	| { type: 'steps'; steps: MacroStep[] }
	| { type: 'action'; actionId: ActionId };

const textEncoder = new TextEncoder();

function encodeText(value: string): Uint8Array<ArrayBuffer> {
	return textEncoder.encode(value);
}

function parseOptionalNumber(
	value: unknown,
	{ integer = false }: { integer?: boolean } = {},
): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	if (integer && !Number.isInteger(value)) {
		return undefined;
	}
	return value;
}

function parseMacroStep(step: unknown): MacroStep | null {
	if (!step || typeof step !== 'object') return null;
	const parsed = step as Record<string, unknown>;
	const repeat = parseOptionalNumber(parsed.repeat, { integer: true });
	const delayMs = parseOptionalNumber(parsed.delayMs);

	switch (parsed.type) {
		case 'text':
			if (typeof parsed.data !== 'string') return null;
			return { type: 'text', data: parsed.data, delayMs, repeat };
		case 'enter':
		case 'arrowDown':
		case 'arrowUp':
		case 'esc':
		case 'space':
		case 'tab':
			return { type: parsed.type, delayMs, repeat };
		default:
			return null;
	}
}

export function parseMacroScript(script: string): MacroPayload | null {
	const trimmed = script.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		if (!parsed || typeof parsed !== 'object') return null;
		if (parsed.type === 'command' && typeof parsed.value === 'string') {
			return {
				type: 'command',
				value: parsed.value,
				enter: parsed.enter === undefined ? true : Boolean(parsed.enter),
			};
		}
		if (parsed.type === 'text' && typeof parsed.value === 'string') {
			return {
				type: 'text',
				value: parsed.value,
				enter: parsed.enter === undefined ? false : Boolean(parsed.enter),
			};
		}
		if (parsed.type === 'sequence' && typeof parsed.value === 'string') {
			return { type: 'sequence', value: parsed.value };
		}
		if (parsed.type === 'steps' && Array.isArray(parsed.steps)) {
			const steps = parsed.steps
				.map((step) => parseMacroStep(step))
				.filter((step): step is MacroStep => step !== null);
			if (steps.length === parsed.steps.length) {
				return { type: 'steps', steps };
			}
		}
		if (parsed.type === 'action') {
			const actionId =
				typeof parsed.actionId === 'string'
					? parsed.actionId
					: typeof parsed.name === 'string'
						? parsed.name
						: typeof parsed.action === 'string'
							? parsed.action
							: null;
			if (actionId) {
				return { type: 'action', actionId };
			}
		}
	} catch {
		return null;
	}
	return null;
}

export function runMacro(
	macro: MacroDef,
	{
		sendBytes,
		sendText,
		runSteps,
		onAction,
	}: {
		sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
		sendText: (value: string) => void;
		runSteps?: (steps: MacroStep[]) => void;
		onAction: (actionId: ActionId) => void;
	},
) {
	const parsed = parseMacroScript(macro.script);
	if (!parsed) {
		sendText(macro.script);
		return;
	}

	switch (parsed.type) {
		case 'command': {
			sendText(parsed.value);
			if (parsed.enter) sendBytes(encodeText('\r'));
			return;
		}
		case 'text': {
			sendText(parsed.value);
			if (parsed.enter) sendBytes(encodeText('\r'));
			return;
		}
		case 'sequence': {
			sendBytes(encodeText(parsed.value));
			return;
		}
		case 'steps': {
			runSteps?.(parsed.steps);
			return;
		}
		case 'action': {
			onAction(parsed.actionId);
			return;
		}
		default:
			return;
	}
}

export function runSlotItem(
	item: KeyboardSlot,
	macros: MacroDef[],
	{
		sendBytes,
		sendText,
		runSteps,
		onAction,
	}: {
		sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
		sendText: (value: string) => void;
		runSteps?: (steps: MacroStep[]) => void;
		onAction: (actionId: ActionId) => void;
	},
) {
	switch (item.type) {
		case 'text': {
			sendText(item.text);
			return;
		}
		case 'bytes': {
			sendBytes(new Uint8Array(item.bytes));
			return;
		}
		case 'macro': {
			const macro = macros.find((m) => m.id === item.macroId);
			if (!macro) return;
			runMacro(macro, { sendBytes, sendText, runSteps, onAction });
			return;
		}
		case 'action': {
			onAction(item.actionId);
			return;
		}
		default:
			return;
	}
}
