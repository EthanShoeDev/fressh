import { DETECTED_OPEN_ACTION_IDS } from '@/lib/detected-open-actions';
import {
	HOST_BROWSER_NO_CONNECTION_MESSAGE,
	type HostBrowserUrlSlot,
} from '@/lib/host-browser-actions';
import { rootLogger } from '@/lib/logger';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	buildWorkmuxAppFocusCommand,
	buildWorkmuxAppNavCommand,
	formatWorkmuxAppCommandFailureMessage,
	type WorkmuxFocusTarget,
	type WorkmuxNavAction,
} from '@/lib/workmux-app-commands';

// Action IDs emitted by runtime config are handled here at runtime.

export const HANDLE_DEV_SERVER_URL = 'http://100.122.2.100:5173/';

export const KEYBOARD_TARGET_ACTION_IDS = [
	'OPEN_MAIN_MENU',
	'OPEN_SECONDARY_MENU',
	'OPEN_KEYBOARD_MENU',
	'OPEN_ADVANCED_KEYBOARD',
	'OPEN_BROWSER_KEYBOARD',
] as const;

export type WorkmuxKeyboardCommand =
	| { type: 'focus'; target: WorkmuxFocusTarget }
	| { type: 'nav'; action: Exclude<WorkmuxNavAction, 'select'> };
const WORKMUX_KEYBOARD_ACTION_ENTRIES = [
	['WORKMUX_FOCUS_CLAUDE', { type: 'focus', target: 'claude' }],
	['WORKMUX_FOCUS_GIT', { type: 'focus', target: 'git' }],
	['WORKMUX_FOCUS_CODEX', { type: 'focus', target: 'codex' }],
	['WORKMUX_FOCUS_BASH', { type: 'focus', target: 'bash' }],
	['WORKMUX_FOCUS_PREV', { type: 'focus', target: 'prev' }],
	['WORKMUX_FOCUS_NEXT', { type: 'focus', target: 'next' }],
	[
		'WORKMUX_FOCUS_TOGGLE_GIT_BASH',
		{ type: 'focus', target: 'toggle-git-bash' },
	],
	['WORKMUX_NAV_PREV', { type: 'nav', action: 'prev' }],
	['WORKMUX_NAV_NEXT', { type: 'nav', action: 'next' }],
	['WORKMUX_NAV_PREV_ALL', { type: 'nav', action: 'prev-all' }],
	['WORKMUX_NAV_NEXT_ALL', { type: 'nav', action: 'next-all' }],
] as const satisfies readonly (readonly [string, WorkmuxKeyboardCommand])[];
export type WorkmuxKeyboardActionId =
	(typeof WORKMUX_KEYBOARD_ACTION_ENTRIES)[number][0];
export const WORKMUX_KEYBOARD_ACTION_IDS = WORKMUX_KEYBOARD_ACTION_ENTRIES.map(
	([actionId]) => actionId,
);
export const WORKMUX_KEYBOARD_ACTION_COMMANDS = Object.fromEntries(
	WORKMUX_KEYBOARD_ACTION_ENTRIES,
) as Record<WorkmuxKeyboardActionId, WorkmuxKeyboardCommand>;

export const KNOWN_ACTION_IDS = [
	'ROTATE_KEYBOARD',
	'OPEN_KEYBOARD_SETTINGS',
	...KEYBOARD_TARGET_ACTION_IDS,
	'TOGGLE_COMMAND_PRESETS',
	'OPEN_COMMANDER',
	'OPEN_SKILL_SELECTOR',
	'OPEN_BROWSER_ACTIONS',
	'OPEN_REPO_FEATURE_REQUEST',
	'OPEN_WISPR_TEXT_EDITOR',
	'PASTE_CLIPBOARD',
	'COPY_SELECTION',
	'CYCLE_TMUX_WINDOW',
	'OPEN_HOST_DIFFITY',
	'OPEN_HOST_URL_WINDOW',
	'OPEN_HOST_URL_DEV_SERVER',
	'OPEN_HOST_URL_STORYBOOK',
	'OPEN_HOST_URL_APP',
	'OPEN_HOST_DETECTED_AUTO',
	'OPEN_HOST_DETECTED_PICK',
	'EDIT_HOST_URL_WINDOW',
	'EDIT_HOST_URL_DEV_SERVER',
	'EDIT_HOST_URL_STORYBOOK',
	'EDIT_HOST_URL_APP',
	...WORKMUX_KEYBOARD_ACTION_IDS,
	'CYCLE_WORKMUX_STATUS',
] as const;

