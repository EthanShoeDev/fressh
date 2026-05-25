import {
	createAgentNotificationRouteIdentityKey,
	type AgentNotificationRouteIdentity,
	type AgentNotificationRouteToken,
} from './agent-notification-route-identity';

type AgentNotificationRouteRecord = AgentNotificationRouteToken & {
	createdAtMs: number;
};

export type AgentNotificationRouteStorage = {
	getString: (key: string) => string | undefined;
	set: (key: string, value: string) => void;
	delete: (key: string) => void;
	getAllKeys: () => string[];
};

export type AgentNotificationRouteTokenStoreDependencies = {
	storage: AgentNotificationRouteStorage;
	createToken: () => string;
	getNowMs?: () => number;
};

const tokenPrefix = 'token:';
const consumedTokenPrefix = 'consumed-token:';
const routePrefix = 'route:';
export const AGENT_NOTIFICATION_ROUTE_TOKEN_TTL_MS =
	24 * 60 * 60 * 1_000;

function tokenKey(tapToken: string) {
	return `${tokenPrefix}${tapToken}`;
}

function consumedTokenKey(tapToken: string) {
	return `${consumedTokenPrefix}${tapToken}`;
}

function routeKey(input: AgentNotificationRouteIdentity) {
	return `${routePrefix}${createAgentNotificationRouteIdentityKey(input)}`;
}

function parseJsonRecord(
	raw: string | undefined,
): Partial<AgentNotificationRouteRecord> | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as Partial<AgentNotificationRouteRecord>;
	} catch {
		return null;
	}
}

function parseTokenFields(
	parsed: Partial<AgentNotificationRouteToken> | null,
): AgentNotificationRouteToken | null {
	if (
		!parsed ||
		typeof parsed.connectionId !== 'string' ||
		typeof parsed.session !== 'string' ||
		typeof parsed.windowId !== 'string' ||
		typeof parsed.eventId !== 'string' ||
		typeof parsed.tapToken !== 'string'
	) {
		return null;
	}
	return {
		connectionId: parsed.connectionId,
		session: parsed.session,
		windowId: parsed.windowId,
		eventId: parsed.eventId,
		tapToken: parsed.tapToken,
	};
}

function parseRecord(raw: string | undefined): AgentNotificationRouteRecord | null {
	const parsed = parseJsonRecord(raw);
	const token = parseTokenFields(parsed);
	if (
		!token ||
		typeof parsed?.createdAtMs !== 'number' ||
		!Number.isSafeInteger(parsed.createdAtMs) ||
		parsed.createdAtMs < 0
	) {
		return null;
	}
	return {
		...token,
		createdAtMs: parsed.createdAtMs,
	};
}

function parseLegacyRecordForCleanup(
	raw: string | undefined,
): AgentNotificationRouteToken | null {
	return parseTokenFields(parseJsonRecord(raw));
}

function matchesIdentity(
	record: AgentNotificationRouteIdentity,
	input: AgentNotificationRouteIdentity,
) {
	return (
		record.connectionId === input.connectionId &&
		record.session === input.session &&
		record.windowId === input.windowId &&
		record.eventId === input.eventId
	);
}

function deleteRouteKeyIfMatching(
	storage: AgentNotificationRouteStorage,
	record: AgentNotificationRouteRecord,
) {
	const key = routeKey(record);
	if (storage.getString(key) === record.tapToken) {
		storage.delete(key);
	}
}

function isExpired(record: AgentNotificationRouteRecord, nowMs: number) {
	return nowMs - record.createdAtMs >= AGENT_NOTIFICATION_ROUTE_TOKEN_TTL_MS;
}

function deleteRecord(
	storage: AgentNotificationRouteStorage,
	record: AgentNotificationRouteRecord,
) {
	storage.delete(tokenKey(record.tapToken));
	storage.delete(consumedTokenKey(record.tapToken));
	deleteRouteKeyIfMatching(storage, record);
}

function deleteRecordBestEffort(
	storage: AgentNotificationRouteStorage,
	record: AgentNotificationRouteRecord,
) {
	try {
		deleteRecord(storage, record);
	} catch {
		// Token authorization must fail closed even if stale cleanup fails.
	}
}

function writeRecord(
	storage: AgentNotificationRouteStorage,
	record: AgentNotificationRouteRecord,
) {
	storage.set(tokenKey(record.tapToken), JSON.stringify(record));
}

function pruneExpired(storage: AgentNotificationRouteStorage, nowMs: number) {
	let keys: string[];
	try {
		keys = storage.getAllKeys();
	} catch {
		return;
	}
	for (const key of keys) {
		if (!key.startsWith(tokenPrefix)) continue;
		try {
			const record = parseRecord(storage.getString(key));
			if (!record || isExpired(record, nowMs)) {
				storage.delete(key);
				if (record) deleteRouteKeyIfMatching(storage, record);
			}
		} catch {
			// Cleanup must never block creating the current notification token.
		}
	}
	for (const key of keys) {
		if (!key.startsWith(consumedTokenPrefix)) continue;
		try {
			const record = parseRecord(storage.getString(key));
			if (!record || isExpired(record, nowMs)) {
				storage.delete(key);
			}
		} catch {
			// Cleanup must never block creating the current notification token.
		}
	}
	try {
		keys = storage.getAllKeys();
	} catch {
		return;
	}
	for (const key of keys) {
		if (!key.startsWith(routePrefix)) continue;
		try {
			const tapToken = storage.getString(key);
			if (!tapToken) {
				storage.delete(key);
				continue;
			}
			if (!parseRecord(storage.getString(tokenKey(tapToken)))) {
				storage.delete(key);
			}
		} catch {
			// Cleanup must never block creating the current notification token.
		}
	}
}

