import {
	type DirectTmuxConnectionLike,
	type DirectTmuxControlTransport,
	buildDirectTmuxScrollEnterCommand,
	buildDirectTmuxScrollExitCommand,
	buildDirectTmuxScrollMoveCommand,
	createDirectTmuxControlTransport,
} from './workmux-direct-tmux-control';
import { type WorkmuxScrollDirection } from './workmux-app-commands';

export type WorkmuxControlCommandResult = {
	success: boolean;
	output: string;
	error?: string;
};

export type WorkmuxControlCommandOptions = {
	timeoutMs?: number;
};

export type WorkmuxScrollTarget = {
	sessionName: string;
};

export type WorkmuxScrollMove = WorkmuxScrollTarget & {
	direction: WorkmuxScrollDirection;
	unit: 'line' | 'page';
	count: number;
};

export type WorkmuxControlChannel = {
	command: (
		argv: string[],
		options?: WorkmuxControlCommandOptions,
	) => Promise<WorkmuxControlCommandResult>;
	scroll: {
		enter: (input: WorkmuxScrollTarget) => Promise<WorkmuxControlCommandResult>;
		move: (input: WorkmuxScrollMove) => Promise<WorkmuxControlCommandResult>;
		exit: (input: WorkmuxScrollTarget) => Promise<WorkmuxControlCommandResult>;
	};
	dispose: () => Promise<void>;
};

const DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS = 10_000;

function quoteShellValue(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function isMdevCommandToken(index: number, value: string): boolean {
	return index < 4 && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

export function formatMdevArgvCommand(argv: string[]): string {
	return ['mdev', ...argv]
		.map((value, index) =>
			isMdevCommandToken(index, value) ? value : quoteShellValue(value),
		)
		.join(' ');
}

function successResult(): WorkmuxControlCommandResult {
	return { success: true, output: '' };
}

function failureResult(error: string): WorkmuxControlCommandResult {
	return { success: false, output: '', error };
}

export function createWorkmuxControlChannel({
	connection,
	runRemoteCommand,
	directTmuxTransport = createDirectTmuxControlTransport({ connection }),
}: {
	connection: DirectTmuxConnectionLike | null;
	runRemoteCommand: (
		command: string,
		timeoutMs: number,
	) => Promise<WorkmuxControlCommandResult>;
	directTmuxTransport?: DirectTmuxControlTransport;
}): WorkmuxControlChannel {
	let disposed = false;

	const runDirect = async (
		command: string,
	): Promise<WorkmuxControlCommandResult> => {
		const sent = await directTmuxTransport.send(command);
		return sent
			? successResult()
			: failureResult('DirectMux control unavailable.');
	};

	const runScroll = (
		buildCommand: () => string,
	): Promise<WorkmuxControlCommandResult> => {
		if (disposed) {
			return Promise.resolve(
				failureResult('Workmux control channel disposed.'),
			);
		}
		return runDirect(buildCommand());
	};

	return {
		command: (argv, options) => {
			if (disposed) {
				return Promise.resolve(
					failureResult('Workmux control channel disposed.'),
				);
			}
			return runRemoteCommand(
				formatMdevArgvCommand(argv),
				options?.timeoutMs ?? DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS,
			);
		},
		scroll: {
			enter: (input) =>
				runScroll(() => buildDirectTmuxScrollEnterCommand(input.sessionName)),
			move: (input) => runScroll(() => buildDirectTmuxScrollMoveCommand(input)),
			exit: (input) =>
				runScroll(() => buildDirectTmuxScrollExitCommand(input.sessionName)),
		},
		dispose: async () => {
			disposed = true;
			await directTmuxTransport.dispose();
		},
	};
}
