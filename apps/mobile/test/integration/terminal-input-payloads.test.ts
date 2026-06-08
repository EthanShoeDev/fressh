import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildClipboardPasteSegments,
	buildClipboardPastePayload,
	buildCommanderExecuteSegments,
	buildTextEntryPastePayload,
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

void test('text entry paste payload captures history when text is sent', () => {
	const payload = buildTextEntryPastePayload('echo hi');

	assert.deepEqual(decodeSegments(payload.segments), ['echo hi', '\r']);
	assert.equal(payload.historyText, 'echo hi');
});

void test('text entry paste payload does not capture empty input', () => {
	assert.deepEqual(buildTextEntryPastePayload(''), {
		segments: [],
		historyText: null,
	});
});

void test('clipboard paste does not append Enter', () => {
	assert.deepEqual(decodeSegments(buildClipboardPasteSegments('echo hi')), [
		'echo hi',
	]);
});

void test('clipboard paste returns no payload for empty text', () => {
	assert.deepEqual(buildClipboardPasteSegments(''), []);
});

void test('clipboard paste payload never captures history', () => {
	const payload = buildClipboardPastePayload('echo hi');

	assert.deepEqual(decodeSegments(payload.segments), ['echo hi']);
	assert.equal(payload.historyText, null);
});

void test('clipboard paste payload does not capture empty input', () => {
	assert.deepEqual(buildClipboardPastePayload(''), {
		segments: [],
		historyText: null,
	});
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
