import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
	const forbidden = [
		/\btmux\s+display-message\b/,
		/\btmux\s+send-keys\b/,
		/\btmux\s+copy-mode\b/,
		/\binvoke-rc\.bash\b/,
	];
	const offenders: string[] = [];

	for (const file of collectSourceFiles(root)) {
		const source = readFileSync(file, 'utf8');
		for (const pattern of forbidden) {
			if (pattern.test(source)) offenders.push(`${file}: ${pattern}`);
		}
	}

	assert.deepEqual(offenders, []);
});
