export const WORKMUX_APP_COMMAND_UPDATE_MESSAGE =
	'Update mdev on the remote machine; this action requires mdev tmux app commands.';

export type WorkmuxAppContext = {
	sessionName: string;
	target: string;
	windowId: string;
	windowIndex: number;
	windowName: string;
	workspaceId: string;
	role: string;
	roleWindow: boolean;
	homeWindow: boolean;
	paneId: string;
	paneTty: string;
	panePath: string;
	projectRoot: string;
	projectName: string;
};

export type WorkmuxAppWindow = {
	sessionName: string;
	target: string;
	windowId: string;
	windowIndex: number;
	windowName: string;
	workspaceId: string;
	role: string;
	roleWindow: boolean;
	homeWindow: boolean;
};

type WorkmuxScrollDirection = 'down' | 'up';
type WorkmuxFocusAction =
	| 'bash'
	| 'claude'
	| 'codex'
	| 'git'
	| 'next'
	| 'prev'
	| 'toggle-git-bash'
	| (string & {});
type WorkmuxNavAction = 'next' | 'next-all' | 'prev' | 'prev-all' | 'select';

type JsonRecord = Record<string, unknown>;

export function formatWorkmuxAppCommandFailureMessage(message: string): string {
	const trimmed = message.trim();
	if (!trimmed) {
		return WORKMUX_APP_COMMAND_UPDATE_MESSAGE;
	}

	if (
		/(?:^|\s)(?:mdev|tmux): command not found(?:\s|$)/i.test(trimmed) ||
		/unknown tmux app/i.test(trimmed) ||
		/unknown tmux command/i.test(trimmed)
	) {
		return WORKMUX_APP_COMMAND_UPDATE_MESSAGE;
	}

	return trimmed;
}

export function buildWorkmuxAppContextCommand(sessionName: string): string {
	return `mdev tmux app context --session ${quoteShellValue(
		normalizeSessionName(sessionName),
	)}`;
}

export function buildWorkmuxAppWindowCommand(sessionName: string): string {
	return `mdev tmux app window --session ${quoteShellValue(
		normalizeSessionName(sessionName),
	)}`;
}

export function buildWorkmuxAppNotificationOpenCommand(
	sessionName: string,
	windowId: string,
): string {
	return [
		'mdev tmux app notification open',
		`--session ${quoteShellValue(normalizeSessionName(sessionName))}`,
		`--window-id ${quoteShellValue(windowId)}`,
	].join(' ');
}

export function buildWorkmuxAppScrollEnterCommand(sessionName: string): string {
	return `mdev tmux app scroll enter --session ${quoteShellValue(
		normalizeSessionName(sessionName),
	)}`;
}

export function buildWorkmuxAppScrollPageCommand(
	sessionName: string,
	direction: WorkmuxScrollDirection,
	count: number,
): string {
	if (direction !== 'up' && direction !== 'down') {
		throw new Error(`Invalid Workmux scroll direction: ${direction}`);
	}
	if (!isSafePositiveInteger(count)) {
		throw new Error(`Invalid Workmux scroll count: ${count}`);
	}

	return [
		`mdev tmux app scroll page-${direction}`,
		`--count ${quoteShellValue(String(count))}`,
		`--session ${quoteShellValue(normalizeSessionName(sessionName))}`,
	].join(' ');
}

export function buildWorkmuxAppFocusCommand(
	sessionName: string,
	roleOrDirection: WorkmuxFocusAction,
): string {
	return [
		'mdev tmux app focus',
		quoteShellValue(roleOrDirection),
		`--session ${quoteShellValue(normalizeSessionName(sessionName))}`,
	].join(' ');
}

export function buildWorkmuxAppNavCommand(
	sessionName: string,
	action: WorkmuxNavAction,
	index?: number,
): string {
	if (action === 'select' && index === undefined) {
		throw new Error('Missing Workmux nav select index');
	}

	const command = ['mdev tmux app nav', quoteShellValue(action)];
	if (index !== undefined) {
		if (!isSafePositiveInteger(index)) {
			throw new Error(`Invalid Workmux nav select index: ${index}`);
		}
		command.push(quoteShellValue(String(index)));
	}
	command.push(`--session ${quoteShellValue(normalizeSessionName(sessionName))}`);

	return command.join(' ');
}

