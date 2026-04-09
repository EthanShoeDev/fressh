# Security Center Restore Hardening Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the remaining restore-journal consistency holes and the key-picker loading regression so Security Center restore is safe across interruption and the connection form never retargets a valid key during async load.

**Architecture:** Keep restore orchestration in `security-center-flow.ts`, but change recovery from a blind “pending journal means replay” model to a snapshot-aware journal model that can detect stale journals, tolerate transition failures, and clear corrupt state safely. Keep key selection local to the connection form, but distinguish “keys still loading” from “keys loaded empty” so the form only corrects stale ids after query resolution.

**Tech Stack:** Expo React Native, TypeScript, TanStack Query/Form, Expo SecureStore, MMKV, `node:test` integration tests, ESLint, `tsc`

---

## File Structure

- `apps/mobile/src/lib/key-picker-state.ts`
  Responsibility: pure key-selection helper that understands loading vs loaded states.
- `apps/mobile/src/app/(tabs)/index.tsx`
  Responsibility: form-level synchronization between key query state and `security.keyId`.
- `apps/mobile/src/lib/security-center-flow.ts`
  Responsibility: restore journal state machine, stale-journal detection, restore/recovery orchestration.
- `apps/mobile/src/lib/device-migration.ts`
  Responsibility: reusable semantic validation for backup-shaped payloads, shared by import/export and restore journals.
- `apps/mobile/src/lib/secrets-manager.ts`
  Responsibility: persisted restore-journal adapter and startup recovery wiring.
- `apps/mobile/test/integration/key-picker-state.test.ts`
  Responsibility: key-selection edge cases, especially async loading behavior.
- `apps/mobile/test/integration/security-center-flow.test.ts`
  Responsibility: restore journal failure modes, stale journal replay protection, recovery behavior.
- `apps/mobile/test/integration/device-migration.test.ts`
  Responsibility: semantic payload validation coverage reused by journals and import/export.

### Task 1: Fix Key Picker Loading Regression

**Files:**
- Modify: `apps/mobile/src/lib/key-picker-state.ts`
- Modify: `apps/mobile/src/app/(tabs)/index.tsx`
- Test: `apps/mobile/test/integration/key-picker-state.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
void test('getInitialSelectedKeyId preserves the current value while keys are still loading', () => {
	assert.equal(
		getInitialSelectedKeyId({
			keys: undefined,
			currentValue: 'key_1',
			hasLoadedKeys: false,
		}),
		'key_1',
	);
});

void test('getInitialSelectedKeyId clears a stale value only after keys have loaded empty', () => {
	assert.equal(
		getInitialSelectedKeyId({
			keys: [],
			currentValue: 'missing_key',
			hasLoadedKeys: true,
		}),
		'',
	);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fressh/mobile exec tsx --test test/integration/key-picker-state.test.ts`
Expected: FAIL because `getInitialSelectedKeyId()` does not yet accept an optional keys list plus explicit loading state, and the old behavior clears valid values before the query resolves.

- [ ] **Step 3: Write the minimal implementation**

In `apps/mobile/src/lib/key-picker-state.ts`, change the helper signature from positional arguments to an object that carries loading state:

```ts
export function getInitialSelectedKeyId(params: {
	keys?: { id: string; metadata: { isDefault?: boolean } }[];
	currentValue: string;
	hasLoadedKeys: boolean;
}) {
	if (!params.hasLoadedKeys) return params.currentValue;

	const keys = params.keys ?? [];
	if (params.currentValue && keys.some((key) => key.id === params.currentValue)) {
		return params.currentValue;
	}

	return keys.find((key) => key.metadata.isDefault)?.id ?? keys[0]?.id ?? '';
}
```

In `apps/mobile/src/app/(tabs)/index.tsx`, stop collapsing “loading” into `[]`, and only auto-correct after the query resolves:

```ts
const listPrivateKeysQuery = useQuery(secretsManager.keys.query.list);
const keys = listPrivateKeysQuery.data;
const computedSelectedId = getInitialSelectedKeyId({
	keys,
	currentValue: fieldValue,
	hasLoadedKeys: listPrivateKeysQuery.status === 'success',
});

React.useEffect(() => {
	if (listPrivateKeysQuery.status !== 'success') return;
	if (fieldValue === computedSelectedId) return;
	fieldHandleChange(computedSelectedId);
}, [
	computedSelectedId,
	fieldHandleChange,
	fieldValue,
	listPrivateKeysQuery.status,
]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @fressh/mobile exec tsx --test test/integration/key-picker-state.test.ts`
Expected: PASS with the new loading-safe behavior and the existing stale-id tests still green.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/mobile/src/lib/key-picker-state.ts \
  'apps/mobile/src/app/(tabs)/index.tsx' \
  apps/mobile/test/integration/key-picker-state.test.ts
