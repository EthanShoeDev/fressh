import assert from 'node:assert/strict';
import test from 'node:test';
import {
	runBrowserActionsDetectedOpen,
	runBrowserActionsDiffityShare,
} from '../../src/lib/browser-actions-controller-actions';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	isWorkmuxAppCommand,
	type WorkmuxAppContext,
} from '../../src/lib/workmux-app-commands';

type BrowserActionsRemoteCommand = {
	command: string;
	timeoutMs: number;
};

const context: WorkmuxAppContext = {
	sessionName: 'main',
	target: 'main:@12',
	windowId: '@12',
	windowIndex: 12,
	windowName: 'mobile',
	workspaceId: 'workspace-1',
	role: 'codex',
	roleWindow: true,
	homeWindow: false,
	paneId: '%34',
	paneTty: '/dev/pts/12',
	panePath: "/home/muly/fressh/apps/mobile's",
	projectRoot: '/home/muly/fressh',
	projectName: 'fressh',
};

function createRemoteHarness(options?: {
	contextFailure?: { output?: string; error?: string };
}) {
	const commands: BrowserActionsRemoteCommand[] = [];

	return {
		commands,
		runHostBrowserCommand: async (
			command: string,
			timeoutMs: number,
		): Promise<string> => {
			commands.push({ command, timeoutMs });
			if (isWorkmuxAppCommand(command) && command.includes(' context ')) {
				const failure = options?.contextFailure;
				if (failure) {
					throw new Error(
						failure.error ?? failure.output ?? 'Remote command failed.',
					);
				}
				return JSON.stringify(context);
			}
			if (command.includes('mdev diffity share')) {
				return 'https://example.test/diff';
			}
			return '';
		},
	};
}

void test('browser actions diffity resolves pane path through Workmux app context', async () => {
	const harness = createRemoteHarness();

	await runBrowserActionsDiffityShare({
		tmuxEnabled: true,
		tmuxTarget: "main'quoted",
		runHostBrowserCommand: harness.runHostBrowserCommand,
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	assert.deepEqual(harness.commands, [
		{
			command: "mdev tmux app context --session 'main'\\''quoted'",
			timeoutMs: 10_000,
		},
		{
			command: "cd '/home/muly/fressh/apps/mobile'\\''s' && mdev diffity share",
			timeoutMs: 60_000,
		},
	]);
});

void test('browser actions detected open resolves pane context through Workmux app context', async () => {
	const harness = createRemoteHarness();

	await runBrowserActionsDetectedOpen({
		mode: 'pick',
		tmuxEnabled: true,
		tmuxTarget: 'main',
		runHostBrowserCommand: harness.runHostBrowserCommand,
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	assert.deepEqual(harness.commands, [
		{
			command: "mdev tmux app context --session 'main'",
			timeoutMs: 10_000,
		},
		{
			command:
				"TMUX_PANE='%34' TMUX_PANE_TTY='/dev/pts/12' TMUX_PANE_PATH='/home/muly/fressh/apps/mobile'\\''s' mdev open pick",
			timeoutMs: 60_000,
		},
	]);
});

void test('browser actions format old mdev Workmux app context failures', async () => {
	const harness = createRemoteHarness({
		contextFailure: { error: 'mdev: command not found' },
	});

	await assert.rejects(
		runBrowserActionsDiffityShare({
			tmuxEnabled: true,
			tmuxTarget: 'main',
			runHostBrowserCommand: harness.runHostBrowserCommand,
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		(error) => {
			assert.equal(
				error instanceof Error ? error.message : String(error),
				WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
			);
			return true;
		},
	);
});
