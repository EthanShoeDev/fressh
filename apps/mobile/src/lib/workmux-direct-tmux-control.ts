import { type WorkmuxScrollDirection } from './workmux-app-commands';

export type DirectTmuxShellLike = {
	channelId: number;
	addListener?: (
		listener: (event: unknown) => void,
		options: { cursor: { mode: 'live' } },
	) => bigint;
	removeListener?: (listenerId: bigint) => void;
	sendData: (
		bytes: ArrayBuffer,
		opts?: { signal?: AbortSignal },
	) => Promise<void>;
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

export type DirectTmuxResizeWindow = {
	targetName: string;
	cols: number;
	rows: number;
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

function requireScrollDirection(
	direction: WorkmuxScrollDirection,
): WorkmuxScrollDirection {
	if (direction !== 'down' && direction !== 'up') {
		throw new Error(`Invalid DirectMux direction: ${direction}`);
	}
	return direction;
}

function requireScrollUnit(unit: DirectTmuxScrollMove['unit']) {
	if (unit !== 'line' && unit !== 'page') {
		throw new Error(`Invalid DirectMux unit: ${unit}`);
	}
	return unit;
}

export function buildDirectTmuxScrollEnterCommand(sessionName: string): string {
	return `tmux copy-mode -t ${quoteTmuxTarget(sessionName)}`;
}

export function buildDirectTmuxScrollExitCommand(sessionName: string): string {
	return `tmux send-keys -t ${quoteTmuxTarget(sessionName)} -X cancel`;
}

export function buildDirectTmuxScrollMoveCommand({
	sessionName,
	direction,
	unit,
	count,
}: DirectTmuxScrollMove): string {
	const safeCount = requirePositiveInteger(count);
	const safeDirection = requireScrollDirection(direction);
	const safeUnit = requireScrollUnit(unit);
	const tmuxAction =
		safeUnit === 'page'
			? safeDirection === 'up'
				? 'page-up'
				: 'page-down'
			: safeDirection === 'up'
				? 'scroll-up'
				: 'scroll-down';
	return [
		'tmux send-keys',
		`-t ${quoteTmuxTarget(sessionName)}`,
		`-N ${safeCount}`,
		`-X ${tmuxAction}`,
	].join(' ');
}

export function buildDirectTmuxResizeWindowCommand({
	targetName,
	cols,
	rows,
}: DirectTmuxResizeWindow): string {
	const safeCols = requirePositiveInteger(cols);
	const safeRows = requirePositiveInteger(rows);
	const target = quoteTmuxTarget(targetName);
	return [
		'tmux resize-window',
		`-t ${target}`,
		`-x ${safeCols}`,
		`-y ${safeRows}`,
		'\\;',
		'set-window-option',
		`-t ${target}`,
		'window-size manual',
	].join(' ');
}

export function createDirectTmuxControlTransport({
	connection,
}: {
	connection: DirectTmuxConnectionLike | null;
}): DirectTmuxControlTransport {
	let shellPromise: Promise<DirectTmuxShellLike> | null = null;
	let queue: Promise<void> = Promise.resolve();
	let disposePromise: Promise<void> | null = null;
	let disposing = false;
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

	const closeCachedShell = async () => {
		const cachedShellPromise = shellPromise;
		shellPromise = null;
		const shell = await cachedShellPromise?.catch(() => null);
		await shell?.close().catch(() => {});
	};

	const sendNow = async (command: string) => {
		try {
			const shell = await getShell();
			await shell.sendData(
				encoder.encode(`${command}\n`).buffer as ArrayBuffer,
			);
			return true;
		} catch {
			await closeCachedShell();
			return false;
		}
	};

	return {
		send: async (command) => {
			if (disposed || disposing || /[\r\n]/.test(command)) return false;
			const result = queue.then(() => sendNow(command));
			queue = result.then(
				() => {},
				() => {},
			);
			return result;
		},
		dispose: () => {
			disposePromise ??= (async () => {
				disposing = true;
				await queue.catch(() => {});
				disposed = true;
				await closeCachedShell();
			})();
			return disposePromise;
		},
	};
}
