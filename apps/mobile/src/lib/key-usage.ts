import { type SavedConnectionEntry } from './connection-utils';

export function listConnectionsUsingKey(
	entries: SavedConnectionEntry[],
	keyId: string,
) {
	return entries.filter((entry) => entry.value.security.keyId === keyId);
}

export function describeConnectionsUsingKey(
	entries: SavedConnectionEntry[],
	keyId: string,
) {
	return listConnectionsUsingKey(entries, keyId).map(
		(entry) => entry.metadata.label ?? entry.id,
	);
}
