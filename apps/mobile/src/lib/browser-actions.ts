import { type HostBrowserUrlSlot } from '@/lib/host-browser-actions';

export type BrowserActionStaticRowId =
	| 'diff'
	| 'github-issues'
	| 'github-pulls';

export type BrowserActionUrlRowId =
	| 'url-window'
	| 'url-dev-server'
	| 'url-storybook'
	| 'url-app';

export type BrowserActionRow =
	| {
			id: BrowserActionStaticRowId;
			type: 'static';
			label: string;
			description: string;
			icon: string;
	  }
	| {
			id: BrowserActionUrlRowId;
			type: 'url-slot';
			label: string;
			description: string;
			icon: string;
			slot: HostBrowserUrlSlot;
	  };

export const BROWSER_ACTION_ROWS = [
	{
		id: 'diff',
		type: 'static',
		label: 'Diff',
		description: 'Open Diffity for this repository',
		icon: 'GitCompare',
	},
	{
		id: 'github-issues',
		type: 'static',
		label: 'GitHub Issues',
		description: 'Open repository issues',
		icon: 'CircleDot',
	},
	{
		id: 'github-pulls',
		type: 'static',
		label: 'GitHub Pull Requests',
		description: 'Open repository pull requests',
		icon: 'GitPullRequest',
	},
	{
		id: 'url-window',
		type: 'url-slot',
		label: 'URL',
		description: 'Open or set the saved generic URL',
		icon: 'Link',
		slot: 'window-url',
	},
	{
		id: 'url-dev-server',
		type: 'url-slot',
		label: 'Web',
		description: 'Open or set the saved dev server URL',
		icon: 'Globe',
		slot: 'dev-web-server-url',
	},
	{
		id: 'url-storybook',
		type: 'url-slot',
		label: 'Story',
		description: 'Open or set the saved Storybook URL',
		icon: 'BookOpen',
		slot: 'storybook-url',
	},
	{
		id: 'url-app',
		type: 'url-slot',
		label: 'App',
		description: 'Open or set the saved app URL',
		icon: 'PanelTop',
		slot: 'app-url',
	},
] as const satisfies readonly BrowserActionRow[];

export const BROWSER_ACTION_URL_ROWS = BROWSER_ACTION_ROWS.filter(
	isBrowserActionUrlRow,
);

export function isBrowserActionUrlRow(
	row: BrowserActionRow,
): row is Extract<BrowserActionRow, { type: 'url-slot' }> {
	return row.type === 'url-slot';
}
