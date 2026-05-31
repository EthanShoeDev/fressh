import * as z from 'zod';
import {
	CONFIG_SUPPORTED_ACTION_IDS,
	KEYBOARD_TARGET_ACTION_IDS,
	type ActionId,
	type KeyboardTargetActionId,
} from '@/lib/keyboard-actions';
import { parseMacroScript, type MacroStep } from '@/lib/macro-scripts';
import bundledShellConfigData from '../../config/shell-config.json';

export type ModifierKey = 'CTRL' | 'ALT' | 'SHIFT' | 'CMD';
export type CommandStep = MacroStep;

export type CommandPreset = {
	type: 'preset';
	label: string;
	steps: CommandStep[];
};

export type CommandPresetMenu = {
	type: 'submenu';
	label: string;
	presets: CommandPresetEntry[];
};

export type CommandPresetEntry = CommandPreset | CommandPresetMenu;

export type KeyboardLongPressOption =
	| { type: 'text'; text: string; label: string; icon: string | null }
	| {
			type: 'bytes';
			bytes: readonly number[];
			label: string;
			icon: string | null;
	  }
	| { type: 'macro'; macroId: string; label: string; icon: string | null }
	| { type: 'action'; actionId: ActionId; label: string; icon: string | null };

export type KeyboardLongPressConfig = {
	options: readonly KeyboardLongPressOption[];
};

type KeyboardSlotBase = {
	label: string;
	icon: string | null;
	span?: number;
	longPress?: KeyboardLongPressConfig;
};

export type KeyboardSlot =
	| ({ type: 'text'; text: string } & KeyboardSlotBase)
	| ({ type: 'bytes'; bytes: readonly number[] } & KeyboardSlotBase)
	| ({ type: 'modifier'; modifier: ModifierKey } & KeyboardSlotBase)
	| ({ type: 'macro'; macroId: string } & KeyboardSlotBase)
	| ({ type: 'action'; actionId: ActionId } & KeyboardSlotBase);

export type KeyboardExecutableItem = KeyboardSlot | KeyboardLongPressOption;

export type MacroDef = {
	id: string;
	name: string;
	label: string;
	category: string;
	script: string;
};

export type KeyboardDefinition = {
	id: string;
	name: string;
	builtIn?: boolean;
	active?: boolean;
	rotationOrder?: number;
	grid: readonly (readonly (KeyboardSlot | null)[])[];
};

export type ShellConfig = {
	version: string;
	updatedAt: string;
	defaultKeyboardId: string;
	activeKeyboardIds: string[];
	keyboardRouting: {
		actionTargets: Partial<Record<KeyboardTargetActionId, string>>;
		oneShotReturnByKeyboardId: Record<string, string>;
	};
	keyboards: KeyboardDefinition[];
	macrosByKeyboardId: Record<string, MacroDef[]>;
	commandMenus: CommandPresetEntry[];
};

const supportedActionIds = new Set<string>(CONFIG_SUPPORTED_ACTION_IDS);
const keyboardTargetActionIds = new Set<string>(KEYBOARD_TARGET_ACTION_IDS);

const modifierKeySchema = z.enum(['CTRL', 'ALT', 'SHIFT', 'CMD']);
const iconSchema = z.string().nullable();
const spanSchema = z.number().int().positive().optional();

const commandStepSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('text'),
		data: z.string(),
		delayMs: z.number().nonnegative().optional(),
		repeat: z.number().int().positive().optional(),
	}),
	z.object({
		type: z.literal('enter'),
		delayMs: z.number().nonnegative().optional(),
		repeat: z.number().int().positive().optional(),
	}),
	z.object({
		type: z.literal('arrowDown'),
		delayMs: z.number().nonnegative().optional(),
		repeat: z.number().int().positive().optional(),
	}),
	z.object({
		type: z.literal('arrowUp'),
		delayMs: z.number().nonnegative().optional(),
		repeat: z.number().int().positive().optional(),
	}),
	z.object({
		type: z.literal('esc'),
		delayMs: z.number().nonnegative().optional(),
		repeat: z.number().int().positive().optional(),
	}),
	z.object({
		type: z.literal('space'),
		delayMs: z.number().nonnegative().optional(),
		repeat: z.number().int().positive().optional(),
	}),
	z.object({
		type: z.literal('tab'),
		delayMs: z.number().nonnegative().optional(),
		repeat: z.number().int().positive().optional(),
	}),
]);

