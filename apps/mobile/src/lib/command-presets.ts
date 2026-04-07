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

const superpowerSkillLabels = [
	'$test-driven-development',
	'$systematic-debugging',
	'$verification-before-completion',
	'$brainstorming',
	'$writing-plans',
	'$executing-plans',
	'$dispatching-parallel-agents',
	'$requesting-code-review',
	'$receiving-code-review',
	'$finishing-a-development-branch',
	'$writing-skills',
	'$using-superpowers',
] as const;

export const commandPresets: CommandPresetEntry[] = [
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
		label: '$rloop-code-fix',
		steps: [
			{ type: 'text', data: '$rloop-code-fix' },
			{ type: 'enter', delayMs: 280 },
		],
	},
	{
		type: 'preset',
		label: '/rloop-review',
		steps: [
			{ type: 'text', data: '/rloop-review' },
			{ type: 'enter', delayMs: 280 },
		],
	},
	{
		type: 'submenu',
		label: 'superpower',
		presets: superpowerSkillLabels.map((label) => ({
			type: 'preset',
			label,
			steps: [{ type: 'text', data: label }],
		})),
	},

	{
		type: 'preset',
		label: 'approve',
		steps: [{ type: 'text', data: 'approve' }, { type: 'enter' }],
	},
	{
		type: 'submenu',
		label: 'features',
		presets: [
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
				label: '/feature-design-step1',
				steps: [{ type: 'text', data: '/feature-design-step1' }],
			},
			{
				type: 'preset',
				label: '/feature-design-step2',
				steps: [
					{ type: 'text', data: '/feature-design-step2' },
					{ type: 'enter' },
				],
			},
			{
				type: 'preset',
				label: '/feature-design-step3',
				steps: [
					{ type: 'text', data: '/feature-design-step3' },
					{ type: 'enter' },
				],
			},
			{
				type: 'preset',
				label: '/work-on-bug',
				steps: [{ type: 'text', data: '/work-on-bug' }],
			},
			{
				type: 'preset',
				label: '/work-on-bug-reflect',
				steps: [
					{ type: 'text', data: '/work-on-bug-reflect' },
					{ type: 'enter' },
				],
			},
			{
				type: 'preset',
				label: '$oracle',
				steps: [{ type: 'text', data: '$oracle' }],
			},
		],
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
			{
				type: 'preset',
				label: 'yarn cq',
				steps: [{ type: 'text', data: 'yarn cq' }, { type: 'enter' }],
			},
			{
				type: 'preset',
				label: 'yarn test:ci',
				steps: [{ type: 'text', data: 'yarn test:ci' }, { type: 'enter' }],
			},
			{
				type: 'preset',
				label: 'clear',
				steps: [{ type: 'text', data: 'clear' }, { type: 'enter' }],
			},
		],
	},
	{
		type: 'submenu',
		label: 'core8',
		presets: [
			{
				type: 'preset',
				label: 'core8 env fix',
				steps: [
					{ type: 'text', data: './bin/core8 env fix' },
					{ type: 'enter' },
				],
			},
			{
				type: 'preset',
				label: 'core8 jobs switch F0',
				steps: [{ type: 'text', data: './bin/core8 jobs switch F0' }],
			},
			{
				type: 'preset',
				label: 'core8 env switch staging',
				steps: [{ type: 'text', data: './bin/core8 env switch staging' }],
			},
		],
	},
];
