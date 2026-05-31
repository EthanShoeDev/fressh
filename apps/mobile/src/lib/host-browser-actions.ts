export const HOST_BROWSER_URL_SLOTS = [
	'window-url',
	'dev-web-server-url',
	'storybook-url',
	'app-url',
] as const;

export type HostBrowserUrlSlot = (typeof HOST_BROWSER_URL_SLOTS)[number];

export type HostBrowserOpenMode = 'auto' | 'pick';

export type TmuxPaneContext = {
	paneId: string;
	paneTty: string;
	panePath: string;
};

export type ParsedHostBrowserUrlInput =
	| { type: 'empty' }
	| { type: 'invalid'; message: string }
	| { type: 'valid'; url: string };

const hostBrowserUrlSlotLabels: Record<HostBrowserUrlSlot, string> = {
	'window-url': 'URL',
	'dev-web-server-url': 'Web',
	'storybook-url': 'Story',
	'app-url': 'App',
};

const hostBrowserUrlSlotSet = new Set<string>(HOST_BROWSER_URL_SLOTS);

export function isHostBrowserUrlSlot(
	value: string,
): value is HostBrowserUrlSlot {
	return hostBrowserUrlSlotSet.has(value);
}

export function getHostBrowserUrlSlotLabel(slot: HostBrowserUrlSlot): string {
	return hostBrowserUrlSlotLabels[slot];
}

export function quoteShell(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function extractLastHttpsUrl(output: string): string | null {
	const matches = output.match(/https:\/\/[^\s"'<>]+/g);
	return matches?.at(-1) ?? null;
}

export function parseHostBrowserUrlInput(
	input: string,
): ParsedHostBrowserUrlInput {
	const trimmed = input.trim();
	if (!trimmed) return { type: 'empty' };
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { type: 'invalid', message: 'Enter a valid URL.' };
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return {
			type: 'invalid',
			message: 'Enter an http:// or https:// URL.',
		};
	}
	return { type: 'valid', url: parsed.href };
}

export function buildHostBrowserPanePathCommand(
	tmuxSessionName: string,
): string {
	return `tmux display-message -p -t ${quoteShell(`${tmuxSessionName}:`)} '#{pane_current_path}'`;
}

export function buildHostBrowserPaneContextCommand(
	tmuxSessionName: string,
): string {
	return `tmux display-message -p -t ${quoteShell(`${tmuxSessionName}:`)} '#{pane_id}\t#{pane_tty}\t#{pane_current_path}'`;
}

export function buildTmuxCurrentWindowIdCommand(
	tmuxSessionName: string,
): string {
	return `tmux display-message -p -t ${quoteShell(`${tmuxSessionName}:`)} '#{window_id}'`;
}

export function buildDiffityShareCommand(panePath: string): string {
	return `cd ${quoteShell(panePath)} && mdev diffity share`;
}

export function buildTmuxWindowConfigGetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} mdev tmux url get ${quoteShell(slot)}`;
}

export function buildTmuxWindowConfigSetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
	url: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} mdev tmux url set-value ${quoteShell(slot)} ${quoteShell(url)}`;
}

export function parseTmuxPaneContextOutput(
	output: string,
): TmuxPaneContext | null {
	const line = output
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter(Boolean)
		.at(-1);
	if (!line) return null;

	const [paneIdRaw, paneTtyRaw, ...panePathParts] = line.split('\t');
	const paneId = paneIdRaw?.trim() ?? '';
	const paneTty = paneTtyRaw?.trim() ?? '';
	const panePath = panePathParts.join('\t').trim();
	if (!paneId || !paneTty || !panePath) return null;

	return { paneId, paneTty, panePath };
}

export function buildMdevOpenCommand(
	mode: HostBrowserOpenMode,
	context: TmuxPaneContext,
): string {
	return [
		`TMUX_PANE=${quoteShell(context.paneId)}`,
		`TMUX_PANE_TTY=${quoteShell(context.paneTty)}`,
		`TMUX_PANE_PATH=${quoteShell(context.panePath)}`,
		'mdev',
		'open',
		mode,
	].join(' ');
}

export function buildHostBrowserStatusCycleCommand(
	tmuxSessionName: string,
): string {
	return `mdev tmux nav cycle ${quoteShell(`${tmuxSessionName}:`)}`;
}
