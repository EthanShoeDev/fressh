import { formatSavedConnectionSummary, type SavedConnectionEntry } from './connection-utils';

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
	return listConnectionsUsingKey(entries, keyId).map(formatSavedConnectionSummary);
}

export type KeyDeletionGuardState = 'loading' | 'error' | 'success';

export function getKeyDeletionGuard(params: {
	entries: SavedConnectionEntry[] | null | undefined;
	keyId: string;
	state: KeyDeletionGuardState;
}) {
	if (params.state === 'loading') {
		return {
			canDelete: false,
			message: 'Checking key usage…',
			usageSummary: [] as string[],
		};
	}

	if (params.state === 'error') {
		return {
			canDelete: false,
			message: 'Unable to verify key usage',
			usageSummary: [] as string[],
		};
	}

	const usageSummary = describeConnectionsUsingKey(
		params.entries ?? [],
		params.keyId,
	);

	if (usageSummary.length > 0) {
		return {
			canDelete: false,
			message: `Used by: ${usageSummary.join(', ')}`,
			usageSummary,
		};
	}

	return {
		canDelete: true,
		message: null,
		usageSummary,
	};
}
