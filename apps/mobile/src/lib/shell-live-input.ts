import {
	buildTmuxScrollbackLiveInputSendPlan,
	type TmuxScrollbackLiveInputSendPlan,
} from './tmux-scrollback';

export function buildShellLiveInputSendPlan({
	scrollbackActive,
	payloadSegments,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
	isCurrentPayloadExitKey,
}: {
	scrollbackActive: boolean;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
	isCurrentPayloadExitKey?: boolean;
}): TmuxScrollbackLiveInputSendPlan {
	return buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive,
		payloadSegments,
		interSegmentDelayMs,
		scrollbackExitDelayMs,
		dropPayloadAfterExit: isCurrentPayloadExitKey ?? false,
	});
}
