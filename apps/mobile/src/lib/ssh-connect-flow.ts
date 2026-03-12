import { type InputConnectionDetails } from './connection-storage';
import { getStoredConnectionId } from './connection-utils';
import { AbortSignalTimeout } from './utils';

type ConnectParamsBase<
	TSecurity,
	TProgressEvent,
	TServerKeyInfo,
> = {
	host: string;
	port: number;
	username: string;
	security: TSecurity;
	onConnectionProgress?: (progressEvent: TProgressEvent) => void;
	onServerKey: (serverKeyInfo: TServerKeyInfo) => Promise<boolean>;
	abortSignal: AbortSignal;
};

export async function connectAndRememberConnection<
	TSecurity,
	TProgressEvent,
	TServerKeyInfo,
	TResult extends { connectionId: string },
>(args: {
	connectionDetails: InputConnectionDetails;
	connect: (
		params: ConnectParamsBase<TSecurity, TProgressEvent, TServerKeyInfo>,
	) => Promise<TResult>;
	saveConnection: (params: {
		details: InputConnectionDetails;
		priority: number;
		label?: string;
	}) => Promise<unknown>;
	onConnectionProgress?: (progressEvent: TProgressEvent) => void;
	abortSignalTimeoutMs: number;
	resolvedSecurity: TSecurity;
}): Promise<{
	sshConnection: TResult;
	storedConnectionId: string;
}> {
	const sshConnection = await args.connect({
		host: args.connectionDetails.host,
		port: args.connectionDetails.port,
		username: args.connectionDetails.username,
		security: args.resolvedSecurity,
		onConnectionProgress: (progressEvent) => {
			args.onConnectionProgress?.(progressEvent);
		},
		// TODO: Implement proper host key verification (known_hosts).
		// Currently accepts all server keys, which is vulnerable to MITM attacks.
		// Future: store known host keys, verify against them, prompt user on mismatch.
		onServerKey: async () => true,
		abortSignal: AbortSignalTimeout(args.abortSignalTimeoutMs),
	});

	const storedConnectionId = getStoredConnectionId(args.connectionDetails);
	await args.saveConnection({
		label: `${args.connectionDetails.username}@${args.connectionDetails.host}:${args.connectionDetails.port}`,
		details: args.connectionDetails,
		priority: 0,
	});

	return {
		sshConnection,
		storedConnectionId,
	};
}
