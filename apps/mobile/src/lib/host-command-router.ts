import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from './host-browser-actions';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	formatWorkmuxAppCommandFailureMessage,
	isWorkmuxAppCommand,
	parseWorkmuxAppCommandArgv,
} from './workmux-app-commands';

export type HostCommandSideChannelResult = {
	success: boolean;
	output: string;
	error?: string;
};

export async function runHostCommandWithBoundary<TConnection>({
	connection,
	command,
	timeoutMs,
	executeSideChannelCommand,
	runWorkmuxCommand,
}: {
	connection: TConnection | null;
	command: string;
	timeoutMs: number;
	executeSideChannelCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<HostCommandSideChannelResult>;
	runWorkmuxCommand?: (
		connection: TConnection,
		argv: string[],
		timeoutMs: number,
	) => Promise<string>;
}): Promise<string> {
	if (!connection) {
		throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
	}

	if (isWorkmuxAppCommand(command)) {
		try {
			const argv = parseWorkmuxAppCommandArgv(command);
			if (!argv || !runWorkmuxCommand) {
				throw new Error(WORKMUX_APP_COMMAND_UPDATE_MESSAGE);
			}
			return await runWorkmuxCommand(connection, argv, timeoutMs);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(formatWorkmuxAppCommandFailureMessage(message));
		}
	}

	const result = await executeSideChannelCommand(
		connection,
		command,
		timeoutMs,
	);
	if (!result.success) {
		throw new Error(result.error || result.output || 'Remote command failed.');
	}
	return result.output.trim();
}