const commandPresetSchema = z.object({
	type: z.literal('preset'),
	label: z.string().min(1),
	steps: z.array(commandStepSchema),
});

const commandPresetEntrySchema: z.ZodType<CommandPresetEntry> = z.lazy(() =>
	z.discriminatedUnion('type', [
		commandPresetSchema,
		z.object({
			type: z.literal('submenu'),
			label: z.string().min(1),
			presets: z.array(commandPresetEntrySchema),
		}),
	]),
);

const keyboardLongPressOptionSchema: z.ZodType<KeyboardLongPressOption> =
	z.discriminatedUnion('type', [
		z.object({
			type: z.literal('text'),
			text: z.string(),
			label: z.string(),
			icon: iconSchema,
		}),
		z.object({
			type: z.literal('bytes'),
			bytes: z.array(z.number().int().min(0).max(255)),
			label: z.string(),
			icon: iconSchema,
		}),
		z.object({
			type: z.literal('macro'),
			macroId: z.string().min(1),
			label: z.string(),
			icon: iconSchema,
		}),
		z.object({
			type: z.literal('action'),
			actionId: z.string().min(1),
			label: z.string(),
			icon: iconSchema,
		}),
	]);

const keyboardLongPressConfigSchema: z.ZodType<KeyboardLongPressConfig> =
	z.object({
		options: z.array(keyboardLongPressOptionSchema).min(1),
	});

const longPressSchema = keyboardLongPressConfigSchema.optional();

const keyboardSlotSchema: z.ZodType<KeyboardSlot> = z.discriminatedUnion(
	'type',
	[
		z.object({
			type: z.literal('text'),
			text: z.string(),
			label: z.string(),
			icon: iconSchema,
			span: spanSchema,
			longPress: longPressSchema,
		}),
		z.object({
			type: z.literal('bytes'),
			bytes: z.array(z.number().int().min(0).max(255)),
			label: z.string(),
			icon: iconSchema,
			span: spanSchema,
			longPress: longPressSchema,
		}),
		z.object({
			type: z.literal('modifier'),
			modifier: modifierKeySchema,
			label: z.string(),
			icon: iconSchema,
			span: spanSchema,
			longPress: longPressSchema,
		}),
		z.object({
			type: z.literal('macro'),
			macroId: z.string().min(1),
			label: z.string(),
			icon: iconSchema,
			span: spanSchema,
			longPress: longPressSchema,
		}),
		z.object({
			type: z.literal('action'),
			actionId: z.string().min(1),
			label: z.string(),
			icon: iconSchema,
			span: spanSchema,
			longPress: longPressSchema,
		}),
	],
);

const macroDefSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	label: z.string().min(1),
	category: z.string().min(1),
	script: z.string().min(1),
});

const keyboardDefinitionSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	builtIn: z.boolean().optional(),
	active: z.boolean().optional(),
	rotationOrder: z.number().int().optional(),
	grid: z.array(z.array(keyboardSlotSchema.nullable())),
});

function validateExecutableItemReferences({
	item,
	macroIds,
	path,
	ctx,
	keyboardId,
}: {
	item: KeyboardExecutableItem;
	macroIds: Set<string>;
	path: (string | number)[];
	ctx: z.RefinementCtx;
	keyboardId: string;
}) {
	if (item.type === 'macro' && !macroIds.has(item.macroId)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: [...path, 'macroId'],
			message: `Keyboard ${keyboardId} references missing macro ${item.macroId}`,
		});
	}
	if (item.type === 'action' && !supportedActionIds.has(item.actionId)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: [...path, 'actionId'],
			message: `Unsupported actionId ${item.actionId}`,
		});
	}
}

