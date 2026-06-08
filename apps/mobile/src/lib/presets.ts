import { useMemo } from 'react';
import { preferences } from './preferences';

/**
 * Preset commands — labeled one-tap commands the user runs from the terminal
 * toolbar (and, later, the "Run" tab). Stored as a JSON array in the
 * `presetCommands` string pref; this module is the typed CRUD layer over it.
 *
 * See docs/projects/future/preset-command-buttons.md.
 */
export interface Preset {
	id: string;
	/** Button text, e.g. "git status". */
	label: string;
	/** The command line to send, e.g. "git status -sb". */
	command: string;
	/** Send a trailing Enter so it runs immediately. Off ⇒ insert only (the user
	 *  edits, then submits). Default true. */
	autoRun: boolean;
}

/** Tolerant parse: drop anything that isn't a well-formed preset. */
function parse(json: string): Preset[] {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.flatMap((entry): Preset[] => {
		if (
			entry &&
			typeof entry === 'object' &&
			typeof (entry as Preset).id === 'string' &&
			typeof (entry as Preset).label === 'string' &&
			typeof (entry as Preset).command === 'string'
		) {
			const e = entry as Preset;
			return [
				{
					id: e.id,
					label: e.label,
					command: e.command,
					autoRun: e.autoRun !== false,
				},
			];
		}
		return [];
	});
}

function save(list: Preset[]) {
	preferences.presetCommands.set(JSON.stringify(list));
}

/** Read presets imperatively (outside React). Module-local for now; export when
 *  the "Run" tab needs a non-React read. */
function getPresets(): Preset[] {
	return parse(preferences.presetCommands.get());
}

/** Reactive list of presets (re-renders when the pref changes). */
export function usePresets(): Preset[] {
	const [raw] = preferences.presetCommands.useValue();
	return useMemo(() => parse(raw), [raw]);
}

function genId(): string {
	return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
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
