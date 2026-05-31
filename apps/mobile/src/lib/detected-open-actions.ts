import {
	buildMdevOpenCommand,
	type HostBrowserOpenMode,
	type TmuxPaneContext,
} from '@/lib/host-browser-actions';

export type RunDetectedOpenCommandDeps = {
	mode: HostBrowserOpenMode;
	resolvePaneContext: () => Promise<TmuxPaneContext>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs: number,
	) => Promise<string>;
};

export function getDetectedOpenTimeoutMs(mode: HostBrowserOpenMode): number {
	return mode === 'pick' ? 60_000 : 30_000;
}

export async function runDetectedOpenCommand({
	mode,
	resolvePaneContext,
	runHostBrowserCommand,
}: RunDetectedOpenCommandDeps): Promise<void> {
	const context = await resolvePaneContext();
	await runHostBrowserCommand(
		buildMdevOpenCommand(mode, context),
		getDetectedOpenTimeoutMs(mode),
	);
}
