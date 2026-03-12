import { type StoredConnectionDetails } from './connection-storage';

type SavedConnectionMetadata = {
	modifiedAtMs: number;
	createdAtMs: number;
	priority: number;
	label?: string;
};

export type SavedConnectionEntry = {
	id: string;
	metadata: SavedConnectionMetadata;
	value: StoredConnectionDetails;
};

type PartialConnectionEntry = {
	id: string;
	metadata: { modifiedAtMs?: number } | SavedConnectionMetadata;
	value: StoredConnectionDetails;
};

export const pickLatestConnection = <T extends PartialConnectionEntry>(
	entries?: T[] | null,
): T | null => {
	if (!entries || entries.length === 0) return null;
	return entries.reduce((latest, entry) => {
		const latestModified = latest.metadata.modifiedAtMs ?? 0;
		const entryModified = entry.metadata.modifiedAtMs ?? 0;
		return entryModified > latestModified ? entry : latest;
	});
};

export const getStoredConnectionId = (details: {
	username: string;
	host: string;
	port: number;
}): string => {
	return `${details.username}-${details.host}-${details.port}`.replaceAll(
		'.',
		'_',
	);
};
