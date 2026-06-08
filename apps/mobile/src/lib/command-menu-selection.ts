import { type ActionId } from '@/lib/keyboard-actions';
import {
	type CommandMenu,
	type CommandMenuEntry,
	type CommandPreset,
} from '@/lib/shell-config';

export type CommandMenuSelectionDispatchHandlers = {
	onSubmenu: (menu: CommandMenu) => void;
	onPreset: (preset: CommandPreset) => void;
	onClose: () => void;
	onAction: (actionId: ActionId) => void;
};

export function dispatchCommandMenuSelection(
	entry: CommandMenuEntry,
	handlers: CommandMenuSelectionDispatchHandlers,
) {
	switch (entry.type) {
		case 'submenu':
			handlers.onSubmenu(entry);
			return;
		case 'preset':
			handlers.onPreset(entry);
			return;
		case 'action':
			handlers.onClose();
			handlers.onAction(entry.actionId);
			return;
	}
}