export function createAgentNotificationRouteTokenStore({
	storage,
	createToken,
	getNowMs = () => Date.now(),
}: AgentNotificationRouteTokenStoreDependencies) {
	return {
		create(input: AgentNotificationRouteIdentity) {
			const nowMs = getNowMs();
			pruneExpired(storage, nowMs);
			const key = routeKey(input);
			const existingToken = storage.getString(key);
			const tapToken = createToken();
			// Native Android posts can surface late with their original token, so
			// superseded tokens stay valid until TTL cleanup or acknowledgement.
			const record: AgentNotificationRouteRecord = {
				...input,
				tapToken,
				createdAtMs: nowMs,
			};
			try {
				storage.set(key, tapToken);
				writeRecord(storage, record);
			} catch (error) {
				try {
					if (existingToken) {
						storage.set(key, existingToken);
					} else {
						storage.delete(key);
					}
				} catch {
					// Best effort rollback: preserve the original failure.
				}
				throw error;
			}
			return tapToken;
		},

		has(input: AgentNotificationRouteToken) {
			const nowMs = getNowMs();
			const rawRecord = storage.getString(tokenKey(input.tapToken));
			const record = parseRecord(rawRecord);
			if (!record) {
				const invalidRecord = parseLegacyRecordForCleanup(rawRecord);
				if (invalidRecord && matchesIdentity(invalidRecord, input)) {
					deleteRecordBestEffort(storage, { ...invalidRecord, createdAtMs: 0 });
				}
				return false;
			}
			if (record && isExpired(record, nowMs)) {
				deleteRecordBestEffort(storage, record);
				return false;
			}
			return !!record && matchesIdentity(record, input);
		},

		consume(input: AgentNotificationRouteToken) {
			const nowMs = getNowMs();
			const rawRecord = storage.getString(tokenKey(input.tapToken));
			const record = parseRecord(rawRecord);
			if (!record) {
				const invalidRecord = parseLegacyRecordForCleanup(rawRecord);
				if (invalidRecord && matchesIdentity(invalidRecord, input)) {
					deleteRecordBestEffort(storage, { ...invalidRecord, createdAtMs: 0 });
				}
				return false;
			}
			if (isExpired(record, nowMs)) {
				deleteRecordBestEffort(storage, record);
				return false;
			}
			if (!matchesIdentity(record, input)) return false;
			try {
				storage.set(consumedTokenKey(record.tapToken), JSON.stringify(record));
				storage.delete(tokenKey(record.tapToken));
				deleteRouteKeyIfMatching(storage, record);
				return true;
			} catch {
				return false;
			}
		},

		restore(input: AgentNotificationRouteToken) {
			const key = routeKey(input);
			const consumedRecord = parseRecord(
				storage.getString(consumedTokenKey(input.tapToken)),
			);
			if (!consumedRecord) return false;
			if (isExpired(consumedRecord, getNowMs())) {
				deleteRecordBestEffort(storage, consumedRecord);
				return false;
			}
			if (!matchesIdentity(consumedRecord, input)) return false;
			if (storage.getString(key)) return false;
			if (storage.getString(tokenKey(input.tapToken))) return false;
			try {
				storage.set(key, input.tapToken);
				writeRecord(storage, consumedRecord);
				storage.delete(consumedTokenKey(input.tapToken));
				return true;
			} catch (error) {
				try {
					if (storage.getString(key) === input.tapToken) {
						storage.delete(key);
					}
					storage.delete(tokenKey(input.tapToken));
				} catch {
					// Best effort rollback: preserve the original failure.
				}
				throw error;
			}
		},

		delete(input: AgentNotificationRouteIdentity & { tapToken?: string }) {
			const key = routeKey(input);
			const tapToken = input.tapToken ?? storage.getString(key);
			if (tapToken) {
				storage.delete(tokenKey(tapToken));
				storage.delete(consumedTokenKey(tapToken));
			}
			if (!input.tapToken || storage.getString(key) === input.tapToken) {
				storage.delete(key);
			}
		},

		deleteMatching(input: {
			connectionId: string;
			session: string;
			windowId: string;
		}) {
			for (const key of storage.getAllKeys()) {
				if (
					!key.startsWith(tokenPrefix) &&
					!key.startsWith(consumedTokenPrefix)
				) {
					continue;
				}
				const record = parseRecord(storage.getString(key));
				if (
					!record ||
					record.connectionId !== input.connectionId ||
					record.session !== input.session ||
					record.windowId !== input.windowId
				) {
					continue;
				}
				deleteRecord(storage, record);
			}
		},

		clear() {
			for (const key of storage.getAllKeys()) {
				if (
					key.startsWith(tokenPrefix) ||
					key.startsWith(consumedTokenPrefix) ||
					key.startsWith(routePrefix)
				) {
					storage.delete(key);
				}
			}
		},
	};
}
