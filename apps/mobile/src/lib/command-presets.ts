export type CommandStep =
	| { type: 'text'; data: string; delayMs?: number; repeat?: number }
	| { type: 'enter'; delayMs?: number; repeat?: number }
	| { type: 'arrowDown'; delayMs?: number; repeat?: number }
	| { type: 'arrowUp'; delayMs?: number; repeat?: number }
	| { type: 'esc'; delayMs?: number; repeat?: number }
	| { type: 'space'; delayMs?: number; repeat?: number }
	| { type: 'tab'; delayMs?: number; repeat?: number };

export type CommandPreset = {
	type: 'preset';
	label: string;
	steps: CommandStep[];
};

export type CommandPresetEntry =
	| CommandPreset
	| {
			type: 'submenu';
			label: string;
			presets: CommandPresetEntry[];
	  };

export type CommandPresetMenu = Extract<
	CommandPresetEntry,
	{ type: 'submenu' }
>;

export const commandPresets: CommandPresetEntry[] = [
	{
		type: 'preset',
		label: '/review',
		steps: [
			{ type: 'text', data: '/review' },
			{ type: 'enter', delayMs: 280 },
			{ type: 'arrowDown', delayMs: 280 },
			{ type: 'enter', delayMs: 280 },
		],
	},
	{
		type: 'preset',
		label: 'fix',
		steps: [
			{ type: 'text', data: 'fix' },
			{ type: 'enter', delayMs: 280 },
		],
	},
	{
		type: 'preset',
		label: '/pr',
		steps: [{ type: 'text', data: '/pr' }, { type: 'enter' }],
	},
	{
		type: 'preset',
		label: '/clear',
		steps: [{ type: 'text', data: '/clear' }, { type: 'enter' }],
	},
	{
		type: 'preset',
		label: '/new',
		steps: [{ type: 'text', data: '/new' }, { type: 'enter' }],
	},
	{
		type: 'preset',
		label: '/work-step-by-step',
		steps: [{ type: 'text', data: '/work-step-by-step' }, { type: 'enter' }],
	},
	{
		type: 'preset',
		label: '/compact',
		steps: [{ type: 'text', data: '/compact' }, { type: 'enter' }],
	},
	{
		type: 'preset',
		label: 'skip',
		steps: [{ type: 'text', data: 'skip' }, { type: 'enter' }],
	},
	{
		type: 'preset',
		label: 'yes',
		steps: [{ type: 'text', data: 'yes' }, { type: 'enter' }],
	},
	{
		type: 'preset',
		label: 'approve',
		steps: [{ type: 'text', data: 'approve' }, { type: 'enter' }],
	},
	{
		type: 'preset',
		label: '/git:cc-fix-pr',
		steps: [{ type: 'text', data: '/git:cc-fix-pr' }, { type: 'enter' }],
	},
	{
		type: 'preset',
		label: '/work-on-issue',
		steps: [{ type: 'text', data: '/work-on-issue' }],
	},
	{
		type: 'submenu',
		label: 'Git',
		presets: [
			{
				type: 'preset',
				label: '$git-pr',
				steps: [{ type: 'text', data: '$git-pr' }, { type: 'enter' }],
			},
			{
				type: 'preset',
				label: 'git checkout dev',
				steps: [{ type: 'text', data: 'git checkout dev' }, { type: 'enter' }],
			},
			{
				type: 'preset',
				label: 'git pull',
				steps: [{ type: 'text', data: 'git pull' }, { type: 'enter' }],
			},
			{
				type: 'preset',
				label: 'git status',
				steps: [{ type: 'text', data: 'git status' }, { type: 'enter' }],
			},
		],
	},
];
