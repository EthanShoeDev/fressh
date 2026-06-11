import * as Crypto from 'expo-crypto';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { useMemo } from 'react';
import { preferences } from './preferences';

/**
 * Preset commands — labeled one-tap commands the user runs from the terminal
 * toolbar (and, later, the "Run" tab). Stored as a JSON array in the
 * `presetCommands` string pref; this module is the typed CRUD layer over it.
 *
 * See docs/projects/future/preset-command-buttons.md.
 */
const presetSchema = Schema.Struct({
	id: Schema.String,
	/** Button text, e.g. "git status". */
	label: Schema.String,
	/** The command line to send, e.g. "git status -sb". */
	command: Schema.String,
	/** Send a trailing Enter so it runs immediately. Off ⇒ insert only (the user
	 *  edits, then submits). Default true. */
	autoRun: Schema.Boolean.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(true)),
	),
});

export type Preset = Schema.Schema.Type<typeof presetSchema>;

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodePreset = Schema.decodeUnknownOption(presetSchema);
const encodePresets = Schema.encodeSync(
	Schema.fromJsonString(Schema.Array(presetSchema)),
);

/** Tolerant parse: drop anything that isn't a well-formed preset. */
function parse(json: string): Preset[] {
	const raw = decodeJson(json);
	if (Option.isNone(raw) || !Array.isArray(raw.value)) {
		return [];
	}
	return raw.value.flatMap((item) => {
		const preset = decodePreset(item);
		return Option.isSome(preset) ? [preset.value] : [];
	});
}

function save(list: Preset[]) {
	preferences.presetCommands.set(encodePresets(list));
}

/** Read presets imperatively (outside React). Exported for non-React readers
 *  (e.g. the screenshot seed's idempotency check). */
export function getPresets(): Preset[] {
	return parse(preferences.presetCommands.get());
}

/** Reactive list of presets (re-renders when the pref changes). */
export function usePresets(): Preset[] {
	const [raw] = preferences.presetCommands.useValue();
	return useMemo(() => parse(raw), [raw]);
}

function genId(): string {
	return `p_${Crypto.randomUUID()}`;
}

/** Add a new preset; returns its id. */
export function addPreset(input: Omit<Preset, 'id'>): string {
	const id = genId();
	save([...getPresets(), { ...input, id }]);
	return id;
}

/** Patch an existing preset by id (no-op if not found). */
export function updatePreset(
	id: string,
	patch: Partial<Omit<Preset, 'id'>>,
): void {
	save(getPresets().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

/** Delete a preset by id. */
export function deletePreset(id: string): void {
	save(getPresets().filter((p) => p.id !== id));
}
