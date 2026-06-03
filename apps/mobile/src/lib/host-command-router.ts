import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from './host-browser-actions';
import {
	formatWorkmuxAppCommandFailureMessage,
	isWorkmuxAppCommand,
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
	executeRemoteTextCommand,
	executeSideChannelCommand,
}: {
	connection: TConnection | null;
	command: string;
	timeoutMs: number;
	executeRemoteTextCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<string>;
	executeSideChannelCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<HostCommandSideChannelResult>;
}): Promise<string> {
	if (!connection) {
		throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
	}

	if (isWorkmuxAppCommand(command)) {
		try {
			return await executeRemoteTextCommand(connection, command, timeoutMs);
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
