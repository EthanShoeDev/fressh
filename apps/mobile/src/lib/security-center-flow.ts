import * as z from 'zod';
import { type StoredConnectionEntry } from './connection-storage';
import { formatSavedConnectionSummary } from './connection-utils';
import {
	backupPayloadSchema,
	normalizeLocalBackupPayload,
	parseBackupPayload,
	replaceAllFromBackup,
	type BackupPayload,
	type BackupKeyEntry,
	validateBackupPayload,
} from './device-migration';

type SecurityCenterShareOptions = {
	mimeType: string;
	dialogTitle: string;
};

type SecurityCenterPickerAsset = {
	uri?: string | null;
};

type RestoreRecoveryTarget = 'target' | 'previous';
type RestoreJournalPhase = 'pending' | 'applied';

type RestoreJournalState = {
	phase: RestoreJournalPhase;
	recoveryTarget: RestoreRecoveryTarget;
	previous: BackupPayload;
	target: BackupPayload;
};

const restoreJournalStateSchema = z
	.object({
		phase: z.enum(['pending', 'applied']).optional(),
		recoveryTarget: z.enum(['target', 'previous']).optional(),
		recoveryState: z.enum(['apply-target', 'apply-previous']).optional(),
		previous: backupPayloadSchema,
		target: backupPayloadSchema,
	})
	.superRefine((value, context) => {
		if (value.recoveryTarget || value.recoveryState) {
			return;
		}

		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'Restore journal state is missing a recovery target.',
			path: ['recoveryTarget'],
		});
	})
	.transform((value): RestoreJournalState => ({
		phase: value.phase ?? 'pending',
		recoveryTarget:
			value.recoveryTarget ??
			(value.recoveryState === 'apply-previous' ? 'previous' : 'target'),
		previous: value.previous,
		target: value.target,
	}));

export type RestoreJournalStorage = {
	load: () => Promise<unknown | null>;
	save: (state: RestoreJournalState) => Promise<void>;
	clear: () => Promise<void>;
};

export type SecurityCenterPickerResult =
	| {
			canceled: true;
			assets?: SecurityCenterPickerAsset[] | null;
	  }
	| {
			canceled?: false;
			assets?: SecurityCenterPickerAsset[] | null;
	  };

function createSnapshot(params: {
	keys: BackupKeyEntry[];
	connections: StoredConnectionEntry[];
}) {
	return normalizeLocalBackupPayload({
		version: 1 as const,
		createdAt: new Date().toISOString(),
		keys: params.keys,
		connections: params.connections,
	});
}

async function clearInvalidRestoreJournal(params: {
	restoreJournal: RestoreJournalStorage;
	context: string;
	cause: unknown;
}) {
	try {
		await finalizeRestoreJournal({
			restoreJournal: params.restoreJournal,
			context: params.context,
			cause: params.cause,
		});
		return {
			state: null,
			clearedInvalidJournal: true as const,
		};
	} catch (error) {
		return {
			state: null,
			clearedInvalidJournal: false as const,
			invalidJournalRetained: true as const,
		};
	}
}

async function finalizeRestoreJournal(params: {
	restoreJournal?: RestoreJournalStorage;
	completedState?: Omit<RestoreJournalState, 'phase'>;
	context: string;
	cause?: unknown;
}) {
	let completionSaveError: unknown = null;
	if (params.restoreJournal && params.completedState) {
		completionSaveError = await trySaveRestoreJournalState({
			restoreJournal: params.restoreJournal,
			state: {
				...params.completedState,
				phase: 'applied',
			},
		});
	}

	try {
		await params.restoreJournal?.clear();
	} catch (error) {
		throw createRestoreJournalClearError({
			context: params.context,
			error,
			cause:
				completionSaveError instanceof Error
					? completionSaveError
					: params.cause,
		});
	}
}

async function applyRestoreSnapshot(params: {
	payload: BackupPayload;
	replaceAllKeys: (entries: BackupKeyEntry[]) => Promise<void>;
	replaceAllConnections: (entries: StoredConnectionEntry[]) => Promise<void>;
}) {
	return replaceAllFromBackup({
		payload: params.payload,
		replaceAllKeys: params.replaceAllKeys,
		replaceAllConnections: params.replaceAllConnections,
	});
}

