import { type WorkmuxScrollDirection } from './workmux-app-commands';

export type DirectTmuxShellLike = {
	channelId: number;
	addListener?: (
		listener: (event: unknown) => void,
		options: { cursor: { mode: 'live' } },
	) => bigint;
	removeListener?: (listenerId: bigint) => void;
	sendData: (bytes: ArrayBuffer, opts?: { signal?: AbortSignal }) => Promise<void>;
	close: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export type DirectTmuxConnectionLike = {
	startShell: (options: {
		term: 'Xterm';
		useTmux: false;
		tmuxSessionName: '';
		abortSignal?: AbortSignal;
		registerInStore?: false;
	}) => Promise<DirectTmuxShellLike>;
};

export type DirectTmuxScrollMove = {
	sessionName: string;
	direction: WorkmuxScrollDirection;
	unit: 'line' | 'page';
	count: number;
};

export type DirectTmuxControlTransport = {
	send: (command: string) => Promise<boolean>;
	dispose: () => Promise<void>;
};

const encoder = new TextEncoder();

function quoteTmuxTarget(target: string): string {
	return /^[A-Za-z0-9_@.=-]+$/.test(target)
		? target
		: `'${target.replace(/'/g, "'\\''")}'`;
}

function requirePositiveInteger(count: number): number {
	if (!Number.isSafeInteger(count) || count <= 0) {
		throw new Error(`Invalid DirectMux count: ${count}`);
	}
	return count;
}

export function buildDirectTmuxScrollEnterCommand(sessionName: string): string {
	return `tmux copy-mode -t ${quoteTmuxTarget(sessionName)}`;
}

export function buildDirectTmuxScrollExitCommand(sessionName: string): string {
	return `tmux send-keys -t ${quoteTmuxTarget(sessionName)} q`;
}

export function buildDirectTmuxScrollMoveCommand({
	sessionName,
	direction,
	unit,
	count,
}: DirectTmuxScrollMove): string {
	const safeCount = requirePositiveInteger(count);
	const tmuxAction =
		unit === 'page'
			? direction === 'up'
				? 'page-up'
				: 'page-down'
			: direction === 'up'
				? 'scroll-up'
				: 'scroll-down';
	return [
		'tmux send-keys',
		`-t ${quoteTmuxTarget(sessionName)}`,
		`-N ${safeCount}`,
		`-X ${tmuxAction}`,
	].join(' ');
}

export function buildDirectTmuxSelectWindowCommand(
	sessionName: string,
	windowId: string,
): string {
	return `tmux select-window -t ${quoteTmuxTarget(`${sessionName}:${windowId}`)}`;
}

export function createDirectTmuxControlTransport({
	connection,
}: {
	connection: DirectTmuxConnectionLike | null;
}): DirectTmuxControlTransport {
	let shellPromise: Promise<DirectTmuxShellLike> | null = null;
	let disposed = false;

	const getShell = async () => {
		if (!connection) throw new Error('No SSH connection available.');
		if (disposed) throw new Error('DirectMux control transport disposed.');
		shellPromise ??= connection.startShell({
			term: 'Xterm',
			useTmux: false,
			tmuxSessionName: '',
			registerInStore: false,
		});
		return shellPromise;
	};

	return {
		send: async (command) => {
			try {
				const shell = await getShell();
				await shell.sendData(encoder.encode(`${command}\n`).buffer as ArrayBuffer);
				return true;
			} catch {
				shellPromise = null;
				return false;
			}
		},
		dispose: async () => {
			disposed = true;
			const shell = await shellPromise?.catch(() => null);
			shellPromise = null;
			await shell?.close().catch(() => {});
		},
	};
}
