import { useAtomValue } from '@effect/atom-react';
import { useCallback } from 'react';
import {
	sshConnectionsAtom,
	sshShellsAtom,
	type StoreConnection,
	type StoreShell,
} from './ssh-store';

/**
 * Bridges a *saved* connection (keychain, persisted) to its *live* runtime
 * counterpart (ssh-store, ephemeral). The two have unrelated ids — the runtime
 * `connectionId` is minted by fressh-core at connect time — so we match on the
 * host/port/username triple, which is what the saved-connection id is derived
 * from anyway (see `secrets-manager.upsertConnection`).
 *
 * Selectors are memoized on the match fields (not the `match` object, which is
 * rebuilt per render) so `useAtomValue`'s derived atom stays stable, and they
 * select identity-stable values / primitives so the registry's `Object.is`
 * dedupe skips re-renders on unrelated store updates.
 */
export type ServerMatch = {
	host: string;
	port: number;
	username: string;
};

/** The live connection for a saved server, if one is currently open. */
export function useLiveConnection(match: ServerMatch | undefined) {
	const host = match?.host;
	const port = match?.port;
	const username = match?.username;
	return useAtomValue(
		sshConnectionsAtom,
		useCallback(
			(connections: Record<string, StoreConnection>) =>
				host === undefined
					? undefined
					: Object.values(connections).find(
							(c) =>
								c.connectionDetails.host === host &&
								c.connectionDetails.port === port &&
								c.connectionDetails.username === username,
						),
			[host, port, username],
		),
	);
}

const EMPTY_SHELLS: StoreShell[] = [];

/** Active shells belonging to a live connection id (empty if none/disconnected). */
export function useConnectionShells(connectionId: string | undefined) {
	return useAtomValue(
		sshShellsAtom,
		useCallback(
			(shells: Record<string, StoreShell>) =>
				connectionId
					? Object.values(shells).filter(
							(sh) => sh.connectionId === connectionId,
						)
					: EMPTY_SHELLS,
			[connectionId],
		),
	);
}

export type ServerLiveStatus = 'live' | 'idle' | 'off';

/**
 * Compact live status for a saved server, suitable for a list row. Each piece
 * is selected as a primitive, so a row only re-renders when ITS connection id
 * or shell count actually changes.
 * - `live`: connected with ≥1 active shell
 * - `idle`: connected but no shells open
 * - `off`:  not connected
 */
export function useServerLiveStatus(match: ServerMatch | undefined) {
	const host = match?.host;
	const port = match?.port;
	const username = match?.username;
	const connectionId = useAtomValue(
		sshConnectionsAtom,
		useCallback(
			(connections: Record<string, StoreConnection>) =>
				(host === undefined
					? undefined
					: Object.values(connections).find(
							(c) =>
								c.connectionDetails.host === host &&
								c.connectionDetails.port === port &&
								c.connectionDetails.username === username,
						)
				)?.connectionId ?? null,
			[host, port, username],
		),
	);
	const shellCount = useAtomValue(
		sshShellsAtom,
		useCallback(
			(shells: Record<string, StoreShell>) =>
				connectionId
					? Object.values(shells).filter(
							(sh) => sh.connectionId === connectionId,
						).length
					: 0,
			[connectionId],
		),
	);
	const status: ServerLiveStatus = !connectionId
		? 'off'
		: shellCount > 0
			? 'live'
			: 'idle';
	return { connectionId, shellCount, status };
}