function sortEntriesById<T extends { id: string }>(entries: T[]) {
	return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

function matchesSnapshot(
	snapshot: {
		keys: BackupKeyEntry[];
		connections: StoredConnectionEntry[];
	},
	payload: BackupPayload,
) {
	const normalizedSnapshot = normalizeLocalBackupPayload({
		version: 1,
		createdAt: 'snapshot',
		keys: snapshot.keys,
		connections: snapshot.connections,
	});
	const normalizedPayload = normalizeLocalBackupPayload(payload);
	return (
		JSON.stringify(sortEntriesById(normalizedSnapshot.keys)) ===
			JSON.stringify(sortEntriesById(normalizedPayload.keys)) &&
		JSON.stringify(sortEntriesById(normalizedSnapshot.connections)) ===
			JSON.stringify(sortEntriesById(normalizedPayload.connections))
	);
}

async function trySaveRestoreJournalState(params: {
	restoreJournal?: RestoreJournalStorage;
	state: RestoreJournalState;
}) {
	try {
		await params.restoreJournal?.save(params.state);
		return null;
	} catch (error) {
		return error;
	}
}

function createRestoreJournalTransitionError(params: {
	target: RestoreRecoveryTarget;
	error: unknown;
	cause?: unknown;
}) {
	const message =
		params.error instanceof Error
			? params.error.message
			: 'Unknown restore journal transition failure.';
	return new Error(
		`Failed to persist restore journal for ${params.target} recovery: ${message}`,
		params.cause ? { cause: params.cause } : undefined,
	);
}

function createRestoreJournalClearError(params: {
	context: string;
	error: unknown;
	cause?: unknown;
}) {
	const message =
		params.error instanceof Error
			? params.error.message
			: 'Unknown restore journal clear failure.';
	return new Error(
		`Failed to clear restore journal after ${params.context}: ${message}`,
		params.cause ? { cause: params.cause } : undefined,
	);
}

async function loadRestoreJournalState(params: {
	restoreJournal: RestoreJournalStorage;
}) {
	let rawState: unknown;
	try {
		rawState = await params.restoreJournal.load();
	} catch (error) {
		return clearInvalidRestoreJournal({
			restoreJournal: params.restoreJournal,
			context: 'discarding unreadable restore journal',
			cause: error,
		});
	}
	if (!rawState) {
		return {
			state: null,
		};
	}
	try {
		const state = restoreJournalStateSchema.parse(rawState);
		const normalizedState = {
			...state,
			previous: normalizeLocalBackupPayload(state.previous),
			target: normalizeLocalBackupPayload(state.target),
		};
		validateBackupPayload(normalizedState.previous);
		validateBackupPayload(normalizedState.target);
		return {
			state: normalizedState,
		};
	} catch (error) {
		return clearInvalidRestoreJournal({
			restoreJournal: params.restoreJournal,
			context: 'discarding invalid restore journal',
			cause: error,
		});
	}
}

export async function exportBackupForSharing(params: {
	createBackupPayload: () => Promise<BackupPayload>;
	cacheDirectory: string | null | undefined;
	writeAsString: (path: string, value: string) => Promise<void>;
	isSharingAvailable: () => Promise<boolean>;
	share: (path: string, options: SecurityCenterShareOptions) => Promise<void>;
	deleteFile?: (path: string) => Promise<void>;
}) {
	if (!params.cacheDirectory) {
		throw new Error('Temporary backup storage is unavailable.');
	}

	const payload = await params.createBackupPayload();
	const backupPath = `${params.cacheDirectory}fressh-backup.json`;

	await params.writeAsString(backupPath, JSON.stringify(payload, null, 2));

	try {
		const isSharingAvailable = await params.isSharingAvailable();
		if (!isSharingAvailable) {
			throw new Error('Sharing is unavailable on this device.');
		}
		await params.share(backupPath, {
			mimeType: 'application/json',
			dialogTitle: 'Share Backup File',
		});
		return { backupPath };
	} finally {
		if (params.deleteFile) {
			await params.deleteFile(backupPath).catch(() => {});
		}
	}
}

export async function loadBackupPayloadFromPicker(params: {
	pickDocument: () => Promise<SecurityCenterPickerResult>;
	readAsString: (uri: string) => Promise<string>;
}) {
	const picked = await params.pickDocument();
	if ('canceled' in picked && picked.canceled) {
		return { status: 'cancelled' as const };
	}

	const asset = picked.assets?.[0];
	if (!asset?.uri) {
		throw new Error('No backup file selected.');
	}

	const raw = await params.readAsString(asset.uri);
	return {
		status: 'selected' as const,
		payload: parseBackupPayload(raw),
	};
}

export function createRestorePreflightSummary(payload: BackupPayload) {
	const keys = payload.keys.map((entry) => ({
		id: entry.id,
		label: entry.metadata.label ?? entry.id,
	}));
	const connections = payload.connections.map((entry) => ({
		id: entry.id,
		label: formatSavedConnectionSummary(entry),
	}));
	const keyLines =
		keys.length > 0
			? keys.map((entry) => `- ${entry.label}`).join('\n')
			: '- None';
	const connectionLines =
		connections.length > 0
			? connections.map((entry) => `- ${entry.label}`).join('\n')
			: '- None';

	return {
		keys,
		connections,
		message: `Keys to replace:\n${keyLines}\n\nSaved connections to replace:\n${connectionLines}`,
	};
}

export async function restoreBackupPayload(params: {
	payload: BackupPayload;
	listCurrentKeys: () => Promise<BackupKeyEntry[]>;
	listCurrentConnections: () => Promise<StoredConnectionEntry[]>;
	replaceAllKeys: (entries: BackupKeyEntry[]) => Promise<void>;
	replaceAllConnections: (entries: StoredConnectionEntry[]) => Promise<void>;
	restoreJournal?: RestoreJournalStorage;
}) {
	const previousSnapshot = createSnapshot({
		keys: await params.listCurrentKeys(),
		connections: await params.listCurrentConnections(),
	});
	const targetState: RestoreJournalState = {
		phase: 'pending',
		recoveryTarget: 'target',
		previous: previousSnapshot,
		target: params.payload,
	};

	await params.restoreJournal?.save(targetState);

	let restored: Awaited<ReturnType<typeof applyRestoreSnapshot>>;
	try {
		restored = await applyRestoreSnapshot({
			payload: params.payload,
			replaceAllKeys: params.replaceAllKeys,
			replaceAllConnections: params.replaceAllConnections,
		});
	} catch (error) {
		const rollbackTransitionError = await trySaveRestoreJournalState({
			restoreJournal: params.restoreJournal,
			state: {
				...targetState,
				phase: 'pending',
				recoveryTarget: 'previous',
			},
		});
		try {
			await applyRestoreSnapshot({
				payload: previousSnapshot,
				replaceAllKeys: params.replaceAllKeys,
				replaceAllConnections: params.replaceAllConnections,
			});
		} catch (rollbackError) {
			await trySaveRestoreJournalState({
				restoreJournal: params.restoreJournal,
				state: targetState,
			});
			let reapplied: Awaited<ReturnType<typeof applyRestoreSnapshot>>;
			try {
				reapplied = await applyRestoreSnapshot({
					payload: params.payload,
					replaceAllKeys: params.replaceAllKeys,
					replaceAllConnections: params.replaceAllConnections,
				});
			} catch (recoveryError) {
				throw new Error(
					`Restore failed, rollback failed, and recovery failed: ${
						recoveryError instanceof Error
							? recoveryError.message
							: 'Unknown recovery error.'
					}`,
					{
						cause: new Error(
							`Rollback failed: ${
								rollbackError instanceof Error
									? rollbackError.message
									: 'Unknown rollback error.'
							}`,
							{ cause: error },
						),
					},
				);
			}
			try {
				await finalizeRestoreJournal({
					restoreJournal: params.restoreJournal,
					completedState: {
						recoveryTarget: 'target',
						previous: previousSnapshot,
						target: params.payload,
					},
					context: 'reapplying target snapshot',
					cause: new Error(
						`Rollback failed: ${
							rollbackError instanceof Error
								? rollbackError.message
								: 'Unknown rollback error.'
						}`,
						{ cause: error },
					),
				});
			} catch (finalizeError) {
				throw finalizeError;
			}
			return {
				...reapplied,
				recoveredConsistency: true as const,
			};
		}
		try {
			await finalizeRestoreJournal({
				restoreJournal: params.restoreJournal,
				completedState: {
					recoveryTarget: 'previous',
					previous: previousSnapshot,
					target: params.payload,
				},
				context: 'restoring previous snapshot',
				cause:
					rollbackTransitionError
						? createRestoreJournalTransitionError({
								target: 'previous',
								error: rollbackTransitionError,
								cause: error,
							})
						: error,
			});
		} catch (finalizeError) {
			throw finalizeError;
		}
		if (rollbackTransitionError) {
			throw createRestoreJournalTransitionError({
				target: 'previous',
				error: rollbackTransitionError,
				cause: error,
			});
		}
		throw error;
	}
	try {
		await finalizeRestoreJournal({
			restoreJournal: params.restoreJournal,
			completedState: {
				recoveryTarget: 'target',
				previous: previousSnapshot,
				target: params.payload,
			},
			context: 'applying target snapshot',
		});
	} catch (finalizeError) {
		throw finalizeError;
	}
	return restored;
}

export async function recoverPendingRestore(params: {
	restoreJournal: RestoreJournalStorage;
	listCurrentKeys?: () => Promise<BackupKeyEntry[]>;
	listCurrentConnections?: () => Promise<StoredConnectionEntry[]>;
	replaceAllKeys: (entries: BackupKeyEntry[]) => Promise<void>;
	replaceAllConnections: (entries: StoredConnectionEntry[]) => Promise<void>;
}) {
	const loadedState = await loadRestoreJournalState({
		restoreJournal: params.restoreJournal,
	});
	if (!loadedState.state) {
		return {
			restored: false as const,
			...('clearedInvalidJournal' in loadedState
				? { clearedInvalidJournal: loadedState.clearedInvalidJournal }
				: {}),
			...('invalidJournalRetained' in loadedState
				? { invalidJournalRetained: true as const }
				: {}),
		};
	}

	const state = loadedState.state;
	if (state.phase === 'applied') {
		try {
			await finalizeRestoreJournal({
				restoreJournal: params.restoreJournal,
				context: 'discarding completed restore journal',
			});
		} catch {
			return {
				restored: false as const,
				completedJournalRetained: true as const,
			};
		}
		return {
			restored: false as const,
		};
	}

	if (!params.listCurrentKeys || !params.listCurrentConnections) {
		return {
			restored: false as const,
			recoveryPending: true as const,
			reason: 'state-verification-unavailable' as const,
		};
	}

	const currentSnapshot = {
		keys: await params.listCurrentKeys(),
		connections: await params.listCurrentConnections(),
	};
	if (
		matchesSnapshot(currentSnapshot, state.previous) ||
		matchesSnapshot(currentSnapshot, state.target)
	) {
		try {
			await finalizeRestoreJournal({
				restoreJournal: params.restoreJournal,
				context: 'confirming current state before replay',
			});
		} catch (finalizeError) {
			throw finalizeError;
		}
		return {
			restored: false as const,
		};
	}

	const payload =
		state.recoveryTarget === 'previous' ? state.previous : state.target;
	const result = await applyRestoreSnapshot({
		payload,
		replaceAllKeys: params.replaceAllKeys,
		replaceAllConnections: params.replaceAllConnections,
	});
	try {
		await finalizeRestoreJournal({
			restoreJournal: params.restoreJournal,
			context: `recovering to ${state.recoveryTarget} snapshot`,
		});
	} catch (finalizeError) {
		throw finalizeError;
	}
	return {
		restored: true as const,
		recoveredTo: state.recoveryTarget,
		...result,
	};
}
