import { rootLogger } from '@/lib/logger';

// Action IDs emitted by runtime config are handled here at runtime.

export const CONFIGURATOR_URL =
	'https://dev-remote-machine-1.tail83108.ts.net:4002/keyboard-configurator';
export const HANDLE_DEV_SERVER_URL = 'http://100.122.2.100:5173/';

export const KEYBOARD_TARGET_ACTION_IDS = [
	'OPEN_MAIN_MENU',
	'OPEN_SECONDARY_MENU',
	'OPEN_KEYBOARD_MENU',
	'OPEN_ADVANCED_KEYBOARD',
] as const;

export const KNOWN_ACTION_IDS = [
	'ROTATE_KEYBOARD',
	'OPEN_KEYBOARD_SETTINGS',
	...KEYBOARD_TARGET_ACTION_IDS,
	'OPEN_TMUX_HISTORY',
	'TOGGLE_COMMAND_PRESETS',
	'OPEN_COMMANDER',
	'OPEN_TEXT_EDITOR',
	'PASTE_CLIPBOARD',
	'COPY_SELECTION',
	'CYCLE_TMUX_WINDOW',
] as const;

export type KnownActionId = (typeof KNOWN_ACTION_IDS)[number];
export type KeyboardTargetActionId = (typeof KEYBOARD_TARGET_ACTION_IDS)[number];
export type ActionId = KnownActionId | (string & {});

export type ActionContext = {
	availableKeyboardIds: Set<string>;
	selectKeyboard: (id: string) => void;
	resolveKeyboardActionTarget?: (actionId: KeyboardTargetActionId) => string | null;
	rotateKeyboard: () => void;
	openConfigurator: () => void;
	sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
	pasteClipboard: () => Promise<void>;
	copySelection: () => void;
	toggleTmuxHistory?: () => void;
	toggleCommandPresets?: () => void;
	openCommander?: () => void;
	openTextEditor?: () => void;
};

const logger = rootLogger.extend('KeyboardActions');

function selectKeyboardForAction(
	actionId: KeyboardTargetActionId,
	context: ActionContext,
) {
	const targetKeyboardId = context.resolveKeyboardActionTarget?.(actionId);
	if (targetKeyboardId && context.availableKeyboardIds.has(targetKeyboardId)) {
		context.selectKeyboard(targetKeyboardId);
	}
}

export async function runAction(
	actionId: ActionId,
	context: ActionContext,
): Promise<void> {
	switch (actionId) {
		case 'OPEN_MAIN_MENU': {
			selectKeyboardForAction('OPEN_MAIN_MENU', context);
			return;
		}
		case 'OPEN_SECONDARY_MENU': {
			selectKeyboardForAction('OPEN_SECONDARY_MENU', context);
			return;
		}
		case 'OPEN_KEYBOARD_MENU': {
			selectKeyboardForAction('OPEN_KEYBOARD_MENU', context);
			return;
		}
		case 'OPEN_ADVANCED_KEYBOARD': {
			selectKeyboardForAction('OPEN_ADVANCED_KEYBOARD', context);
			return;
		}
		case 'ROTATE_KEYBOARD': {
			context.rotateKeyboard();
			return;
		}
		case 'OPEN_KEYBOARD_SETTINGS': {
			context.openConfigurator();
			return;
		}
		case 'PASTE_CLIPBOARD': {
			await context.pasteClipboard();
			return;
		}
		case 'COPY_SELECTION': {
			context.copySelection();
			return;
		}
		case 'OPEN_TMUX_HISTORY': {
			context.toggleTmuxHistory?.();
			return;
		}
		case 'CYCLE_TMUX_WINDOW': {
			context.sendBytes(new Uint8Array([27, 91, 49, 56, 126]));
			return;
		}
		case 'TOGGLE_COMMAND_PRESETS': {
			context.toggleCommandPresets?.();
			return;
		}
		case 'OPEN_COMMANDER': {
			context.openCommander?.();
			return;
		}
		case 'OPEN_TEXT_EDITOR': {
			context.openTextEditor?.();
			return;
		}
		default: {
			logger.warn('Unhandled action', actionId);
			return;
		}
	}
}
