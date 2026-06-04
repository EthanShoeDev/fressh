export const SCROLL_TRACE_LOG_PREFIX = 'FresshScrollTrace';

export type ScrollTraceEvent = {
	at: number;
	event: string;
	[key: string]: unknown;
};

export type ScrollTracePayload = {
	at?: number;
	event: string;
	[key: string]: unknown;
};

export type ScrollTraceSink = (event: ScrollTracePayload) => void;

export type ScrollTraceSummary = {
	eventCount: number;
	firstAt: number | null;
	lastAt: number | null;
	durationMs: number | null;
	batchCount: number;
	acceptedBatchCount: number;
	droppedBatchCount: number;
	dropReasons: Record<string, number>;
	commandCount: number;
	failedCommandCount: number;
	firstFailureAt: number | null;
	firstFailureAfterStartMs: number | null;
	notInModeCount: number;
	maxQueueDepth: number;
	maxPendingResolvers: number;
	commandDurationMs: {
		count: number;
		avg: number | null;
		max: number | null;
	};
};

export type ScrollTraceSummaryLike = Pick<
	ScrollTraceSummary,
	| 'eventCount'
	| 'acceptedBatchCount'
	| 'droppedBatchCount'
	| 'failedCommandCount'
	| 'notInModeCount'
	| 'commandDurationMs'
>;

export type ScrollTraceHealthOptions = {
	minAcceptedBatches?: number;
	maxAverageCommandDurationMs?: number;
};

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isNotInModeValue(value: unknown): boolean {
	return (
		typeof value === 'string' &&
		(value.includes('not in a mode') || value.includes('not in the mode'))
	);
}

export function isScrollTraceEnabled(): boolean {
	return process.env.EXPO_PUBLIC_FRESSH_ENABLE_SCROLL_TRACE === 'true';
}

export function buildScrollTraceLine(
	payload: ScrollTracePayload,
	now: () => number = Date.now,
): string {
	const { at, event, ...rest } = payload;
	const traceEvent: ScrollTraceEvent = {
		at: at ?? now(),
		event,
		...rest,
	};
	return `${SCROLL_TRACE_LOG_PREFIX} ${JSON.stringify(traceEvent)}`;
}

export function emitScrollTrace(
	payload: ScrollTracePayload,
	now: () => number = Date.now,
): void {
	if (!isScrollTraceEnabled()) return;
	console.log(buildScrollTraceLine(payload, now));
}

export function parseScrollTraceLogLine(line: string): ScrollTraceEvent | null {
	const prefixIndex = line.indexOf(SCROLL_TRACE_LOG_PREFIX);
	if (prefixIndex < 0) return null;
	const jsonStart = line.indexOf('{', prefixIndex);
	if (jsonStart < 0) return null;
	try {
		const parsed = JSON.parse(line.slice(jsonStart)) as unknown;
		if (!parsed || typeof parsed !== 'object') return null;
		const event = (parsed as { event?: unknown }).event;
		const at = (parsed as { at?: unknown }).at;
		if (typeof event !== 'string') return null;
		if (typeof at !== 'number' || !Number.isFinite(at)) return null;
		return parsed as ScrollTraceEvent;
	} catch {
		return null;
	}
}

export function summarizeScrollTraceEvents(
	events: ScrollTraceEvent[],
): ScrollTraceSummary {
	const firstAt = events.length ? (events[0]?.at ?? null) : null;
	const lastAt = events.length ? (events[events.length - 1]?.at ?? null) : null;
	const startAt =
		events.find((event) => event.event === 'rn.mode' && event.active === true)
			?.at ?? firstAt;
	const commandStarts: number[] = [];
	const commandDurations: number[] = [];
	let acceptedBatchCount = 0;
	let droppedBatchCount = 0;
	const dropReasons: Record<string, number> = {};
	let commandCount = 0;
	let failedCommandCount = 0;
	let firstFailureAt: number | null = null;
	let notInModeCount = 0;
	let maxQueueDepth = 0;
	let maxPendingResolvers = 0;

	for (const event of events) {
		if (event.event === 'rn.batch.accepted') acceptedBatchCount += 1;
		if (event.event === 'rn.batch.dropped') {
			droppedBatchCount += 1;
			if (typeof event.reason === 'string') {
				dropReasons[event.reason] = (dropReasons[event.reason] ?? 0) + 1;
			}
		}
		if (
			event.reason === 'not-in-mode' ||
			isNotInModeValue(event.error) ||
			isNotInModeValue(event.message)
		) {
			notInModeCount += 1;
		}

		const queueDepth = asNumber(event.queueDepth);
		if (queueDepth !== null)
			maxQueueDepth = Math.max(maxQueueDepth, queueDepth);
		const pendingResolvers = asNumber(event.pendingResolvers);
		if (pendingResolvers !== null) {
			maxPendingResolvers = Math.max(maxPendingResolvers, pendingResolvers);
		}

		if (event.event === 'executor.command.start') {
			commandStarts.push(event.at);
			continue;
		}

		if (event.event !== 'executor.command.end') continue;
		commandCount += 1;
		const explicitDuration = asNumber(event.durationMs);
		const startedAt = commandStarts.shift();
		const duration =
			explicitDuration ??
			(startedAt === undefined ? null : event.at - startedAt);
		if (duration !== null) commandDurations.push(duration);
		if (event.success === false) {
			failedCommandCount += 1;
			firstFailureAt ??= event.at;
		}
	}

	const durationTotal = commandDurations.reduce((sum, value) => sum + value, 0);
	const avgDuration = commandDurations.length
		? Math.round((durationTotal / commandDurations.length) * 10) / 10
		: null;

	return {
		eventCount: events.length,
		firstAt,
		lastAt,
		durationMs:
			firstAt === null || lastAt === null
				? null
				: Math.max(0, lastAt - firstAt),
		batchCount: acceptedBatchCount + droppedBatchCount,
		acceptedBatchCount,
		droppedBatchCount,
		dropReasons,
		commandCount,
		failedCommandCount,
		firstFailureAt,
		firstFailureAfterStartMs:
			firstFailureAt === null || startAt === null
				? null
				: firstFailureAt - startAt,
		notInModeCount,
		maxQueueDepth,
		maxPendingResolvers,
		commandDurationMs: {
			count: commandDurations.length,
			avg: avgDuration,
			max: commandDurations.length ? Math.max(...commandDurations) : null,
		},
	};
}

export function isScrollTraceSummaryHealthy(
	summary: ScrollTraceSummaryLike,
	options: ScrollTraceHealthOptions = {},
): boolean {
	const minAcceptedBatches = options.minAcceptedBatches ?? 0;
	if (summary.eventCount <= 0) return false;
	if (summary.acceptedBatchCount < minAcceptedBatches) return false;
	if (summary.droppedBatchCount !== 0) return false;
	if (summary.failedCommandCount !== 0) return false;
	if (summary.notInModeCount !== 0) return false;

	const maxAverageCommandDurationMs = options.maxAverageCommandDurationMs;
	if (maxAverageCommandDurationMs !== undefined) {
		const avg = summary.commandDurationMs.avg;
		if (typeof avg !== 'number' || !Number.isFinite(avg)) return false;
		if (avg > maxAverageCommandDurationMs) return false;
	}

	return true;
}
