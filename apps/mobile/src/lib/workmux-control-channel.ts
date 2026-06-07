import {
	createMdevBridgeClient,
	type MdevBridgeClient,
	type MdevBridgeStreamConnection,
} from './mdev-bridge-client';
import { type WorkmuxScrollDirection } from './workmux-app-commands';
import {
	WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS,
	buildMdevBridgeOperationFromWorkmuxArgv,
} from './workmux-bridge-operations';
import {
	type DirectTmuxConnectionLike,
	type DirectTmuxControlTransport,
	buildDirectTmuxScrollEnterCommand,
	buildDirectTmuxScrollExitCommand,
	buildDirectTmuxScrollMoveCommand,
	createDirectTmuxControlTransport,
} from './workmux-direct-tmux-control';

export type WorkmuxControlConnection = DirectTmuxConnectionLike &
	MdevBridgeStreamConnection;

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

export type WorkmuxControlChannelCleanupOptions = {
	cleanup?: Promise<unknown> | null;
	dispose: () => Promise<void>;
	onCleanupError?: (error: unknown) => void;
	onDisposeError?: (error: unknown) => void;
};

const DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS = 10_000;

function successResult(): WorkmuxControlCommandResult {
	return { success: true, output: '' };
}

function failureResult(error: string): WorkmuxControlCommandResult {
	return { success: false, output: '', error };
}

export function createWorkmuxControlChannel({
	connection,
	bridgeClient,
	directTmuxTransport = createDirectTmuxControlTransport({ connection }),
}: {
	connection: WorkmuxControlConnection | null;
	bridgeClient?: MdevBridgeClient;
	directTmuxTransport?: DirectTmuxControlTransport;
}): WorkmuxControlChannel {
	let disposed = false;
	const resolvedBridgeClient =
		bridgeClient ??
		(connection
			? createMdevBridgeClient({
					connection,
					requiredOperations: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS,
					requestTimeoutMs: DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS,
				})
			: null);

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
			try {
				const { operation, params } =
					buildMdevBridgeOperationFromWorkmuxArgv(argv);
				if (!resolvedBridgeClient) {
					return Promise.resolve(
						failureResult('No SSH connection available.'),
					);
				}
				return resolvedBridgeClient.runOperation({
					operation,
					params,
					timeoutMs:
						options?.timeoutMs ?? DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS,
				});
			} catch (error) {
				return Promise.resolve(
					failureResult(
						error instanceof Error ? error.message : String(error),
					),
				);
			}
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
			await Promise.all([
				resolvedBridgeClient?.dispose() ?? Promise.resolve(),
				directTmuxTransport.dispose(),
			]);
		},
	};
}

export function disposeWorkmuxControlChannelAfterCleanup({
	cleanup,
	dispose,
	onCleanupError,
	onDisposeError,
}: WorkmuxControlChannelCleanupOptions): void {
	const disposeChannel = () => {
		void dispose().catch((error: unknown) => {
			onDisposeError?.(error);
		});
	};

	if (!cleanup) {
		disposeChannel();
		return;
	}

	void cleanup
		.catch((error: unknown) => {
			onCleanupError?.(error);
		})
		.finally(disposeChannel);
}
