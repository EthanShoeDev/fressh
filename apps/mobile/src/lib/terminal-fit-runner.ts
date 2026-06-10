import { buildDirectTmuxResizeWindowCommand } from './workmux-direct-tmux-control';

export type TerminalFitSize = {
	cols: number;
	rows: number;
};

export type ManualTerminalFitXterm = {
	fit: () => void;
};

export type ManualTerminalFitSideChannelResult = {
	success: boolean;
	output: string;
	error?: string;
};

export type ManualTerminalFitRunnerDeps<Connection> = {
	getConnection: () => Connection | null;
	isTmuxEnabled: () => boolean;
	getTerminalSize: () => TerminalFitSize | null;
	getXterm: () => ManualTerminalFitXterm | null;
	getTargetName: () => string;
	waitForTerminalSizeAfterFit?: () => Promise<TerminalFitSize | null>;
	resizePty: (cols: number, rows: number) => Promise<void>;
	executeSideChannelCommand: (
		connection: Connection,
		command: string,
		timeoutMs?: number,
	) => Promise<ManualTerminalFitSideChannelResult>;
	showFailure: (title: string, message: string) => void;
	getErrorMessage: (error: unknown) => string;
};

export type ManualTerminalFitRunner = {
	run: () => Promise<void>;
};

const TERMINAL_FIT_TMUX_RESIZE_TIMEOUT_MS = 30_000;

export function createManualTerminalFitRunner<Connection>(
	deps: ManualTerminalFitRunnerDeps<Connection>,
): ManualTerminalFitRunner {
	return {
		run: async () => {
			const xterm = deps.getXterm();
			if (!xterm) {
				deps.showFailure(
					'Fit terminal failed',
					'Terminal view is not ready yet. Try again.',
				);
				return;
			}

			const terminalSizeAfterFit = deps.waitForTerminalSizeAfterFit?.();
			xterm.fit();
			const terminalSize = (await terminalSizeAfterFit) ?? deps.getTerminalSize();
			if (!terminalSize) {
				deps.showFailure(
					'Fit terminal failed',
					'Terminal size is not ready yet. Try again.',
				);
				return;
			}

			try {
				await deps.resizePty(terminalSize.cols, terminalSize.rows);

				if (!deps.isTmuxEnabled()) {
					return;
				}

				const connection = deps.getConnection();
				if (!connection) {
					deps.showFailure(
						'Fit terminal failed',
						'No SSH connection is available.',
					);
					return;
				}

				const command = buildDirectTmuxResizeWindowCommand({
					targetName: deps.getTargetName(),
					cols: terminalSize.cols,
					rows: terminalSize.rows,
				});
				const result = await deps.executeSideChannelCommand(
					connection,
					command,
					TERMINAL_FIT_TMUX_RESIZE_TIMEOUT_MS,
				);

				if (!result.success) {
					deps.showFailure(
						'Fit terminal failed',
						result.error || result.output || 'Could not resize tmux window.',
					);
				}
			} catch (error) {
				deps.showFailure('Fit terminal failed', deps.getErrorMessage(error));
			}
		},
	};
}
