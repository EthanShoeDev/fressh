import {
	type KeyboardSlot,
	type MacroDef,
} from '@/lib/shell-config';
import { type ActionId } from '@/lib/keyboard-actions';
import { parseMacroScript, type MacroStep } from '@/lib/macro-scripts';

export { parseMacroScript } from '@/lib/macro-scripts';

const textEncoder = new TextEncoder();

function encodeText(value: string): Uint8Array<ArrayBuffer> {
	return textEncoder.encode(value);
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
