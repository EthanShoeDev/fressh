import {
	buildTmuxScrollbackLiveInputSendPlan,
	type TmuxScrollbackLiveInputSendPlan,
} from './tmux-scrollback';

export function buildShellLiveInputSendPlan({
	scrollbackActive,
	payloadSegments,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
}: {
	scrollbackActive: boolean;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
}): TmuxScrollbackLiveInputSendPlan {
	return buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive,
		payloadSegments,
		interSegmentDelayMs,
		scrollbackExitDelayMs,
	});
}
