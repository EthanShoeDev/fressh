import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildClipboardPasteSegments,
	buildCommanderExecuteSegments,
	buildTextEntryPasteSegments,
} from '../../src/lib/terminal-input-payloads';

const decoder = new TextDecoder();
const decodeSegments = (segments: Uint8Array[]) =>
	segments.map((segment) => decoder.decode(segment));

void test('text entry paste appends Enter', () => {
	assert.deepEqual(decodeSegments(buildTextEntryPasteSegments('echo hi')), [
		'echo hi',
		'\r',
	]);
});

void test('text entry paste returns no payload for empty text', () => {
	assert.deepEqual(buildTextEntryPasteSegments(''), []);
});

void test('clipboard paste does not append Enter', () => {
	assert.deepEqual(decodeSegments(buildClipboardPasteSegments('echo hi')), [
		'echo hi',
	]);
});

void test('clipboard paste returns no payload for empty text', () => {
	assert.deepEqual(buildClipboardPasteSegments(''), []);
});

void test('commander execute appends Enter', () => {
	assert.deepEqual(decodeSegments(buildCommanderExecuteSegments('pwd')), [
		'pwd',
		'\r',
	]);
});

void test('commander execute returns no payload for trim-empty text', () => {
	assert.deepEqual(buildCommanderExecuteSegments('   \n\t'), []);
});
