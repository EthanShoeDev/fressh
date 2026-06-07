import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderedWriter } from '../../src/lib/ordered-writer';

const bytes = (values: number[]) => new Uint8Array(values);

void test('ordered writer stops delayed batch when request becomes stale', async () => {
	let current = true;
	const writes: number[][] = [];
	const writer = new OrderedWriter(async (segment) => {
		writes.push(Array.from(segment));
		current = false;
	});

	await writer.sendBatch([bytes([0x68, 0x69]), bytes([0x0d])], {
		interSegmentDelayMs: 1,
		isCurrent: () => current,
	});

	assert.deepEqual(writes, [[0x68, 0x69]]);
});

void test('ordered writer checks freshness before first batch segment', async () => {
	const writes: number[][] = [];
	const writer = new OrderedWriter(async (segment) => {
		writes.push(Array.from(segment));
	});

	await writer.sendBatch([bytes([0x0d])], {
		isCurrent: () => false,
	});

	assert.deepEqual(writes, []);
});
