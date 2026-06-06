export const WORKMUX_APP_COMMAND_UPDATE_MESSAGE =
	'Update mdev on the remote machine; this action requires mdev tmux app commands.';

export const WORKMUX_REMOTE_COMMAND_ENV_PREFIX =
	'env PATH="$PATH:$HOME/bin"';

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
	return new RegExp(
		`^(?:${escapeRegExp(WORKMUX_REMOTE_COMMAND_ENV_PREFIX)}\\s+)?mdev\\s+tmux\\s+(?:app(?:\\s|$)|nav\\s+cycle(?:\\s|$))`,
	).test(command);
}

export function prepareWorkmuxAppCommandForRemoteShell(
	command: string,
): string {
	if (!isWorkmuxAppCommand(command)) return command;
	if (command.startsWith(`${WORKMUX_REMOTE_COMMAND_ENV_PREFIX} `)) {
		return command;
	}
	return `${WORKMUX_REMOTE_COMMAND_ENV_PREFIX} ${command}`;
}

function isMissingWorkmuxAppCommandFailure(message: string): boolean {
	return [
		/\b(mdev|tmux): command not found\b/i,
		/\bcommand not found: (mdev|tmux)\b/i,
		/\b(mdev|tmux): not found\b/i,
		/\benv:\s+['"‘’]?(mdev|tmux)['"‘’]?:\s+(?:No such file or directory|not found)\b/i,
		/\bUnknown tmux app action\b/i,
		/\bUnknown tmux app \w+ action\b/i,
		/\bUnknown tmux command: app\b/i,
		/\bunknown tmux app\b/i,
		/\bunknown tmux command\b.*\bapp\b/i,
		/\bunknown command:\s*tmux\b/i,
		/\bunknown command\b.*\bapp\b/i,
		/\bunrecognized subcommand ['"]?tmux['"]?\b/i,
		/\bunrecognized subcommand ['"]?app['"]?\b/i,
		/\bUnknown tmux command: nav\b/i,
		/\bunknown tmux command\b.*\bnav\b/i,
		/\bunknown command\b.*\bnav\b/i,
		/\bunrecognized subcommand ['"]?nav['"]?\b/i,
		/\bunrecognized subcommand ['"]?cycle['"]?\b/i,
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

export function isWorkmuxScrollAlreadyInactiveFailureMessage(
	message: string,
): boolean {
	return /\bnot in (?:a|the) mode\b/i.test(message);
}

function buildMdevCommandFromArgv(argv: string[]): string {
	return ['mdev', ...argv]
		.map((value, index, tokens) =>
			isMdevCommandToken(index, tokens) ? value : quoteShellValue(value),
		)
		.join(' ');
}

function isMdevCommandToken(
	index: number,
	tokens: string[],
): boolean {
	if (index < 4) return true;
	switch (tokens[3]) {
		case 'context':
		case 'window':
			return index === 4;
		case 'notification':
			return index === 4 || index === 5 || index === 7;
		case 'focus':
			return index === 5;
		case 'nav':
			return tokens[4] === 'select' ? index === 6 : index === 5;
		default:
			return false;
	}
}

export function buildWorkmuxAppContextArgv(sessionName: string): string[] {
	return [
		'tmux',
		'app',
		'context',
		'--session',
		normalizeSessionName(sessionName),
	];
}

export function buildWorkmuxAppContextCommand(sessionName: string): string {
	return buildMdevCommandFromArgv(buildWorkmuxAppContextArgv(sessionName));
}

export function buildWorkmuxAppWindowArgv(sessionName: string): string[] {
	return [
		'tmux',
		'app',
		'window',
		'--session',
		normalizeSessionName(sessionName),
	];
}

export function buildWorkmuxAppWindowCommand(sessionName: string): string {
	return buildMdevCommandFromArgv(buildWorkmuxAppWindowArgv(sessionName));
}

export function buildWorkmuxAppNotificationOpenArgv(
	sessionName: string,
	windowId: string,
): string[] {
	return [
		'tmux',
		'app',
		'notification',
		'open',
		'--session',
		normalizeSessionName(sessionName),
		'--window-id',
		windowId,
	];
}

export function buildWorkmuxAppNotificationOpenCommand(
	sessionName: string,
	windowId: string,
): string {
	return buildMdevCommandFromArgv(
		buildWorkmuxAppNotificationOpenArgv(sessionName, windowId),
	);
}

export function buildWorkmuxAppScrollEnterCommand(sessionName: string): string {
	return `mdev tmux app scroll enter --session ${quoteRequiredShellValue(
		normalizeSessionName(sessionName),
	)}`;
}

export function buildWorkmuxAppScrollExitCommand(sessionName: string): string {
	return `mdev tmux app scroll exit --session ${quoteRequiredShellValue(
		normalizeSessionName(sessionName),
	)}`;
}

export function buildWorkmuxAppScrollPageCommand(
	sessionName: string,
	direction: WorkmuxScrollDirection,
	count: number,
): string {
	return buildWorkmuxAppScrollMoveCommand('page', sessionName, direction, count);
}

export function buildWorkmuxAppScrollLineCommand(
	sessionName: string,
	direction: WorkmuxScrollDirection,
	count: number,
): string {
	return buildWorkmuxAppScrollMoveCommand('line', sessionName, direction, count);
}

function buildWorkmuxAppScrollMoveCommand(
	unit: 'line' | 'page',
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
		`mdev tmux app scroll ${unit}-${direction}`,
		`--count ${quoteRequiredShellValue(String(count))}`,
		`--session ${quoteRequiredShellValue(normalizeSessionName(sessionName))}`,
	].join(' ');
}

export function buildWorkmuxAppFocusArgv(
	sessionName: string,
	roleOrDirection: WorkmuxFocusTarget,
): string[] {
	return [
		'tmux',
		'app',
		'focus',
		roleOrDirection,
		'--session',
		normalizeSessionName(sessionName),
	];
}

export function buildWorkmuxAppFocusCommand(
	sessionName: string,
	roleOrDirection: WorkmuxFocusTarget,
): string {
	return buildMdevCommandFromArgv(
		buildWorkmuxAppFocusArgv(sessionName, roleOrDirection),
	);
}

export function buildWorkmuxAppNavArgv(
	sessionName: string,
	action: WorkmuxNavAction,
	index?: number,
): string[] {
	if (action === 'select') {
		if (index === undefined) {
			throw new Error('Missing Workmux nav select index');
		}
		if (!isSafeNonNegativeInteger(index)) {
			throw new Error(`Invalid Workmux nav select index: ${index}`);
		}
		return [
			'tmux',
			'app',
			'nav',
			action,
			String(index),
			'--session',
			normalizeSessionName(sessionName),
		];
	}

	if (index !== undefined) {
		throw new Error(`Unexpected Workmux nav index for action: ${action}`);
	}

	return [
		'tmux',
		'app',
		'nav',
		action,
		'--session',
		normalizeSessionName(sessionName),
	];
}

export function buildWorkmuxAppNavCommand(
	sessionName: string,
	action: WorkmuxNavAction,
	index?: number,
): string {
	return buildMdevCommandFromArgv(
		buildWorkmuxAppNavArgv(sessionName, action, index),
	);
}

export function buildWorkmuxStatusCycleArgv(sessionName: string): string[] {
	return [
		'tmux',
		'nav',
		'cycle',
		`${normalizeSessionName(sessionName)}:`,
	];
}

export function buildWorkmuxStatusCycleCommand(sessionName: string): string {
	return buildMdevCommandFromArgv(buildWorkmuxStatusCycleArgv(sessionName));
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
	return quoteRequiredShellValue(value);
}

function quoteRequiredShellValue(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
