import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseShellConfigString } from '../src/lib/shell-config';

const targetPath =
	process.argv[2] ??
	path.resolve(
		import.meta.dirname,
		'../config/shell-config.json',
	);

try {
	const config = parseShellConfigString(readFileSync(targetPath, 'utf8'));
	console.log(
		`Valid shell config ${config.version} (${config.updatedAt}) from ${targetPath}`,
	);
} catch (error) {
	console.error(
		error instanceof Error ? error.message : 'Shell config validation failed.',
	);
	process.exitCode = 1;
}
