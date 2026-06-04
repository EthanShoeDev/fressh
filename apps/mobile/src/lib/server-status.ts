import { useShallow } from 'zustand/react/shallow';
import {
	useSshStore,
	type StoreConnection,
	type StoreShell,
} from './ssh-store';

/**
 * Bridges a *saved* connection (keychain, persisted) to its *live* runtime
 * counterpart (ssh-store, ephemeral). The two have unrelated ids — the runtime
 * `connectionId` is minted by fressh-core at connect time — so we match on the
 * host/port/username triple, which is what the saved-connection id is derived
 * from anyway (see `secrets-manager.upsertConnection`).
 */
export type ServerMatch = {
	host: string;
	port: number;
	username: string;
};

function connectionMatches(c: StoreConnection, m: ServerMatch) {
	return (
		c.connectionDetails.host === m.host &&
		c.connectionDetails.port === m.port &&
		c.connectionDetails.username === m.username
	);
}

/** The live connection for a saved server, if one is currently open. */
export function useLiveConnection(match: ServerMatch | undefined) {
	return useSshStore(
		useShallow((s) =>
			match
				? Object.values(s.connections).find((c) => connectionMatches(c, match))
				: undefined,
		),
	);
}

/** Active shells belonging to a live connection id (empty if none/disconnected). */
export function useConnectionShells(connectionId: string | undefined) {
	return useSshStore(
		useShallow((s) =>
			connectionId
				? Object.values(s.shells).filter(
						(sh) => sh.connectionId === connectionId,
					)
				: ([] as StoreShell[]),
		),
	);
}

export type ServerLiveStatus = 'live' | 'idle' | 'off';

/**
 * Compact live status for a saved server, suitable for a list row. Returns
 * primitives only so `useShallow` keeps the selection stable across unrelated
 * store updates.
 * - `live`: connected with ≥1 active shell
 * - `idle`: connected but no shells open
 * - `off`:  not connected
 */
export function useServerLiveStatus(match: ServerMatch | undefined) {
	return useSshStore(
		useShallow((s) => {
			const connection = match
				? Object.values(s.connections).find((c) => connectionMatches(c, match))
				: undefined;
			const connectionId = connection?.connectionId ?? null;
			const shellCount = connectionId
				? Object.values(s.shells).filter(
						(sh) => sh.connectionId === connectionId,
					).length
				: 0;
			const status: ServerLiveStatus = !connectionId
				? 'off'
				: shellCount > 0
					? 'live'
					: 'idle';
			return { connectionId, shellCount, status };
		}),
	);
}
