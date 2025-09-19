/**
 * This scripts finds and collects aall turbo.jsonc files in the repo.
 * It iterates over those and grabs the "scripts" section of each package.json
 *
 * It aggregates the results and prints them out in a human readable format.
 */
import * as fsp from 'fs/promises';
import { globby } from 'globby';
import path from 'path';

console.log('Turbo tasks report');
console.log('--------------------------------');
async function main() {
	const turboJsonFiles = await globby('**/turbo.jsonc');

	const reportParts: string[] = [];

	for (const turboJsonFile of turboJsonFiles) {
		reportParts.push(`Turbo config: ${turboJsonFile}`);
		reportParts.push('--------------------------------');

		const turboConfigContents = await fsp.readFile(turboJsonFile, 'utf-8');
		reportParts.push(turboConfigContents);
		const relativePackageJson = path.join(turboJsonFile, '..', 'package.json');
		reportParts.push(`Package json scripts: ${relativePackageJson}`);
		reportParts.push('--------------------------------');
		const packageJson = await fsp.readFile(relativePackageJson, 'utf-8');
		const packageJsonObject = JSON.parse(packageJson);
		const scripts = packageJsonObject.scripts;
		reportParts.push(JSON.stringify(scripts, null, 2));
		reportParts.push('--------------------------------');
	}

	const report = reportParts.join('\n');
	console.log(report);
}

void main();
