import { create } from 'zustand';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- keep this factory free of runtime native-module imports for Node integration tests
type NativeRnRussh = typeof import('@fressh/react-native-uniffi-russh').RnRussh;
type SshConnection = Awaited<ReturnType<NativeRnRussh['connect']>>;
type SshShell = Awaited<ReturnType<SshConnection['startShell']>>;
type StartShellOptions = Parameters<SshConnection['startShell']>[0];

export type RegisteredStartShellOptions = StartShellOptions & {
	registerInStore?: boolean;
};

export type RegisteredSshConnection = Omit<SshConnection, 'startShell'> & {
	startShell: (opts: RegisteredStartShellOptions) => Promise<SshShell>;
};

type SshRegistryStore = {
	connections: Record<string, RegisteredSshConnection>;
	shells: Record<`${string}-${number}`, SshShell>;
	connect: (
		args: Parameters<NativeRnRussh['connect']>[0],
	) => Promise<RegisteredSshConnection>;
};

type SshRegistryLogger = {
	debug: (message: string, meta?: unknown) => void;
};

const noopLogger: SshRegistryLogger = {
	debug: () => {},
};

export function createSshRegistryStore(
	connect: NativeRnRussh['connect'],
	logger: SshRegistryLogger = noopLogger,
) {
	return create<SshRegistryStore>((set) => ({
		connections: {},
		shells: {},
		connect: async (args) => {
			const connection = await connect({
				...args,
				onDisconnected: (connectionId) => {
					args.onDisconnected?.(connectionId);
					logger.debug('connection disconnected', connectionId);
					set((s) => {
						const { [connectionId]: _omit, ...rest } = s.connections;
						return { connections: rest };
					});
				},
			});
			const originalStartShellFn = connection.startShell.bind(connection);
			const startShell: RegisteredSshConnection['startShell'] = async (
				args,
			) => {
				const { registerInStore = true, ...startShellArgs } = args;
				const shell = await originalStartShellFn({
					...startShellArgs,
					onClosed: (channelId) => {
						args.onClosed?.(channelId);
						if (!registerInStore) return;
						const storeKey = `${connection.connectionId}-${channelId}` as const;
						logger.debug('shell closed', storeKey);
						set((s) => {
							const { [storeKey]: _omit, ...rest } = s.shells;
							return { shells: rest };
						});
					},
				});
				const storeKey = `${connection.connectionId}-${shell.channelId}`;
				if (!registerInStore) return shell;
				set((s) => ({
					shells: {
						...s.shells,
						[storeKey]: shell,
					},
				}));
				return shell;
			};
			const registeredConnection: RegisteredSshConnection = {
				...connection,
				startShell,
			};
			set((s) => ({
				connections: {
					...s.connections,
					[connection.connectionId]: registeredConnection,
				},
			}));
			return registeredConnection;
		},
	}));
}
