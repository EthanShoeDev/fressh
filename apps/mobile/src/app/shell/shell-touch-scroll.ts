import type { TouchScrollConfig } from '@fressh/react-native-xtermjs-webview';

export type ShellTouchScrollPolicy = {
	ownsViewport: boolean;
	touchScrollConfig: TouchScrollConfig;
	xtermScrollback: number;
};

export function resolveShellTouchScrollPolicy({
	platformOS,
	width,
	height,
	tmuxEnabled,
	hasConnection,
	scrollTraceEnabled,
	debug,
}: {
	platformOS: string;
	width: number;
	height: number;
	tmuxEnabled: boolean;
	hasConnection: boolean;
	scrollTraceEnabled: boolean;
	debug: boolean;
}): ShellTouchScrollPolicy {
	const ownsViewport =
		platformOS === 'android' &&
		Math.min(width, height) >= 600 &&
		tmuxEnabled &&
		hasConnection;

	return {
		ownsViewport,
		touchScrollConfig: ownsViewport
			? {
					enabled: true,
					pxPerLine: 10,
					slopPx: 10,
					maxLinesPerFrame: 12,
					flickVelocity: 1.2,
					coalesceMs: 24,
					minFlushMs: 16,
					maxFlushMs: 80,
					maxPagesPerFlush: 12,
					maxExtraLines: 999,
					maxBacklogPages: 50,
					velocityMultiplierEnabled: true,
					velocityThreshold: 0.3,
					velocityBoost: 2.5,
					velocityBoostMax: 20,
					velocitySmoothing: 0.2,
					backlogMultiplierEnabled: true,
					backlogBoostRefPages: 2,
					backlogBoostMax: 2,
					rttEwmaAlpha: 0.2,
					debug,
					debugOverlay: false,
					debugTelemetry: scrollTraceEnabled,
					debugTelemetryIntervalMs: 120,
				}
			: { enabled: false },
		xtermScrollback: ownsViewport ? 0 : 10000,
	};
}
