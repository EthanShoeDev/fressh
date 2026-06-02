import {
	buildTmuxScrollbackLiveInputSendPlan,
	type TmuxScrollbackLiveInputSendPlan,
} from './tmux-scrollback';

const bytesEqual = (a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>) => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
};

const isSingleExitKeyPayload = (
	payloadSegments: Uint8Array<ArrayBuffer>[],
	exitKeyBytes: Uint8Array<ArrayBuffer>,
) =>
	payloadSegments.length === 1 &&
	payloadSegments[0] != null &&
	bytesEqual(payloadSegments[0], exitKeyBytes);

export function buildShellLiveInputSendPlan({
	scrollbackActive,
	cancelKeyBytes,
	exitKeyBytes,
	payloadSegments,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
	isCurrentPayloadExitKey,
}: {
	scrollbackActive: boolean;
	cancelKeyBytes: Uint8Array<ArrayBuffer>;
	exitKeyBytes: Uint8Array<ArrayBuffer>;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
	isCurrentPayloadExitKey?: boolean;
}): TmuxScrollbackLiveInputSendPlan {
	return buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive,
		cancelKey: cancelKeyBytes,
		payloadSegments,
		interSegmentDelayMs,
		scrollbackExitDelayMs,
		dropPayloadAfterExit:
			isCurrentPayloadExitKey ??
			isSingleExitKeyPayload(payloadSegments, exitKeyBytes),
	});
}
