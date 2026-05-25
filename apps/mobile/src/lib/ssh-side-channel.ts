import { type SshConnection } from '@fressh/react-native-uniffi-russh';
import { rootLogger } from './logger';
import {
	executeSideChannelCommandCore,
	type SideChannelResult,
} from './ssh-side-channel-core';

const logger = rootLogger.extend('SshSideChannel');

export type { SideChannelResult };

/**
 * Execute a command on a side-channel SSH session.
 * Creates a temporary shell on the existing connection, runs the command,
 * captures output, and closes the shell - without interfering with the main terminal.
 */
export async function executeSideChannelCommand(
	connection: SshConnection,
	command: string,
	timeoutMs: number = 30000,
): Promise<SideChannelResult> {
	return executeSideChannelCommandCore({
		connection,
		command,
		timeoutMs,
		logger,
	});
}
