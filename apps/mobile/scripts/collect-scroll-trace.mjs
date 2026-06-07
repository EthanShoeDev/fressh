#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PREFIX = 'FresshScrollTrace';
const DEFAULT_OUT = `/tmp/fressh-scroll-trace/${new Date()
	.toISOString()
	.replace(/[:.]/g, '-')}`;

function parseFiniteNumber(value, name) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`${name} must be a finite number`);
	}
	return parsed;
}

function parseNonNegativeInteger(value, name) {
	const parsed = parseFiniteNumber(value, name);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return parsed;
}

function parseNonNegativeNumber(value, name) {
	const parsed = parseFiniteNumber(value, name);
	if (parsed < 0) {
		throw new Error(`${name} must be a non-negative number`);
	}
	return parsed;
}

function parseArgs(argv) {
	const args = {
		out: DEFAULT_OUT,
		swipes: 1,
		x1: 800,
		y1: 1500,
		x2: 800,
		y2: 350,
		durationMs: 1200,
		settleMs: 2500,
		failOnScrollErrors: false,
		minAcceptedBatches: 0,
		maxAverageCommandDurationMs: undefined,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--') continue;
		const next = () => {
			index += 1;
			if (index >= argv.length) throw new Error(`${arg} needs a value`);
			return argv[index];
		};
		switch (arg) {
			case '--out':
				args.out = next();
				break;
			case '--swipes':
				args.swipes = parseNonNegativeInteger(next(), '--swipes');
				break;
			case '--x1':
				args.x1 = parseFiniteNumber(next(), '--x1');
				break;
			case '--y1':
				args.y1 = parseFiniteNumber(next(), '--y1');
				break;
			case '--x2':
				args.x2 = parseFiniteNumber(next(), '--x2');
				break;
			case '--y2':
				args.y2 = parseFiniteNumber(next(), '--y2');
				break;
			case '--duration-ms':
				args.durationMs = parseNonNegativeNumber(next(), '--duration-ms');
				break;
			case '--settle-ms':
				args.settleMs = parseNonNegativeNumber(next(), '--settle-ms');
				break;
			case '--fail-on-scroll-errors':
				args.failOnScrollErrors = true;
				break;
			case '--min-accepted-batches':
				args.minAcceptedBatches = parseNonNegativeInteger(
					next(),
					'--min-accepted-batches',
				);
				break;
			case '--max-average-command-duration-ms':
				args.maxAverageCommandDurationMs = parseNonNegativeNumber(
					next(),
					'--max-average-command-duration-ms',
				);
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

function adb(args, options = {}) {
	return execFileSync('adb', args, {
		encoding: options.encoding ?? 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
		env: process.env,
	});
}

function sleep(ms) {
	return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseTraceLine(line) {
	const prefixIndex = line.indexOf(PREFIX);
	if (prefixIndex < 0) return null;
	const jsonStart = line.indexOf('{', prefixIndex);
	if (jsonStart < 0) return null;
	try {
		const parsed = JSON.parse(line.slice(jsonStart));
		if (!parsed || typeof parsed !== 'object') return null;
		if (typeof parsed.at !== 'number' || typeof parsed.event !== 'string') {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function numberOrNull(value) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isNotInModeValue(value) {
	return (
		typeof value === 'string' &&
		(value.includes('not in a mode') || value.includes('not in the mode'))
	);
}

function percentile(values, p) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
	);
	return sorted[index];
}

function summarize(events) {
	const firstAt = events.length ? events[0].at : null;
	const lastAt = events.length ? events[events.length - 1].at : null;
	const startAt =
		events.find((event) => event.event === 'rn.mode' && event.active === true)
			?.at ?? firstAt;
	const commandStarts = [];
	const commandDurations = [];
	let acceptedBatchCount = 0;
	let droppedBatchCount = 0;
	const dropReasons = {};
	let failedCommandCount = 0;
	let commandCount = 0;
	let firstFailureAt = null;
	let maxQueueDepth = 0;
	let maxPendingResolvers = 0;
	let notInModeCount = 0;

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
		const queueDepth = numberOrNull(event.queueDepth);
		if (queueDepth !== null)
			maxQueueDepth = Math.max(maxQueueDepth, queueDepth);
		const pendingResolvers = numberOrNull(event.pendingResolvers);
		if (pendingResolvers !== null) {
			maxPendingResolvers = Math.max(maxPendingResolvers, pendingResolvers);
		}
		if (event.event === 'executor.command.start') {
			commandStarts.push(event.at);
			continue;
		}
		if (event.event !== 'executor.command.end') continue;
		commandCount += 1;
		const explicitDuration = numberOrNull(event.durationMs);
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

	const avgDuration = commandDurations.length
		? Math.round(
				(commandDurations.reduce((sum, value) => sum + value, 0) /
					commandDurations.length) *
					10,
			) / 10
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
			p95: percentile(commandDurations, 95),
			max: commandDurations.length ? Math.max(...commandDurations) : null,
		},
	};
}

function isSummaryHealthy(summary, options) {
	if (summary.eventCount <= 0) return false;
	if (summary.acceptedBatchCount < options.minAcceptedBatches) return false;
	if (summary.droppedBatchCount !== 0) return false;
	if (summary.failedCommandCount !== 0) return false;
	if (summary.notInModeCount !== 0) return false;

	if (options.maxAverageCommandDurationMs !== undefined) {
		const avg = summary.commandDurationMs.avg;
		if (typeof avg !== 'number' || !Number.isFinite(avg)) return false;
		if (avg > options.maxAverageCommandDurationMs) return false;
	}

	return true;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const outDir = resolve(args.out);
	mkdirSync(outDir, { recursive: true });

	console.log(`Writing scroll trace to ${outDir}`);
	writeFileSync(join(outDir, 'adb-devices.txt'), adb(['devices', '-l']));
	adb(['logcat', '-c']);

	for (let index = 0; index < args.swipes; index += 1) {
		adb([
			'shell',
			'input',
			'swipe',
			String(args.x1),
			String(args.y1),
			String(args.x2),
			String(args.y2),
			String(args.durationMs),
		]);
		await sleep(args.settleMs);
	}

	const screenshot = adb(['exec-out', 'screencap', '-p'], {
		encoding: 'buffer',
	});
	writeFileSync(join(outDir, 'screenshot.png'), screenshot);

	const logcat = adb(['logcat', '-d', '-v', 'threadtime']);
	writeFileSync(join(outDir, 'logcat.txt'), logcat);
	const events = logcat.split(/\r?\n/).map(parseTraceLine).filter(Boolean);
	writeFileSync(
		join(outDir, 'scroll-trace.jsonl'),
		`${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
	);
	const summary = summarize(events);
	writeFileSync(
		join(outDir, 'summary.json'),
		`${JSON.stringify(summary, null, 2)}\n`,
	);

	console.log(JSON.stringify(summary, null, 2));
	if (summary.eventCount === 0) {
		console.error(
			'No scroll trace events found. Publish or run the app with EXPO_PUBLIC_FRESSH_ENABLE_SCROLL_TRACE=true to enable runtime scroll tracing.',
		);
	}
	if (
		args.failOnScrollErrors &&
		!isSummaryHealthy(summary, {
			minAcceptedBatches: args.minAcceptedBatches,
			maxAverageCommandDurationMs: args.maxAverageCommandDurationMs,
		})
	) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