const INTERNAL_ACTION_IDS = new Set<string>(DETECTED_OPEN_ACTION_IDS);

export const CONFIG_SUPPORTED_ACTION_IDS = KNOWN_ACTION_IDS.filter(
	(actionId) => !INTERNAL_ACTION_IDS.has(actionId),
);

export type KnownActionId = (typeof KNOWN_ACTION_IDS)[number];
export type KeyboardTargetActionId =
	(typeof KEYBOARD_TARGET_ACTION_IDS)[number];
export type ActionId = KnownActionId | (string & {});
export type WorkmuxKeyboardCommandRunResult =
	| { status: 'handled' }
	| { status: 'superseded' };
export const WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE =
	'Workmux actions require a Workmux-enabled connection.';

export function formatWorkmuxKeyboardCommandFailureMessage({
	errorMessage,
	localPreconditionFailure = isWorkmuxKeyboardLocalPreconditionFailure(
		errorMessage,
	),
	formatRemoteFailureMessage = formatWorkmuxAppCommandFailureMessage,
}: {
	errorMessage: string;
	localPreconditionFailure?: boolean;
	formatRemoteFailureMessage?: (message: string) => string;
}): string {
	return localPreconditionFailure
		? errorMessage
		: formatRemoteFailureMessage(errorMessage);
}

export type WorkmuxKeyboardCommandRunner = {
	run: (
		command: WorkmuxKeyboardCommand,
	) => Promise<WorkmuxKeyboardCommandRunResult>;
	invalidate: () => void;
};

export function createWorkmuxKeyboardCommandRunner({
	isTmuxEnabled,
	getSessionName,
	runHostCommand,
	showFailure,
	getErrorMessage,
}: {
	isTmuxEnabled: () => boolean;
	getSessionName: () => string;
	runHostCommand: (command: string, timeoutMs: number) => Promise<unknown>;
	showFailure: (message: string) => void;
	getErrorMessage: (error: unknown) => string;
}): WorkmuxKeyboardCommandRunner {
	let running = false;
	let generation = 0;
	let pending:
		| {
				command: WorkmuxKeyboardCommand;
				generation: number;
				resolve: (result: WorkmuxKeyboardCommandRunResult) => void;
			}
		| null = null;

	const supersedePending = (): void => {
		pending?.resolve({ status: 'superseded' });
		pending = null;
	};

	const execute = async (
		command: WorkmuxKeyboardCommand,
		commandGeneration: number,
	): Promise<WorkmuxKeyboardCommandRunResult> => {
		try {
			if (commandGeneration !== generation) {
				return { status: 'superseded' };
			}
			if (!isTmuxEnabled()) {
				throw new Error(WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE);
			}
			const sessionName = getSessionName().trim() || 'main';
			const remoteCommand =
				command.type === 'focus'
					? buildWorkmuxAppFocusCommand(sessionName, command.target)
					: buildWorkmuxAppNavCommand(
							sessionName,
							command.action,
						);
			await runHostCommand(remoteCommand, 10_000);
			return commandGeneration === generation
				? { status: 'handled' }
				: { status: 'superseded' };
		} catch (error) {
			if (commandGeneration === generation) {
				showFailure(
					formatWorkmuxKeyboardCommandFailureMessage({
						errorMessage: getErrorMessage(error),
					}) || WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
				);
				return { status: 'handled' };
			}
			return { status: 'superseded' };
		}
	};

	const drain = async (queued: {
		command: WorkmuxKeyboardCommand;
		generation: number;
		resolve: (result: WorkmuxKeyboardCommandRunResult) => void;
	}): Promise<void> => {
		running = true;
		try {
			let current: typeof queued | null = queued;
			while (current) {
				current.resolve(
					await execute(current.command, current.generation),
				);
				current = pending;
				pending = null;
			}
		} finally {
			running = false;
			const next = pending;
			pending = null;
			if (next) {
				void drain(next);
			}
		}
	};

	return {
		run: (command) => {
			return new Promise<WorkmuxKeyboardCommandRunResult>((resolve) => {
				const queued = { command, generation, resolve };
				if (!running) {
					void drain(queued);
					return;
				}
				pending?.resolve({ status: 'superseded' });
				pending = queued;
			});
		},
		invalidate: () => {
			generation += 1;
			supersedePending();
		},
	};
}

