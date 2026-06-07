import { runDetectedOpenCommand } from '@/lib/detected-open-actions';
import {
	buildDiffityShareCommand,
	type HostBrowserOpenMode,
	type TmuxPaneContext,
} from './host-browser-actions';
import {
	buildWorkmuxAppContextArgv,
	formatWorkmuxAppBoundaryFailureMessage,
	parseWorkmuxAppContextOutput,
} from './workmux-app-commands';

export type BrowserActionsRunHostBrowserCommand = (
	command: string,
	timeoutMs: number,
) => Promise<string>;

export type BrowserActionsRunWorkmuxCommand = (
	argv: string[],
	timeoutMs: number,
) => Promise<string>;

export type BrowserActionsContextDeps = {
	tmuxEnabled: boolean;
	tmuxTarget: string;
	runHostBrowserCommand: BrowserActionsRunHostBrowserCommand;
	runWorkmuxCommand: BrowserActionsRunWorkmuxCommand;
	getErrorMessage: (error: unknown) => string;
};

export type BrowserActionsDetectedOpenDeps = BrowserActionsContextDeps & {
	mode: HostBrowserOpenMode;
};

function getSessionName(tmuxTarget: string): string {
	return tmuxTarget.trim() || 'main';
}

async function runWorkmuxAppContextCommand({
	tmuxEnabled,
	tmuxTarget,
	runWorkmuxCommand,
}: BrowserActionsContextDeps): Promise<{
	output: string;
	sessionName: string;
}> {
	if (!tmuxEnabled) {
		throw new Error(
			'Host browser actions require a Workmux-enabled connection.',
		);
	}
	const sessionName = getSessionName(tmuxTarget);
	const argv = buildWorkmuxAppContextArgv(sessionName);
	try {
		return {
			output: await runWorkmuxCommand(argv, 10_000),
			sessionName,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(formatWorkmuxAppBoundaryFailureMessage(message));
	}
}

export async function resolveBrowserActionsPanePath(
	deps: BrowserActionsContextDeps,
): Promise<string> {
	const { output, sessionName } = await runWorkmuxAppContextCommand(deps);
	try {
		return parseWorkmuxAppContextOutput(output).panePath;
	} catch (error) {
		throw new Error(
			`Could not resolve pane path for Workmux-enabled connection ${sessionName}: ${deps.getErrorMessage(error)}`,
		);
	}
}

export async function resolveBrowserActionsPaneContext(
	deps: BrowserActionsContextDeps,
): Promise<TmuxPaneContext> {
	const { output, sessionName } = await runWorkmuxAppContextCommand(deps);
	try {
		const context = parseWorkmuxAppContextOutput(output);
		return {
			paneId: context.paneId,
			paneTty: context.paneTty,
			panePath: context.panePath,
		};
	} catch (error) {
		throw new Error(
			`Could not resolve pane context for Workmux-enabled connection ${sessionName}: ${deps.getErrorMessage(error)}`,
		);
	}
}

export async function runBrowserActionsDiffityShare(
	deps: BrowserActionsContextDeps,
): Promise<string> {
	const panePath = await resolveBrowserActionsPanePath(deps);
	return deps.runHostBrowserCommand(buildDiffityShareCommand(panePath), 60_000);
}

export async function runBrowserActionsDetectedOpen({
	mode,
	...deps
}: BrowserActionsDetectedOpenDeps): Promise<void> {
	await runDetectedOpenCommand({
		mode,
		resolvePaneContext: () => resolveBrowserActionsPaneContext(deps),
		runHostBrowserCommand: deps.runHostBrowserCommand,
	});
}
