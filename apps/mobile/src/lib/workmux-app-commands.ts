export const WORKMUX_APP_COMMAND_UPDATE_MESSAGE =
	'Update mdev on the remote machine; this action requires mdev tmux app commands.';

export const WORKMUX_APP_SCROLL_MAX_COUNT = 20;

export type WorkmuxAppContext = {
	sessionName: string;
	target: string;
	windowId: string;
	windowIndex?: number;
	windowName: string;
	workspaceId: string;
	role: string;
	roleWindow?: boolean;
	homeWindow?: boolean;
	paneId: string;
	paneTty: string;
	panePath: string;
	projectRoot: string;
	projectName: string;
};

export type WorkmuxAppWindow = Pick<
	WorkmuxAppContext,
	| 'homeWindow'
	| 'role'
	| 'roleWindow'
	| 'sessionName'
	| 'target'
	| 'windowId'
	| 'windowIndex'
	| 'windowName'
	| 'workspaceId'
>;

export type WorkmuxScrollDirection = 'down' | 'up';
export type WorkmuxFocusTarget =
	| 'bash'
	| 'claude'
	| 'codex'
	| 'git'
	| 'next'
	| 'prev'
	| 'toggle-git-bash';
export type WorkmuxNavAction =
	| 'next'
	| 'next-all'
	| 'prev'
	| 'prev-all'
	| 'select';

type JsonRecord = Record<string, unknown>;

export function isWorkmuxAppCommand(command: string): boolean {
	return /^mdev\s+tmux\s+app(?:\s|$)/.test(command);
}

function isMissingWorkmuxAppCommandFailure(message: string): boolean {
	return [
		/\b(mdev|tmux): command not found\b/i,
		/\bcommand not found: (mdev|tmux)\b/i,
		/\b(mdev|tmux): not found\b/i,
		/\bUnknown tmux app action\b/i,
		/\bUnknown tmux command: app\b/i,
		/\bunknown tmux app\b/i,
		/\bunknown tmux command\b.*\bapp\b/i,
		/\bunknown command:\s*tmux\b/i,
		/\bunknown command\b.*\bapp\b/i,
	].some((pattern) => pattern.test(message));
}

export function formatWorkmuxAppCommandFailureMessage(message: string): string {
	const trimmed = message.trim();
	if (!trimmed || isMissingWorkmuxAppCommandFailure(trimmed)) {
		return WORKMUX_APP_COMMAND_UPDATE_MESSAGE;
	}
	return trimmed;
}

export function formatWorkmuxAppBoundaryFailureMessage(
	message: string,
): string {
	const trimmed = message.trim();
	if (/^No SSH connection available\b/.test(trimmed)) return trimmed;
	return formatWorkmuxAppCommandFailureMessage(message);
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

export function buildWorkmuxAppScrollExitCommand(sessionName: string): string {
	return `mdev tmux app scroll exit --session ${quoteShellValue(
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
	if (!isSafePositiveInteger(count) || count > WORKMUX_APP_SCROLL_MAX_COUNT) {
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
	roleOrDirection: WorkmuxFocusTarget,
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
	if (action === 'select') {
		if (index === undefined) {
			throw new Error('Missing Workmux nav select index');
		}
		if (!isSafeNonNegativeInteger(index)) {
			throw new Error(`Invalid Workmux nav select index: ${index}`);
		}
		return [
			'mdev tmux app nav',
			quoteShellValue(action),
			quoteShellValue(String(index)),
			`--session ${quoteShellValue(normalizeSessionName(sessionName))}`,
		].join(' ');
	}

	if (index !== undefined) {
		throw new Error(`Unexpected Workmux nav index for action: ${action}`);
	}

	const command = ['mdev tmux app nav', quoteShellValue(action)];
	command.push(
		`--session ${quoteShellValue(normalizeSessionName(sessionName))}`,
	);

	return command.join(' ');
}

export function parseWorkmuxAppContextOutput(
	output: string,
): WorkmuxAppContext {
	const value = parseSingleJsonObject(output, 'Invalid Workmux app context');
	const windowProjection = parseWorkmuxAppWindowProjection(
		value,
		'Invalid Workmux app context',
	);

	const context: WorkmuxAppContext = {
		...windowProjection,
		paneId: requireNonEmptyString(
			value,
			'paneId',
			'Invalid Workmux app context',
		),
		paneTty: requireString(value, 'paneTty', 'Invalid Workmux app context'),
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

	return parseWorkmuxAppWindowProjection(value, 'Invalid Workmux app window');
}

function parseWorkmuxAppWindowProjection(
	value: JsonRecord,
	errorMessage: string,
): WorkmuxAppWindow {
	const projection: WorkmuxAppWindow = {
		sessionName: requireNonEmptyString(value, 'sessionName', errorMessage),
		target: requireNonEmptyString(value, 'target', errorMessage),
		windowId: requireNonEmptyString(value, 'windowId', errorMessage),
		windowName: requireNonEmptyString(value, 'windowName', errorMessage),
		workspaceId: optionalString(value, 'workspaceId', errorMessage),
		role: optionalString(value, 'role', errorMessage),
	};
	const windowIndex = optionalWindowIndex(value, errorMessage);
	if (windowIndex !== undefined) projection.windowIndex = windowIndex;
	const roleWindow = optionalBoolean(value, 'roleWindow', errorMessage);
	if (roleWindow !== undefined) projection.roleWindow = roleWindow;
	const homeWindow = optionalBoolean(value, 'homeWindow', errorMessage);
	if (homeWindow !== undefined) projection.homeWindow = homeWindow;
	return projection;
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

function isSafeNonNegativeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function parseSingleJsonObject(
	output: string,
	errorMessage: string,
): JsonRecord {
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
	if (typeof field !== 'string' || field.trim().length === 0) {
		throw new Error(errorMessage);
	}
	return field;
}

function requireString(
	value: JsonRecord,
	fieldName: string,
	errorMessage: string,
): string {
	const field = value[fieldName];
	if (typeof field !== 'string') {
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

function optionalBoolean(
	value: JsonRecord,
	fieldName: string,
	errorMessage: string,
): boolean | undefined {
	const field = value[fieldName];
	if (field === undefined) return undefined;
	if (typeof field !== 'boolean') {
		throw new Error(errorMessage);
	}
	return field;
}

function optionalWindowIndex(
	value: JsonRecord,
	errorMessage: string,
): number | undefined {
	const field = value.windowIndex;
	if (field === undefined) return undefined;
	if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) {
		throw new Error(errorMessage);
	}
	return field;
}
