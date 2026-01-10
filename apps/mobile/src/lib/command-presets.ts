export type CommandStep =
	| { type: 'text'; data: string; delayMs?: number; repeat?: number }
	| { type: 'enter'; delayMs?: number; repeat?: number }
	| { type: 'arrowDown'; delayMs?: number; repeat?: number }
	| { type: 'arrowUp'; delayMs?: number; repeat?: number }
	| { type: 'esc'; delayMs?: number; repeat?: number }
	| { type: 'space'; delayMs?: number; repeat?: number }
	| { type: 'tab'; delayMs?: number; repeat?: number };

export type CommandPreset = {
	label: string;
	steps: CommandStep[];
};

export const commandPresets: CommandPreset[] = [
	{
		label: '/review',
		steps: [
			{ type: 'text', data: '/review' },
			{ type: 'enter', delayMs: 280 },
			{ type: 'arrowDown', delayMs: 280 },
			{ type: 'enter', delayMs: 280 },
		],
	},
	{
		label: 'fix',
		steps: [
			{ type: 'text', data: 'fix' },
			{ type: 'enter', delayMs: 280 },
		],
	},
	{
		label: '/pr',
		steps: [{ type: 'text', data: '/pr' }, { type: 'enter' }],
	},
	{
		label: '/clear',
		steps: [{ type: 'text', data: '/clear' }, { type: 'enter' }],
	},
	{
		label: '/new',
		steps: [{ type: 'text', data: '/new' }, { type: 'enter' }],
	},
	{
		label: '/work-step-by-step',
		steps: [{ type: 'text', data: '/work-step-by-step' }, { type: 'enter' }],
	},
	{
		label: '/compact',
		steps: [{ type: 'text', data: '/compact' }, { type: 'enter' }],
	},
	{
		label: 'skip',
		steps: [{ type: 'text', data: 'skip' }, { type: 'enter' }],
	},
	{
		label: 'yes',
		steps: [{ type: 'text', data: 'yes' }, { type: 'enter' }],
	},
	{
		label: 'approve',
		steps: [{ type: 'text', data: 'approve' }, { type: 'enter' }],
	},
	{
		label: '/git:cc-fix-pr',
		steps: [{ type: 'text', data: '/git:cc-fix-pr' }, { type: 'enter' }],
	},
	{
		label: '/work-on-issue',
		steps: [{ type: 'text', data: '/work-on-issue' }],
	},
	{
		label: 'git checkout dev',
		steps: [{ type: 'text', data: 'git checkout dev' }, { type: 'enter' }],
	},
	{
		label: 'git pull',
		steps: [{ type: 'text', data: 'git pull' }, { type: 'enter' }],
	},
];
