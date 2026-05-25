# Tmux Skill Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile keyboard `$` key with a tmux-aware skill selector that discovers repo-local `.codex/skills` entries and inserts `$skill-name ` without pressing Enter.

**Architecture:** Keep skill discovery pure in `apps/mobile/src/lib/skill-discovery.ts`. Wire the keyboard through a first-class `OPEN_SKILL_SELECTOR` action that is invoked by a configurable `skill_selector` macro. Add a small shell modal that owns filtering UI while shell detail owns tmux cwd resolution, side-channel execution, and terminal insertion.

**Tech Stack:** Expo React Native, TypeScript, Node `node:test` integration tests through `tsx`, existing shell config JSON, existing side-channel SSH command helper.

---

## File Structure

- Create `apps/mobile/src/lib/skill-discovery.ts`: pure helpers for remote command construction, JSON parsing, frontmatter extraction, and filtering.
- Create `apps/mobile/test/integration/skill-discovery.test.ts`: integration tests for discovery parsing, fallback names, filtering, empty output, and command scope.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`: add `OPEN_SKILL_SELECTOR` as a known action and expose an `openSkillSelector` callback in `ActionContext`.
- Modify `apps/mobile/config/shell-config.json`: replace the raw `$` text key with a `skill_selector` macro slot and add the macro script.
- Modify `apps/mobile/test/integration/keyboard-config.test.ts`: assert the raw `$` text key is gone and the new macro is wired on `phone_base`.
- Modify `apps/mobile/test/integration/shell-config-schema.test.ts`: assert `OPEN_SKILL_SELECTOR` is an accepted action ID.
- Create `apps/mobile/src/app/shell/components/SkillSelectorModal.tsx`: mobile modal for filter text, loading, error, empty, retry, cancel, and selection.
- Modify `apps/mobile/src/app/shell/detail.tsx`: open the modal from the keyboard action, discover skills on each open, and insert the selected skill trigger.

## Task 1: Skill Discovery Helpers

**Files:**
- Create: `apps/mobile/src/lib/skill-discovery.ts`
- Create: `apps/mobile/test/integration/skill-discovery.test.ts`

- [ ] **Step 1: Write the failing skill discovery tests**

Create `apps/mobile/test/integration/skill-discovery.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildSkillDiscoveryCommand,
	filterDiscoveredSkills,
	parseSkillDiscoveryOutput,
} from '../../src/lib/skill-discovery';

const discoveryPayload = JSON.stringify([
	{
		path: '/repo/.codex/skills/brainstorming/SKILL.md',
		content:
			'---\nname: brainstorming\ndescription: Explore requirements before implementation.\n---\n\n# Brainstorming\n',
	},
	{
		path: '/repo/.codex/skills/expo-deployment/SKILL.md',
		content:
			'---\ndescription: Deploy Expo apps to stores and web.\n---\n\n# Deployment\n',
	},
	{
		path: '/repo/.codex/skills/quoted/SKILL.md',
		content:
			'---\nname: "quoted-skill"\ndescription: \"Quoted description\"\n---\n',
	},
	{
		path: '/repo/.codex/skills/broken/SKILL.md',
		content: 'not frontmatter',
	},
	{
		path: '/repo/.agents/skills/ignored/SKILL.md',
		content: '---\nname: ignored\n---\n',
	},
]);

void test('parseSkillDiscoveryOutput reads skill frontmatter and falls back to directory names', () => {
	assert.deepEqual(parseSkillDiscoveryOutput(discoveryPayload), [
		{
			name: 'brainstorming',
			path: '/repo/.codex/skills/brainstorming/SKILL.md',
			description: 'Explore requirements before implementation.',
		},
		{
			name: 'broken',
			path: '/repo/.codex/skills/broken/SKILL.md',
			description: null,
		},
		{
			name: 'expo-deployment',
			path: '/repo/.codex/skills/expo-deployment/SKILL.md',
			description: 'Deploy Expo apps to stores and web.',
		},
		{
			name: 'quoted-skill',
			path: '/repo/.codex/skills/quoted/SKILL.md',
			description: 'Quoted description',
		},
	]);
});

