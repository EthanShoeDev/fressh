import {
	RnRussh,
	type SshConnection,
	type SshShell,
} from '@fressh/react-native-uniffi-russh';
import { create } from 'zustand';

type SshRegistryStore = {
	connections: Record<string, SshConnection>;
	shells: Record<`${string}-${number}`, SshShell>;
	connect: typeof RnRussh.connect;
};

export const useSshStore = create<SshRegistryStore>((set) => ({
	connections: {},
	shells: {},
	connect: async (args) => {
		const connection = await RnRussh.connect({
			...args,
			onDisconnected: (connectionId) => {
				args.onDisconnected?.(connectionId);
				console.log('DEBUG connection disconnected', connectionId);
				set((s) => {
					const { [connectionId]: _omit, ...rest } = s.connections;
					return { connections: rest };
				});
			},
		});
		const originalStartShellFn = connection.startShell;
		const startShell: typeof connection.startShell = async (args) => {
			const shell = await originalStartShellFn({
				...args,
				onClosed: (channelId) => {
					args.onClosed?.(channelId);
					const storeKey = `${connection.connectionId}-${channelId}` as const;
					console.log('DEBUG shell closed', storeKey);
					set((s) => {
						const { [storeKey]: _omit, ...rest } = s.shells;
						return { shells: rest };
					});
				},
			});
			const storeKey = `${connection.connectionId}-${shell.channelId}`;
			set((s) => ({
				shells: {
					...s.shells,
					[storeKey]: shell,
				},
			}));
			return shell;
		};
		connection.startShell = startShell;
		set((s) => ({
			connections: {
				...s.connections,
				[connection.connectionId]: connection,
			},
		}));
		return connection;
	},
}));
