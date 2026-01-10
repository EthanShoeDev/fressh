import { rootLogger } from '@/lib/logger';

// Action IDs emitted by codegen are handled here at runtime.

export const MAIN_MENU_KEYBOARD_ID = 'main_menu';
export const SECONDARY_MENU_KEYBOARD_ID = 'secondary_menu';
export const KEYBOARD_MENU_KEYBOARD_ID = 'keyboard_menu';

export const CONFIGURATOR_URL =
	'https://dev-remote-machine-1.tail83108.ts.net:4002/keyboard-configurator';
export const HANDLE_DEV_SERVER_URL = 'http://100.122.2.100:5173/';

export const KNOWN_ACTION_IDS = [
	'ROTATE_KEYBOARD',
	'OPEN_KEYBOARD_SETTINGS',
	'OPEN_MAIN_MENU',
	'OPEN_SECONDARY_MENU',
	'OPEN_KEYBOARD_MENU',
	'TOGGLE_COMMAND_PRESETS',
	'OPEN_COMMANDER',
	'OPEN_TEXT_EDITOR',
	'PASTE_CLIPBOARD',
	'COPY_SELECTION',
	'CYCLE_TMUX_WINDOW',
] as const;

export type KnownActionId = (typeof KNOWN_ACTION_IDS)[number];
export type ActionId = KnownActionId | (string & {});

export type ActionContext = {
	availableKeyboardIds: Set<string>;
	selectKeyboard: (id: string) => void;
	rotateKeyboard: () => void;
	openConfigurator: () => void;
	sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
	pasteClipboard: () => Promise<void>;
	copySelection: () => void;
	toggleCommandPresets?: () => void;
	openCommander?: () => void;
	openTextEditor?: () => void;
};

const logger = rootLogger.extend('KeyboardActions');

export async function runAction(
	actionId: ActionId,
	context: ActionContext,
): Promise<void> {
	switch (actionId) {
		case 'OPEN_MAIN_MENU': {
			if (context.availableKeyboardIds.has(MAIN_MENU_KEYBOARD_ID)) {
				context.selectKeyboard(MAIN_MENU_KEYBOARD_ID);
			}
			return;
		}
		case 'OPEN_SECONDARY_MENU': {
			if (context.availableKeyboardIds.has(SECONDARY_MENU_KEYBOARD_ID)) {
				context.selectKeyboard(SECONDARY_MENU_KEYBOARD_ID);
			}
			return;
		}
		case 'OPEN_KEYBOARD_MENU': {
			if (context.availableKeyboardIds.has(KEYBOARD_MENU_KEYBOARD_ID)) {
				context.selectKeyboard(KEYBOARD_MENU_KEYBOARD_ID);
			}
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