void test('parseSkillDiscoveryOutput treats empty and malformed command output as no skills', () => {
	assert.deepEqual(parseSkillDiscoveryOutput(''), []);
	assert.deepEqual(parseSkillDiscoveryOutput('not json'), []);
	assert.deepEqual(parseSkillDiscoveryOutput(JSON.stringify({ path: 'nope' })), []);
});

void test('filterDiscoveredSkills matches names and descriptions', () => {
	const skills = parseSkillDiscoveryOutput(discoveryPayload);

	assert.deepEqual(
		filterDiscoveredSkills(skills, 'expo').map((skill) => skill.name),
		['expo-deployment'],
	);
	assert.deepEqual(
		filterDiscoveredSkills(skills, 'requirements').map((skill) => skill.name),
		['brainstorming'],
	);
	assert.deepEqual(
		filterDiscoveredSkills(skills, '').map((skill) => skill.name),
		['brainstorming', 'broken', 'expo-deployment', 'quoted-skill'],
	);
});

void test('buildSkillDiscoveryCommand scopes discovery to repo-local codex skills', () => {
	const command = buildSkillDiscoveryCommand("/tmp/repo with ' quote");

	assert.match(command, /python3 -/);
	assert.match(command, /\.codex/);
	assert.match(command, /skills/);
	assert.match(command, /SKILL\.md/);
	assert.doesNotMatch(command, /\.agents/);
	assert.doesNotMatch(command, /plugins/);
	assert.match(command, /'\\/tmp\\/repo with '\\'' quote'/);
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/skill-discovery.test.ts
```

Expected: FAIL with an import error for `../../src/lib/skill-discovery`.

- [ ] **Step 3: Implement the skill discovery module**

Create `apps/mobile/src/lib/skill-discovery.ts`:

```ts
import { quoteShell } from '@/lib/host-browser-actions';

export type DiscoveredSkill = {
	name: string;
	path: string;
	description: string | null;
};

type RemoteSkillFile = {
	path: string;
	content: string;
};

function normalizePathSeparators(pathValue: string): string {
	return pathValue.replaceAll('\\', '/');
}

function skillDirectoryName(pathValue: string): string | null {
	const normalized = normalizePathSeparators(pathValue);
	const withoutFile = normalized.endsWith('/SKILL.md')
		? normalized.slice(0, -'/SKILL.md'.length)
		: normalized;
	const name = withoutFile.split('/').filter(Boolean).at(-1)?.trim();
	return name || null;
}

function isRepoLocalCodexSkill(pathValue: string): boolean {
	const normalized = normalizePathSeparators(pathValue);
	return (
		normalized.includes('/.codex/skills/') &&
		normalized.endsWith('/SKILL.md') &&
		!normalized.includes('/.codex/plugins/') &&
		!normalized.includes('/.agents/')
	);
}

function frontmatterBlock(content: string): string | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
	return match?.[1] ?? null;
}

function unquoteYamlScalar(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function frontmatterStringField(
	block: string | null,
	fieldName: 'name' | 'description',
): string | null {
	if (!block) return null;
	const fieldPattern = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
	const value = fieldPattern.exec(block)?.[1];
	if (!value) return null;
	const parsed = unquoteYamlScalar(value);
	return parsed || null;
}

function parseRemoteSkillFile(file: RemoteSkillFile): DiscoveredSkill | null {
	if (!isRepoLocalCodexSkill(file.path)) return null;
	const block = frontmatterBlock(file.content);
	const name = frontmatterStringField(block, 'name') ?? skillDirectoryName(file.path);
	if (!name) return null;
	return {
		name,
		path: file.path,
		description: frontmatterStringField(block, 'description'),
	};
}

function isRemoteSkillFile(value: unknown): value is RemoteSkillFile {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return typeof record.path === 'string' && typeof record.content === 'string';
}

export function parseSkillDiscoveryOutput(output: string): DiscoveredSkill[] {
	const trimmed = output.trim();
	if (!trimmed) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed
		.filter(isRemoteSkillFile)
		.map((file) => parseRemoteSkillFile(file))
		.filter((skill): skill is DiscoveredSkill => skill !== null)
		.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizedSearchText(value: string | null): string {
	return (value ?? '').trim().toLowerCase();
}

function scoreSkill(skill: DiscoveredSkill, query: string): number | null {
	const name = normalizedSearchText(skill.name);
	const description = normalizedSearchText(skill.description);
	if (name === query) return 0;
	if (name.startsWith(query)) return 1;
	if (name.includes(query)) return 2;
	if (description.startsWith(query)) return 3;
	if (description.includes(query)) return 4;
	return null;
}

export function filterDiscoveredSkills(
	skills: readonly DiscoveredSkill[],
	query: string,
): DiscoveredSkill[] {
	const normalizedQuery = normalizedSearchText(query);
	if (!normalizedQuery) return [...skills];
	return skills
		.map((skill) => ({ skill, score: scoreSkill(skill, normalizedQuery) }))
		.filter(
			(entry): entry is { skill: DiscoveredSkill; score: number } =>
				entry.score !== null,
		)
		.sort((left, right) => {
			if (left.score !== right.score) return left.score - right.score;
			return left.skill.name.localeCompare(right.skill.name);
		})
		.map((entry) => entry.skill);
}

export function buildSkillDiscoveryCommand(panePath: string): string {
	return `python3 - ${quoteShell(panePath)} <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]) / ".codex" / "skills"
records = []
if root.is_dir():
    for skill_file in sorted(root.glob("*/SKILL.md")):
        try:
            content = skill_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        records.append({"path": str(skill_file), "content": content})
print(json.dumps(records))
PY`;
}
```

- [ ] **Step 4: Run the skill discovery test to verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/skill-discovery.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit skill discovery helpers**

```bash
git add apps/mobile/src/lib/skill-discovery.ts apps/mobile/test/integration/skill-discovery.test.ts
git commit -m "Add mobile skill discovery helpers"
```

## Task 2: Keyboard Action And Config Wiring

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`
- Modify: `apps/mobile/test/integration/shell-config-schema.test.ts`

- [ ] **Step 1: Add failing keyboard config tests**

Append this test to `apps/mobile/test/integration/keyboard-config.test.ts`:

```ts
void test('phone base keyboard replaces raw dollar key with skill selector macro', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	const rawDollarSlots = phoneBaseKeyboard.grid.flatMap((row) =>
		row.filter((slot) => slot?.type === 'text' && slot.text === '$'),
	);
	assert.deepEqual(rawDollarSlots, []);

	const phoneBaseMacros = config.macrosByKeyboardId[phoneBaseKeyboard.id];
	assert.ok(phoneBaseMacros);
	assert.deepEqual(
		phoneBaseMacros.find((macro) => macro.id === 'skill_selector'),
		{
			id: 'skill_selector',
			name: 'Skill selector',
			label: '$',
			category: 'Commands',
			script:
				'{\n  "type": "action",\n  "actionId": "OPEN_SKILL_SELECTOR"\n}',
		},
	);

	assert.deepEqual(phoneBaseKeyboard.grid[1]?.[8], {
		type: 'macro',
		macroId: 'skill_selector',
		label: '$',
		icon: null,
	});
});
```

Append this test to `apps/mobile/test/integration/shell-config-schema.test.ts`:

```ts
void test('runtime shell config accepts open skill selector action ids', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<
		string,
		unknown
	>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'action',
		actionId: 'OPEN_SKILL_SELECTOR',
		label: '$',
		icon: null,
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	const parsed = parseShellConfigData(config);
	assert.equal(parsed.keyboards[0]?.grid[0]?.[0]?.type, 'action');
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-config.test.ts test/integration/shell-config-schema.test.ts
```

Expected: FAIL because the `$` text slot still exists and `OPEN_SKILL_SELECTOR` is not a known action.

- [ ] **Step 3: Add the action to keyboard action handling**

In `apps/mobile/src/lib/keyboard-actions.ts`, add `'OPEN_SKILL_SELECTOR'` to `KNOWN_ACTION_IDS` immediately after `'OPEN_COMMANDER'`:

```ts
	'OPEN_COMMANDER',
	'OPEN_SKILL_SELECTOR',
	'OPEN_WISPR_TEXT_EDITOR',
```

In the `ActionContext` type, add this callback after `openCommander?: () => void;`:

```ts
	openSkillSelector?: () => void;
```

In `runAction`, add this case after the `OPEN_COMMANDER` case:

```ts
		case 'OPEN_SKILL_SELECTOR': {
			context.openSkillSelector?.();
			return;
		}
```

- [ ] **Step 4: Replace the `$` key with a macro in shell config**

In `apps/mobile/config/shell-config.json`, update the metadata at the top:

```json
  "version": "2026-05-25.1",
  "updatedAt": "2026-05-25T00:00:00Z",
```

In `apps/mobile/config/shell-config.json`, replace the existing phone base second-row `$` text slot:

```json
          {
            "type": "text",
            "text": "$",
            "label": "$",
            "icon": null
          },
```

with:

```json
          {
            "type": "macro",
            "macroId": "skill_selector",
            "label": "$",
            "icon": null
          },
```

In `apps/mobile/config/shell-config.json`, add this macro to `macrosByKeyboardId.phone_base` before `cmd_code_review`:

```json
      {
        "id": "skill_selector",
        "name": "Skill selector",
        "label": "$",
        "category": "Commands",
        "script": "{\n  \"type\": \"action\",\n  \"actionId\": \"OPEN_SKILL_SELECTOR\"\n}"
      },
```

- [ ] **Step 5: Run targeted keyboard/config tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-config.test.ts test/integration/shell-config-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit keyboard action and config wiring**

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts apps/mobile/test/integration/shell-config-schema.test.ts
git commit -m "Wire keyboard skill selector action"
```

## Task 3: Skill Selector Modal

**Files:**
- Create: `apps/mobile/src/app/shell/components/SkillSelectorModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `apps/mobile/src/app/shell/components/SkillSelectorModal.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native';
import {
	filterDiscoveredSkills,
	type DiscoveredSkill,
} from '@/lib/skill-discovery';
import { useTheme } from '@/lib/theme';

export function SkillSelectorModal({
	open,
	bottomOffset,
	skills,
	isLoading,
	error,
	onClose,
	onRetry,
	onSelect,
}: {
	open: boolean;
	bottomOffset: number;
	skills: readonly DiscoveredSkill[];
	isLoading: boolean;
	error: string | null;
	onClose: () => void;
	onRetry: () => void;
	onSelect: (skill: DiscoveredSkill) => void;
}) {
	const theme = useTheme();
	const [query, setQuery] = useState('');
	const filteredSkills = useMemo(
		() => filterDiscoveredSkills(skills, query),
		[query, skills],
	);

	const handleClose = () => {
		setQuery('');
		onClose();
	};

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={handleClose}
		>
			<Pressable
				onPress={handleClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
				}}
			>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					style={{ flex: 1, justifyContent: 'flex-end' }}
				>
					<View
						onStartShouldSetResponder={() => true}
						style={{
							backgroundColor: theme.colors.background,
							borderTopLeftRadius: 16,
							padding: 16,
							borderColor: theme.colors.borderStrong,
							borderWidth: 1,
							maxHeight: '80%',
							width: '70%',
							maxWidth: 360,
							minWidth: 260,
							alignSelf: 'flex-end',
							marginRight: 8,
							marginBottom: bottomOffset,
						}}
					>
						<View
							style={{
								flexDirection: 'row',
								alignItems: 'center',
								justifyContent: 'space-between',
								marginBottom: 12,
							}}
						>
							<Text
								style={{
									color: theme.colors.textPrimary,
									fontSize: 18,
									fontWeight: '700',
								}}
							>
								Skills
							</Text>
							<Pressable
								onPress={handleClose}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
							</Pressable>
						</View>
						<TextInput
							value={query}
							onChangeText={setQuery}
							placeholder="Filter skills"
							placeholderTextColor={theme.colors.muted}
							autoCapitalize="none"
							autoCorrect={false}
							style={{
								color: theme.colors.textPrimary,
								backgroundColor: theme.colors.surface,
								borderColor: theme.colors.border,
								borderWidth: 1,
								borderRadius: 10,
								paddingHorizontal: 12,
								paddingVertical: 10,
								marginBottom: 12,
							}}
						/>
						{isLoading ? (
							<View
								style={{
									paddingVertical: 20,
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<ActivityIndicator color={theme.colors.primary} />
								<Text
									style={{
										color: theme.colors.textSecondary,
										marginTop: 10,
									}}
								>
									Loading skills...
								</Text>
							</View>
						) : error ? (
							<View>
								<Text
									style={{
										color: theme.colors.danger,
										marginBottom: 12,
									}}
								>
									{error}
								</Text>
								<Pressable
									onPress={onRetry}
									style={{
										alignSelf: 'flex-start',
										paddingHorizontal: 12,
										paddingVertical: 8,
										borderRadius: 8,
										backgroundColor: theme.colors.primary,
									}}
								>
									<Text style={{ color: '#fff', fontWeight: '700' }}>
										Retry
									</Text>
								</Pressable>
							</View>
						) : filteredSkills.length === 0 ? (
							<Text style={{ color: theme.colors.textSecondary }}>
								No repo-local skills found.
							</Text>
						) : (
							<ScrollView keyboardShouldPersistTaps="handled">
								{filteredSkills.map((skill) => (
									<Pressable
										key={`${skill.path}:${skill.name}`}
										onPress={() => {
											setQuery('');
											onSelect(skill);
										}}
										style={{
											paddingVertical: 12,
											paddingHorizontal: 12,
											borderRadius: 10,
											borderWidth: 1,
											borderColor: theme.colors.border,
											backgroundColor: theme.colors.surface,
											marginBottom: 8,
										}}
									>
										<Text
											style={{
												color: theme.colors.textPrimary,
												fontSize: 14,
												fontWeight: '700',
											}}
										>
											{`$${skill.name}`}
										</Text>
										{skill.description ? (
											<Text
												numberOfLines={2}
												style={{
													color: theme.colors.textSecondary,
													fontSize: 12,
													marginTop: 4,
												}}
											>
												{skill.description}
											</Text>
										) : null}
									</Pressable>
								))}
							</ScrollView>
						)}
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
```

- [ ] **Step 2: Run TypeScript to verify the new component compiles**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit the modal**

```bash
git add apps/mobile/src/app/shell/components/SkillSelectorModal.tsx
git commit -m "Add mobile skill selector modal"
```

## Task 4: Shell Detail Integration

**Files:**
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Add imports**

In `apps/mobile/src/app/shell/detail.tsx`, add `buildSkillDiscoveryCommand`, `parseSkillDiscoveryOutput`, and the type import:

```ts
import {
	buildSkillDiscoveryCommand,
	parseSkillDiscoveryOutput,
	type DiscoveredSkill,
} from '@/lib/skill-discovery';
```

Add the modal import near the other shell component imports:

```ts
import { SkillSelectorModal } from './components/SkillSelectorModal';
```

- [ ] **Step 2: Add selector state**

Inside the shell detail component, near the existing `commandPresetsOpen` and `commanderOpen` state, add:

```ts
	const [skillSelectorOpen, setSkillSelectorOpen] = useState(false);
	const [skillSelectorSkills, setSkillSelectorSkills] = useState<
		DiscoveredSkill[]
	>([]);
	const [skillSelectorLoading, setSkillSelectorLoading] = useState(false);
	const [skillSelectorError, setSkillSelectorError] = useState<string | null>(
		null,
	);
	const skillSelectorRequestIdRef = useRef(0);
```

- [ ] **Step 3: Add discovery and selection callbacks**

Place these callbacks after `resolveHostBrowserPanePath`:

```ts
	const loadSkillSelectorSkills = useCallback(async () => {
		const requestId = skillSelectorRequestIdRef.current + 1;
		skillSelectorRequestIdRef.current = requestId;
		setSkillSelectorLoading(true);
		setSkillSelectorError(null);
		setSkillSelectorSkills([]);

		try {
			if (!connection) {
				throw new Error('No SSH connection available.');
			}
			if (!tmuxEnabled) {
				throw new Error('Skill selector requires a tmux-enabled connection.');
			}
			const panePath = await resolveHostBrowserPanePath();
			const output = await runHostBrowserCommand(
				buildSkillDiscoveryCommand(panePath),
				10_000,
			);
			const skills = parseSkillDiscoveryOutput(output);
			if (skillSelectorRequestIdRef.current === requestId) {
				setSkillSelectorSkills(skills);
			}
		} catch (error) {
			if (skillSelectorRequestIdRef.current === requestId) {
				setSkillSelectorError(getErrorMessage(error));
			}
		} finally {
			if (skillSelectorRequestIdRef.current === requestId) {
				setSkillSelectorLoading(false);
			}
		}
	}, [
		connection,
		resolveHostBrowserPanePath,
		runHostBrowserCommand,
		tmuxEnabled,
	]);

	const handleOpenSkillSelector = useCallback(() => {
		setCommandPresetsOpen(false);
		setCommanderOpen(false);
		handleCloseTextEntry();
		setSkillSelectorOpen(true);
		void loadSkillSelectorSkills();
	}, [handleCloseTextEntry, loadSkillSelectorSkills]);

	const handleCloseSkillSelector = useCallback(() => {
		skillSelectorRequestIdRef.current += 1;
		setSkillSelectorOpen(false);
		setSkillSelectorLoading(false);
		setSkillSelectorError(null);
		setSkillSelectorSkills([]);
	}, []);

	const handleSelectSkill = useCallback(
		(skill: DiscoveredSkill) => {
			sendTextRaw(`$${skill.name} `);
			handleCloseSkillSelector();
		},
		[handleCloseSkillSelector, sendTextRaw],
	);
```

- [ ] **Step 4: Add the action callback to `actionContext`**

In the `actionContext` object, add `openSkillSelector` after `openCommander`:

```ts
			openSkillSelector: handleOpenSkillSelector,
```

In the dependency list for that `useMemo`, add:

```ts
			handleOpenSkillSelector,
```

- [ ] **Step 5: Render the modal**

Render `SkillSelectorModal` after `TerminalCommanderModal` and before `TextEntryModal`:

```tsx
				<SkillSelectorModal
					open={skillSelectorOpen}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					skills={skillSelectorSkills}
					isLoading={skillSelectorLoading}
					error={skillSelectorError}
					onClose={handleCloseSkillSelector}
					onRetry={loadSkillSelectorSkills}
					onSelect={handleSelectSkill}
				/>
```

- [ ] **Step 6: Run TypeScript to verify shell integration**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit shell integration**

```bash
git add apps/mobile/src/app/shell/detail.tsx
git commit -m "Open skill selector from shell keyboard"
```

## Task 5: Full Verification

**Files:**
- Verify all files changed in Tasks 1-4.

- [ ] **Step 1: Run mobile integration tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS.

- [ ] **Step 2: Validate runtime shell config**

Run:

```bash
pnpm --filter @fressh/mobile validate:shell-config
```

Expected: PASS.

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 4: Run mobile lint check**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: PASS.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --stat HEAD~4..HEAD
git diff HEAD~4..HEAD -- apps/mobile/src/lib/skill-discovery.ts apps/mobile/src/lib/keyboard-actions.ts apps/mobile/src/app/shell/components/SkillSelectorModal.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/config/shell-config.json apps/mobile/test/integration/skill-discovery.test.ts apps/mobile/test/integration/keyboard-config.test.ts apps/mobile/test/integration/shell-config-schema.test.ts
```

Expected: The diff only contains skill selector discovery, keyboard wiring, modal integration, and matching tests.

## Manual Verification

- [ ] Connect to a tmux-enabled SSH session whose active pane cwd is a repo with `.codex/skills/<skill>/SKILL.md`.
- [ ] Press the mobile keyboard `$` key.
- [ ] Confirm the `Skills` selector opens and lists repo-local skills from the active pane cwd.
- [ ] Type a few characters from a skill name or description and confirm the list filters.
- [ ] Select a skill and confirm `$skill-name ` appears in the terminal input.
- [ ] Confirm Enter is not sent.
- [ ] Open a non-tmux connection, press the same key, and confirm the inline error says `Skill selector requires a tmux-enabled connection.`
- [ ] Open a tmux pane in a repo without `.codex/skills` and confirm the selector shows `No repo-local skills found.`

## Self-Review Notes

- Spec coverage: Task 1 covers repo-local discovery, frontmatter parsing, fallback names, filtering, no global/user/plugin scans, no cache, and empty output. Task 2 covers the first-class action and macro-backed `$` key. Task 3 covers the selector UI states and Retry. Task 4 covers tmux-only cwd resolution, side-channel execution, insertion of `$skill-name `, no Enter, and inline error messages. Task 5 covers verification.
- Placeholder scan: This plan contains no placeholder markers, no unresolved file paths, and no open-ended implementation steps.
- Type consistency: The shared skill type is `DiscoveredSkill`, the action ID is `OPEN_SKILL_SELECTOR`, the macro ID is `skill_selector`, and these names are used consistently across tests, config, keyboard actions, modal props, and shell integration.
