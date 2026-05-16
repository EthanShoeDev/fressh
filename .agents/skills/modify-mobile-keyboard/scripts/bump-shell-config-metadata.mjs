#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.env.FRESSH_REPO || process.cwd();
let configPath = path.join(repoRoot, 'apps/mobile/config/shell-config.json');
let explicitTime = null;

for (let index = 2; index < process.argv.length; index += 1) {
	const arg = process.argv[index];
	if (arg === '--time') {
		explicitTime = process.argv[index + 1];
		index += 1;
	} else if (arg === '--config') {
		configPath = path.resolve(process.argv[index + 1]);
		index += 1;
	} else {
		throw new Error(`Unknown argument: ${arg}`);
	}
}

const now = explicitTime ? new Date(explicitTime) : new Date();
if (Number.isNaN(now.getTime())) {
	throw new Error(`Invalid --time value: ${explicitTime}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const datePrefix = now.toISOString().slice(0, 10);
const currentVersion = String(config.version || '');
const prefix = `${datePrefix}.`;
let suffix = 1;

if (currentVersion.startsWith(prefix)) {
	const currentSuffix = Number.parseInt(currentVersion.slice(prefix.length), 10);
	if (Number.isInteger(currentSuffix) && currentSuffix > 0) {
		suffix = currentSuffix + 1;
	}
}

config.version = `${datePrefix}.${suffix}`;
config.updatedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`version=${config.version}`);
console.log(`updatedAt=${config.updatedAt}`);