export function parseWorkmuxAppContextOutput(
	output: string,
): WorkmuxAppContext {
	const value = parseSingleJsonObject(output, 'Invalid Workmux app context');

	const context: WorkmuxAppContext = {
		sessionName: requireNonEmptyString(
			value,
			'sessionName',
			'Invalid Workmux app context',
		),
		target: requireNonEmptyString(value, 'target', 'Invalid Workmux app context'),
		windowId: requireNonEmptyString(
			value,
			'windowId',
			'Invalid Workmux app context',
		),
		windowIndex: requireWindowIndex(value, 'Invalid Workmux app context'),
		windowName: requireNonEmptyString(
			value,
			'windowName',
			'Invalid Workmux app context',
		),
		workspaceId: optionalString(value, 'workspaceId', 'Invalid Workmux app context'),
		role: optionalString(value, 'role', 'Invalid Workmux app context'),
		roleWindow: requireBoolean(
			value,
			'roleWindow',
			'Invalid Workmux app context',
		),
		homeWindow: requireBoolean(
			value,
			'homeWindow',
			'Invalid Workmux app context',
		),
		paneId: requireNonEmptyString(value, 'paneId', 'Invalid Workmux app context'),
		paneTty: requireNonEmptyString(
			value,
			'paneTty',
			'Invalid Workmux app context',
		),
		panePath: requireNonEmptyString(
			value,
			'panePath',
			'Invalid Workmux app context',
		),
		projectRoot: requireNonEmptyString(
			value,
			'projectRoot',
			'Invalid Workmux app context',
		),
		projectName: requireNonEmptyString(
			value,
			'projectName',
			'Invalid Workmux app context',
		),
	};

	return context;
}

export function parseWorkmuxAppWindowOutput(output: string): WorkmuxAppWindow {
	const value = parseSingleJsonObject(output, 'Invalid Workmux app window');

	const windowProjection: WorkmuxAppWindow = {
		sessionName: requireNonEmptyString(
			value,
			'sessionName',
			'Invalid Workmux app window',
		),
		target: requireNonEmptyString(value, 'target', 'Invalid Workmux app window'),
		windowId: requireNonEmptyString(
			value,
			'windowId',
			'Invalid Workmux app window',
		),
		windowIndex: requireWindowIndex(value, 'Invalid Workmux app window'),
		windowName: requireNonEmptyString(
			value,
			'windowName',
			'Invalid Workmux app window',
		),
		workspaceId: optionalString(value, 'workspaceId', 'Invalid Workmux app window'),
		role: optionalString(value, 'role', 'Invalid Workmux app window'),
		roleWindow: requireBoolean(
			value,
			'roleWindow',
			'Invalid Workmux app window',
		),
		homeWindow: requireBoolean(
			value,
			'homeWindow',
			'Invalid Workmux app window',
		),
	};

	return windowProjection;
}

function normalizeSessionName(sessionName: string): string {
	const trimmed = sessionName.trim();
	return trimmed || 'main';
}

function quoteShellValue(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function isSafePositiveInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function parseSingleJsonObject(output: string, errorMessage: string): JsonRecord {
	const trimmed = output.trim();
	if (!trimmed) {
		throw new Error(errorMessage);
	}

	try {
		const value: unknown = JSON.parse(trimmed);
		if (!isJsonRecord(value)) {
			throw new Error(errorMessage);
		}
		return value;
	} catch {
		throw new Error(errorMessage);
	}
}

function isJsonRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
	value: JsonRecord,
	fieldName: string,
	errorMessage: string,
): string {
	const field = value[fieldName];
	if (typeof field !== 'string' || field.length === 0) {
		throw new Error(errorMessage);
	}
	return field;
}

function optionalString(
	value: JsonRecord,
	fieldName: string,
	errorMessage: string,
): string {
	const field = value[fieldName];
	if (field === undefined) {
		return '';
	}
	if (typeof field !== 'string') {
		throw new Error(errorMessage);
	}
	return field;
}

function requireBoolean(
	value: JsonRecord,
	fieldName: string,
	errorMessage: string,
): boolean {
	const field = value[fieldName];
	if (typeof field !== 'boolean') {
		throw new Error(errorMessage);
	}
	return field;
}

function requireWindowIndex(value: JsonRecord, errorMessage: string): number {
	const field = value.windowIndex;
	if (!Number.isSafeInteger(field) || field < 0) {
		throw new Error(errorMessage);
	}
	return field;
}