const shellConfigSchema: z.ZodType<ShellConfig> = z
	.object({
		version: z.string().min(1),
		updatedAt: z.string().datetime(),
		defaultKeyboardId: z.string().min(1),
		activeKeyboardIds: z.array(z.string().min(1)).min(1),
		keyboardRouting: z.object({
			actionTargets: z.record(z.string(), z.string().min(1)),
			oneShotReturnByKeyboardId: z.record(z.string(), z.string().min(1)),
		}),
		keyboards: z.array(keyboardDefinitionSchema).min(1),
		macrosByKeyboardId: z.record(z.string(), z.array(macroDefSchema)),
		commandMenus: z.array(commandPresetEntrySchema),
	})
	.superRefine((config, ctx) => {
		const keyboardIds = new Set<string>();
		const activeKeyboardIds = new Set(config.activeKeyboardIds);
		for (const [index, keyboard] of config.keyboards.entries()) {
			if (keyboardIds.has(keyboard.id)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['keyboards', index, 'id'],
					message: `Duplicate keyboard id ${keyboard.id}`,
				});
			}
			keyboardIds.add(keyboard.id);
		}

		if (!keyboardIds.has(config.defaultKeyboardId)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['defaultKeyboardId'],
				message: `Unknown default keyboard ${config.defaultKeyboardId}`,
			});
		}

		for (const [index, keyboardId] of config.activeKeyboardIds.entries()) {
			if (config.activeKeyboardIds.indexOf(keyboardId) !== index) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['activeKeyboardIds', index],
					message: `Duplicate active keyboard id ${keyboardId}`,
				});
			}
			if (!keyboardIds.has(keyboardId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['activeKeyboardIds', index],
					message: `Unknown active keyboard ${keyboardId}`,
				});
			}
		}

		if (!config.activeKeyboardIds.includes(config.defaultKeyboardId)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['defaultKeyboardId'],
				message: `Default keyboard ${config.defaultKeyboardId} must be active`,
			});
		}

		for (const [actionId, targetKeyboardId] of Object.entries(
			config.keyboardRouting.actionTargets,
		)) {
			if (!keyboardTargetActionIds.has(actionId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['keyboardRouting', 'actionTargets', actionId],
					message: `Unsupported keyboard routing action ${actionId}`,
				});
			}
			if (!keyboardIds.has(targetKeyboardId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['keyboardRouting', 'actionTargets', actionId],
					message: `Keyboard routing action ${actionId} targets unknown keyboard ${targetKeyboardId}`,
				});
			} else if (!activeKeyboardIds.has(targetKeyboardId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['keyboardRouting', 'actionTargets', actionId],
					message: `Keyboard routing action ${actionId} must target an active keyboard`,
				});
			}
		}

		for (const [keyboardId, returnKeyboardId] of Object.entries(
			config.keyboardRouting.oneShotReturnByKeyboardId,
		)) {
			if (!keyboardIds.has(keyboardId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['keyboardRouting', 'oneShotReturnByKeyboardId', keyboardId],
					message: `One-shot return configured for unknown keyboard ${keyboardId}`,
				});
			} else if (!activeKeyboardIds.has(keyboardId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['keyboardRouting', 'oneShotReturnByKeyboardId', keyboardId],
					message: `One-shot return source keyboard ${keyboardId} must be active`,
				});
			}
			if (!keyboardIds.has(returnKeyboardId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['keyboardRouting', 'oneShotReturnByKeyboardId', keyboardId],
					message: `One-shot return keyboard ${returnKeyboardId} is unknown`,
				});
			} else if (!activeKeyboardIds.has(returnKeyboardId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['keyboardRouting', 'oneShotReturnByKeyboardId', keyboardId],
					message: `One-shot return keyboard ${returnKeyboardId} must be active`,
				});
			}
		}

		for (const [keyboardId, macros] of Object.entries(
			config.macrosByKeyboardId,
		)) {
			if (!keyboardIds.has(keyboardId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['macrosByKeyboardId', keyboardId],
					message: `Macros defined for unknown keyboard ${keyboardId}`,
				});
			}
			const macroIds = new Set<string>();
			for (const [index, macro] of macros.entries()) {
				if (macroIds.has(macro.id)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ['macrosByKeyboardId', keyboardId, index, 'id'],
						message: `Duplicate macro id ${macro.id} on keyboard ${keyboardId}`,
					});
				}
				macroIds.add(macro.id);
				const parsedScript = parseMacroScript(macro.script);
				if (
					parsedScript?.type === 'action' &&
					!supportedActionIds.has(parsedScript.actionId)
				) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ['macrosByKeyboardId', keyboardId, index, 'script'],
						message: `Unsupported macro actionId ${parsedScript.actionId}`,
					});
				}
			}
		}

		for (const [keyboardIndex, keyboard] of config.keyboards.entries()) {
			const macros = config.macrosByKeyboardId[keyboard.id] ?? [];
			const macroIds = new Set(macros.map((macro) => macro.id));

			for (const [rowIndex, row] of keyboard.grid.entries()) {
				for (const [colIndex, slot] of row.entries()) {
					if (!slot) continue;
					validateExecutableItemReferences({
						item: slot,
						macroIds,
						path: ['keyboards', keyboardIndex, 'grid', rowIndex, colIndex],
						ctx,
						keyboardId: keyboard.id,
					});

					for (const [optionIndex, option] of (
						slot.longPress?.options ?? []
					).entries()) {
						validateExecutableItemReferences({
							item: option,
							macroIds,
							path: [
								'keyboards',
								keyboardIndex,
								'grid',
								rowIndex,
								colIndex,
								'longPress',
								'options',
								optionIndex,
							],
							ctx,
							keyboardId: keyboard.id,
						});
					}
				}
			}
		}
	});