git commit -m "fix(mobile): preserve key selection while keys load"
```

### Task 2: Make Restore Recovery Snapshot-Aware and Non-Destructive

**Files:**
- Modify: `apps/mobile/src/lib/security-center-flow.ts`
- Test: `apps/mobile/test/integration/security-center-flow.test.ts`

- [ ] **Step 1: Write the failing tests**

Add three red tests in `apps/mobile/test/integration/security-center-flow.test.ts`:

```ts
const previousSnapshot: BackupPayload = {
	version: 1,
	createdAt: '2026-04-09T00:00:00.000Z',
	keys: [
		{
			id: 'key_stale',
			metadata: {
				priority: 0,
				createdAtMs: 9,
				label: 'Stale key',
				isDefault: false,
			},
			value: 'STALE KEY',
		},
	],
	connections: [
		{
			id: 'muly-stale-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 10,
				modifiedAtMs: 11,
				label: 'Stale Box',
			},
			value: {
				host: 'stale-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_stale',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	],
};

void test('restoreBackupPayload still rolls back when saving the rollback target fails', async () => {
	let currentKeys = previousSnapshot.keys;
	let currentConnections = previousSnapshot.connections;
	let saveCalls = 0;

	await assert.rejects(
		() =>
			restoreBackupPayload({
				payload: backupPayload,
				listCurrentKeys: async () => currentKeys,
				listCurrentConnections: async () => currentConnections,
				restoreJournal: {
					load: async () => null,
					save: async () => {
						saveCalls += 1;
						if (saveCalls === 2) throw new Error('journal save failed');
					},
					clear: async () => {},
				},
				replaceAllKeys: async (entries) => {
					currentKeys = entries;
				},
				replaceAllConnections: async () => {
					throw new Error('connection replace failed');
				},
			}),
		/connection replace failed/,
	);

	assert.deepEqual(currentKeys, previousSnapshot.keys);
	assert.deepEqual(currentConnections, previousSnapshot.connections);
});

void test('recoverPendingRestore clears a stale journal when current state already matches previous', async () => {
	const journal = createMemoryRestoreJournal({
		recoveryTarget: 'target',
		previous: previousSnapshot,
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => previousSnapshot.keys,
		listCurrentConnections: async () => previousSnapshot.connections,
		replaceAllKeys: async () => {
			throw new Error('should not replay');
		},
		replaceAllConnections: async () => {
			throw new Error('should not replay');
		},
	});

	assert.deepEqual(result, { restored: false, clearedStaleJournal: true });
	assert.equal(journal.getSnapshot(), null);
});

void test('recoverPendingRestore clears a stale journal when current state already matches target', async () => {
	const journal = createMemoryRestoreJournal({
		recoveryTarget: 'previous',
		previous: previousSnapshot,
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => backupPayload.keys,
		listCurrentConnections: async () => backupPayload.connections,
		replaceAllKeys: async () => {
			throw new Error('should not replay');
		},
		replaceAllConnections: async () => {
			throw new Error('should not replay');
		},
	});

	assert.deepEqual(result, { restored: false, clearedStaleJournal: true });
	assert.equal(journal.getSnapshot(), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fressh/mobile exec tsx --test test/integration/security-center-flow.test.ts`
Expected: FAIL because recovery currently replays any non-null journal blindly and still blocks rollback on intermediate journal-save failures.

- [ ] **Step 3: Write the minimal implementation**

In `apps/mobile/src/lib/security-center-flow.ts`, change the journal model to carry an explicit recovery target and compare the live store snapshot before replay:

```ts
const restoreJournalStateSchema = z.object({
	recoveryTarget: z.enum(['target', 'previous']),
	previous: backupPayloadSchema,
	target: backupPayloadSchema,
});

function snapshotsMatch(
	left: Pick<BackupPayload, 'keys' | 'connections'>,
	right: Pick<BackupPayload, 'keys' | 'connections'>,
) {
	return JSON.stringify({
		keys: [...left.keys].sort((a, b) => a.id.localeCompare(b.id)),
		connections: [...left.connections].sort((a, b) => a.id.localeCompare(b.id)),
	}) ===
	JSON.stringify({
			keys: [...right.keys].sort((a, b) => a.id.localeCompare(b.id)),
			connections: [...right.connections].sort((a, b) => a.id.localeCompare(b.id)),
		});
}
```

Update `restoreBackupPayload()` so journal transition failures are captured but do not stop rollback/reapply:

```ts
let transitionError: Error | null = null;
await params.restoreJournal?.save({
	recoveryTarget: 'target',
	previous: previousSnapshot,
	target: params.payload,
});

try {
	return await applyRestoreSnapshot({
		payload: params.payload,
		replaceAllKeys: params.replaceAllKeys,
		replaceAllConnections: params.replaceAllConnections,
	});
} catch (error) {
	await params.restoreJournal?.save({
		recoveryTarget: 'previous',
		previous: previousSnapshot,
		target: params.payload,
	}).catch((journalError) => {
		transitionError = journalError as Error;
	});

	try {
		await applyRestoreSnapshot({
			payload: previousSnapshot,
			replaceAllKeys: params.replaceAllKeys,
			replaceAllConnections: params.replaceAllConnections,
		});
	} catch (rollbackError) {
		const reapplied = await applyRestoreSnapshot({
			payload: params.payload,
			replaceAllKeys: params.replaceAllKeys,
			replaceAllConnections: params.replaceAllConnections,
		});

		return {
			...reapplied,
			recoveredConsistency: true as const,
		};
	}

	if (transitionError) {
		throw new Error(`Restore failed after journal transition failure: ${transitionError.message}`, {
			cause: error,
		});
	}

	throw error;
}
```

Update `recoverPendingRestore()` so it inspects the current store before replay:

```ts
export async function recoverPendingRestore(params: {
	restoreJournal: RestoreJournalStorage;
	listCurrentKeys: () => Promise<BackupKeyEntry[]>;
	listCurrentConnections: () => Promise<StoredConnectionEntry[]>;
	replaceAllKeys: (entries: BackupKeyEntry[]) => Promise<void>;
	replaceAllConnections: (entries: StoredConnectionEntry[]) => Promise<void>;
}) {
	const { state } = await loadRestoreJournalState(params.restoreJournal);
	if (!state) return { restored: false as const };

	const currentSnapshot = createSnapshot({
		keys: await params.listCurrentKeys(),
		connections: await params.listCurrentConnections(),
	});

	if (
		snapshotsMatch(currentSnapshot, state.previous) ||
		snapshotsMatch(currentSnapshot, state.target)
	) {
		await finalizeRestoreJournal(params.restoreJournal);
		return { restored: false as const, clearedStaleJournal: true as const };
	}

	const payload =
		state.recoveryTarget === 'previous' ? state.previous : state.target;
	// existing apply path continues here
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @fressh/mobile exec tsx --test test/integration/security-center-flow.test.ts`
Expected: PASS with rollback no longer blocked by journal transition failures and stale journals no longer replaying over matching state.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/mobile/src/lib/security-center-flow.ts \
  apps/mobile/test/integration/security-center-flow.test.ts
git commit -m "fix(mobile): harden restore journal replay"
```

### Task 3: Harden Journal Load/Clear and Reuse Semantic Payload Validation

**Files:**
- Modify: `apps/mobile/src/lib/device-migration.ts`
- Modify: `apps/mobile/src/lib/security-center-flow.ts`
- Modify: `apps/mobile/src/lib/secrets-manager.ts`
- Test: `apps/mobile/test/integration/device-migration.test.ts`
- Test: `apps/mobile/test/integration/security-center-flow.test.ts`

- [ ] **Step 1: Write the failing tests**

Add semantic journal-validation and corrupt-load tests:

```ts
void test('recoverPendingRestore clears an invalid journal payload instead of throwing', async () => {
	const cleared: boolean[] = [];
	const result = await recoverPendingRestore({
		restoreJournal: {
			load: async () => ({
				recoveryTarget: 'previous',
				previous: {
					version: 1,
					createdAt: '2026-04-09T00:00:00.000Z',
					keys: [
						keyEntry,
						{ ...keyEntry, id: 'key_2', metadata: { ...keyEntry.metadata, isDefault: true } },
					],
					connections: [],
				},
				target: backupPayload,
			}),
			save: async () => {},
			clear: async () => {
				cleared.push(true);
			},
		},
		listCurrentKeys: async () => [],
		listCurrentConnections: async () => [],
		replaceAllKeys: async () => {
			throw new Error('should not replay invalid journal');
		},
		replaceAllConnections: async () => {
			throw new Error('should not replay invalid journal');
		},
	});

	assert.deepEqual(result, { restored: false, clearedInvalidJournal: true });
	assert.deepEqual(cleared, [true]);
});
```

In `apps/mobile/test/integration/device-migration.test.ts`, add coverage for the reusable validator:

```ts
void test('validateBackupPayload rejects multiple default keys', () => {
	assert.throws(() => validateBackupPayload({
		version: 1,
		createdAt: '2026-04-09T00:00:00.000Z',
		keys: [
			keyEntry,
			{ ...keyEntry, id: 'key_2', metadata: { ...keyEntry.metadata, isDefault: true } },
		],
		connections: [],
	}), /Backup must contain at most one default private key/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @fressh/mobile exec tsx --test test/integration/device-migration.test.ts test/integration/security-center-flow.test.ts`
Expected: FAIL because semantic validation is private, invalid journals still throw, and journal clear/load failures are still swallowed or propagated incorrectly.

- [ ] **Step 3: Write the minimal implementation**

In `apps/mobile/src/lib/device-migration.ts`, export the semantic validator instead of keeping it private:

```ts
export function validateBackupPayload(payload: BackupPayload) {
	assertUniqueBackupEntries(payload);
	assertSingleDefaultKey(payload);
	assertBackupReferencesExist(payload);
	return payload;
}
```

Use it in both `createBackupPayload()` and `parseBackupPayload()`:

```ts
const payload = validateBackupPayload({
	version: 1,
	createdAt: params.createdAt ?? new Date().toISOString(),
	keys: await params.listKeys(),
	connections: await params.listConnections(),
});
```

In `apps/mobile/src/lib/security-center-flow.ts`, centralize safe journal loading and clearing:

```ts
async function loadRestoreJournalState(
	restoreJournal: RestoreJournalStorage,
) {
	let rawState: unknown;
	try {
		rawState = await restoreJournal.load();
	} catch {
		await restoreJournal.clear().catch(() => {});
		return { state: null, clearedInvalidJournal: true as const };
	}

	if (!rawState) return { state: null, clearedInvalidJournal: false as const };

	try {
		const state = restoreJournalStateSchema.parse(rawState);
		validateBackupPayload(state.previous);
		validateBackupPayload(state.target);
		return { state, clearedInvalidJournal: false as const };
	} catch {
		await restoreJournal.clear().catch(() => {});
		return { state: null, clearedInvalidJournal: true as const };
	}
}
```

Make `finalizeRestoreJournal()` return success/failure instead of swallowing:

```ts
async function finalizeRestoreJournal(restoreJournal?: RestoreJournalStorage) {
	if (!restoreJournal) return { cleared: true as const };

	try {
		await restoreJournal.clear();
		return { cleared: true as const };
	} catch (error) {
		return { cleared: false as const, error };
	}
}
```

Then update `restoreBackupPayload()` / `recoverPendingRestore()` to:
- include `listCurrentKeys` and `listCurrentConnections` everywhere recovery is called,
- propagate `clearedInvalidJournal` / `clearedStaleJournal` in their return values,
- throw if a live restore succeeds but the journal cannot be finalized, because that is now a real persistence failure instead of a swallowed one.

In `apps/mobile/src/lib/secrets-manager.ts`, make the adapter clear invalid persisted journal entries instead of throwing them through startup:

```ts
load: async () => {
	try {
		const entry = await restoreJournalStore.getEntry('pending');
		return JSON.parse(entry.value) as unknown;
	} catch (error) {
		if (error instanceof Error && error.message === 'Entry not found') {
			return null;
		}

		logger.warn('Clearing invalid restore journal', { error: String(error) });
		await restoreJournalStore.deleteEntry('pending').catch(() => {});
		return null;
	}
},
```

Also pass the current-store readers into startup recovery:

```ts
const recovery = await recoverPendingRestore({
	restoreJournal,
	listCurrentKeys: betterKeyStorage.listEntriesWithValues,
	listCurrentConnections: connectionStorage.listEntriesWithValues,
	replaceAllKeys: replaceAllPrivateKeyEntries,
	replaceAllConnections,
});
```

- [ ] **Step 4: Run the verification suite**

Run: `pnpm --filter @fressh/mobile exec tsx --test test/integration/device-migration.test.ts test/integration/security-center-flow.test.ts`
Expected: PASS

Run: `pnpm --filter @fressh/mobile test:integration`
Expected: PASS

Run: `pnpm --filter @fressh/mobile exec tsc --noEmit`
Expected: PASS

Run: `pnpm --filter @fressh/mobile exec eslint 'src/lib/security-center-flow.ts' 'src/lib/device-migration.ts' 'src/lib/secrets-manager.ts' 'src/lib/key-picker-state.ts' 'src/app/(tabs)/index.tsx' 'test/integration/security-center-flow.test.ts' 'test/integration/device-migration.test.ts' 'test/integration/key-picker-state.test.ts'`
Expected: PASS with no warnings on the touched files.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/mobile/src/lib/device-migration.ts \
  apps/mobile/src/lib/security-center-flow.ts \
  apps/mobile/src/lib/secrets-manager.ts \
  apps/mobile/test/integration/device-migration.test.ts \
  apps/mobile/test/integration/security-center-flow.test.ts
git commit -m "fix(mobile): harden restore journal consistency"
```

## Self-Review

- Spec coverage: the plan covers all accepted findings from the last review round: picker loading regression, journal transition failure, stale replay after failed clear, corrupt journal handling, and semantic validation of replayed snapshots.
- Placeholder scan: no placeholder phrases remain; each task names exact files, commands, and code snippets.
- Type consistency: the plan consistently uses `recoveryTarget`, `validateBackupPayload`, `clearedStaleJournal`, and `clearedInvalidJournal` across tests and implementation steps.
