import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

function collectSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			files.push(...collectSourceFiles(path));
			continue;
		}
		if (/\.(ts|tsx)$/.test(path)) files.push(path);
	}
	return files;
}

void test('mobile app command code does not call direct tmux helpers', () => {
	const root = resolve(import.meta.dirname, '../../src');
	const directMuxBoundary = 'lib/workmux-direct-tmux-control.ts';
	const forbidden = [
		{ pattern: /\btmux\s+display-message\b/, boundaryAllowed: false },
		{ pattern: /\btmux\s+send-keys\b/, boundaryAllowed: true },
		{ pattern: /\btmux\s+copy-mode\b/, boundaryAllowed: true },
		{ pattern: /\binvoke-rc\.bash\b/, boundaryAllowed: false },
	];
	const offenders: string[] = [];

	for (const file of collectSourceFiles(root)) {
		const source = readFileSync(file, 'utf8');
		const relativePath = relative(root, file);
		for (const { pattern, boundaryAllowed } of forbidden) {
			if (!pattern.test(source)) continue;
			if (boundaryAllowed && relativePath === directMuxBoundary) continue;
			offenders.push(`${file}: ${pattern}`);
		}
	}

	assert.deepEqual(offenders, []);
});