function isWorkmuxKeyboardLocalPreconditionFailure(message: string): boolean {
	return (
		message === WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE ||
		message === HOST_BROWSER_NO_CONNECTION_MESSAGE
	);
}

export type ActionContext = {
	availableKeyboardIds: Set<string>;
	selectKeyboard: (id: string) => void;
	resolveKeyboardActionTarget?: (
		actionId: KeyboardTargetActionId,
	) => string | null;
	rotateKeyboard: () => void;
	openConfigurator: () => void;
	sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
	pasteClipboard: () => Promise<void>;
	copySelection: () => void;
	toggleCommandPresets?: () => void;
	openCommander?: () => void;
	openSkillSelector?: () => void;
	openBrowserActions?: () => void;
	openRepoFeatureRequest?: () => void;
	openWisprTextEditor?: () => void;
	openHostDiffity?: () => void;
	openHostUrlSlot?: (slot: HostBrowserUrlSlot) => void;
	openHostDetected?: (mode: 'auto' | 'pick') => void;
	editHostUrlSlot?: (slot: HostBrowserUrlSlot) => void;
	runWorkmuxKeyboardCommand?: (
		command: WorkmuxKeyboardCommand,
	) => Promise<WorkmuxKeyboardCommandRunResult>;
	cycleWorkmuxStatus?: () => void;
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

function getWorkmuxKeyboardActionCommand(
	actionId: ActionId,
): WorkmuxKeyboardCommand | null {
	return Object.prototype.hasOwnProperty.call(
		WORKMUX_KEYBOARD_ACTION_COMMANDS,
		actionId,
	)
		? WORKMUX_KEYBOARD_ACTION_COMMANDS[actionId as WorkmuxKeyboardActionId]
		: null;
}

export async function runAction(
	actionId: ActionId,
	context: ActionContext,
): Promise<void> {
	const workmuxKeyboardCommand = getWorkmuxKeyboardActionCommand(actionId);
	if (workmuxKeyboardCommand) {
		await context.runWorkmuxKeyboardCommand?.(workmuxKeyboardCommand);
		return;
	}

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
		case 'OPEN_BROWSER_KEYBOARD': {
			selectKeyboardForAction('OPEN_BROWSER_KEYBOARD', context);
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
		case 'OPEN_HOST_DIFFITY': {
			context.openHostDiffity?.();
			return;
		}
		case 'OPEN_HOST_URL_WINDOW': {
			context.openHostUrlSlot?.('window-url');
			return;
		}
		case 'OPEN_HOST_URL_DEV_SERVER': {
			context.openHostUrlSlot?.('dev-web-server-url');
			return;
		}
		case 'OPEN_HOST_URL_STORYBOOK': {
			context.openHostUrlSlot?.('storybook-url');
			return;
		}
		case 'OPEN_HOST_URL_APP': {
			context.openHostUrlSlot?.('app-url');
			return;
		}
		case 'OPEN_HOST_DETECTED_AUTO': {
			context.openHostDetected?.('auto');
			return;
		}
		case 'OPEN_HOST_DETECTED_PICK': {
			context.openHostDetected?.('pick');
			return;
		}
		case 'EDIT_HOST_URL_WINDOW': {
			context.editHostUrlSlot?.('window-url');
			return;
		}
		case 'EDIT_HOST_URL_DEV_SERVER': {
			context.editHostUrlSlot?.('dev-web-server-url');
			return;
		}
		case 'EDIT_HOST_URL_STORYBOOK': {
			context.editHostUrlSlot?.('storybook-url');
			return;
		}
		case 'EDIT_HOST_URL_APP': {
			context.editHostUrlSlot?.('app-url');
			return;
		}
		case 'CYCLE_WORKMUX_STATUS': {
			context.cycleWorkmuxStatus?.();
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
		case 'OPEN_SKILL_SELECTOR': {
			context.openSkillSelector?.();
			return;
		}
		case 'OPEN_BROWSER_ACTIONS': {
			context.openBrowserActions?.();
			return;
		}
		case 'OPEN_REPO_FEATURE_REQUEST': {
			context.openRepoFeatureRequest?.();
			return;
		}
		case 'OPEN_WISPR_TEXT_EDITOR': {
			context.openWisprTextEditor?.();
			return;
		}
		default: {
			logger.warn('Unhandled action', actionId);
			return;
		}
	}
}