export function parseShellConfigData(data: unknown): ShellConfig {
	return shellConfigSchema.parse(data);
}

export function parseShellConfigString(text: string): ShellConfig {
	return parseShellConfigData(JSON.parse(text));
}

export function getBundledShellConfig(): ShellConfig {
	return parseShellConfigData(bundledShellConfigData);
}

export function getKeyboardsById(
	config: ShellConfig,
): Record<string, KeyboardDefinition> {
	return Object.fromEntries(
		config.keyboards.map((keyboard) => [keyboard.id, keyboard]),
	);
}

export function getActiveKeyboardIds(config: ShellConfig): string[] {
	return [...config.activeKeyboardIds];
}

export function getKeyboardActionTarget(
	config: ShellConfig,
	actionId: KeyboardTargetActionId,
): string | null {
	return config.keyboardRouting.actionTargets[actionId] ?? null;
}

export function getKeyboardOneShotReturnTarget(
	config: ShellConfig,
	keyboardId: string,
): string | null {
	return config.keyboardRouting.oneShotReturnByKeyboardId[keyboardId] ?? null;
}

export function resolveActiveOneShotReturnKeyboardId(
	config: ShellConfig,
	availableKeyboardIds: ReadonlySet<string>,
	keyboardId: string | null | undefined,
): string | null {
	if (!keyboardId || !availableKeyboardIds.has(keyboardId)) {
		return null;
	}
	const returnKeyboardId = getKeyboardOneShotReturnTarget(config, keyboardId);
	if (!returnKeyboardId || !availableKeyboardIds.has(returnKeyboardId)) {
		return null;
	}
	return returnKeyboardId;
}

export function resolveSelectedKeyboardId(
	config: ShellConfig,
	selectedKeyboardId: string | null | undefined,
): string {
	const activeKeyboardIds = new Set(config.activeKeyboardIds);
	if (selectedKeyboardId && activeKeyboardIds.has(selectedKeyboardId)) {
		return selectedKeyboardId;
	}
	if (activeKeyboardIds.has(config.defaultKeyboardId)) {
		return config.defaultKeyboardId;
	}
	return config.activeKeyboardIds[0] ?? '';
}
