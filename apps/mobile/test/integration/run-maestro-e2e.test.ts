import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import {
	buildLocalAdbEnv,
	buildAdbTargetArgs,
	buildMaestroArgs,
	buildMaestroEnv,
	getAppDataWipeError,
	parseAdbServerSocket,
	parseMaestroHost,
	resolveAdbServerTarget,
	shouldStartMaestroAdbProxy,
} from '../../scripts/run-maestro-e2e';

const packageJson = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('../../package.json', import.meta.url)),
		'utf8',
	),
) as { scripts?: Record<string, string> };

void test('ADB_SERVER_SOCKET preserves non-default ADB host and port', () => {
	const resolved = resolveAdbServerTarget({
		ADB_SERVER_SOCKET: 'tcp:100.69.79.32:5038',
	});

	assert.deepEqual(resolved, {
		source: 'adb-server-socket',
		target: { host: '100.69.79.32', port: '5038' },
	});
	assert.deepEqual(buildAdbTargetArgs(resolved), [
		'-H',
		'100.69.79.32',
		'-P',
		'5038',
	]);
});

void test('MAESTRO_HOST keeps override semantics and defaults to the ADB port', () => {
	const resolved = resolveAdbServerTarget({
		ADB_SERVER_SOCKET: 'tcp:100.69.79.32:5038',
		MAESTRO_HOST: '100.88.0.10',
	});

	assert.deepEqual(resolved, {
		source: 'maestro-host',
		target: { host: '100.88.0.10', port: '5037' },
	});
	assert.equal(
		buildMaestroEnv({}, resolved).ADB_SERVER_SOCKET,
		'tcp:100.88.0.10:5037',
	);
});

void test('MAESTRO_HOST may include a non-default port', () => {
	const resolved = resolveAdbServerTarget({
		MAESTRO_HOST: '100.88.0.10:5041',
	});

	assert.deepEqual(resolved, {
		source: 'maestro-host',
		target: { host: '100.88.0.10', port: '5041' },
	});
	assert.deepEqual(buildAdbTargetArgs(resolved), [
		'-H',
		'100.88.0.10',
		'-P',
		'5041',
	]);
});

void test('remote ADB targets require a local Maestro proxy', () => {
	assert.equal(
		shouldStartMaestroAdbProxy({
			source: 'adb-server-socket',
			target: { host: '100.69.79.32', port: '5037' },
		}),
		true,
	);
	assert.equal(
		shouldStartMaestroAdbProxy({
			source: 'adb-server-socket',
			target: { host: '127.0.0.1', port: '5037' },
		}),
		false,
	);
	assert.equal(
		shouldStartMaestroAdbProxy({
			source: 'adb-server-socket',
			target: { host: 'localhost', port: '5041' },
		}),
		true,
	);
});

void test('local ADB cleanup does not inherit remote ADB server env', () => {
	assert.deepEqual(
		buildLocalAdbEnv({
			ADB_SERVER_SOCKET: 'tcp:100.69.79.32:5037',
			ANDROID_ADB_SERVER_ADDRESS: '100.69.79.32',
			ANDROID_ADB_SERVER_PORT: '5037',
			PATH: '/usr/bin',
		}),
		{ PATH: '/usr/bin' },
	);
});

void test('Maestro command does not pass an unsupported host flag', () => {
	assert.deepEqual(buildMaestroArgs([]), ['test', 'test/e2e/']);
	assert.deepEqual(buildMaestroArgs(['test/e2e/ConnectToDemoServer.yml']), [
		'test',
		'test/e2e/ConnectToDemoServer.yml',
	]);
	assert.equal(buildMaestroArgs([]).includes('--host'), false);
});

void test('default package e2e script preserves app data', () => {
	assert.doesNotMatch(
		packageJson.scripts?.['test:e2e'] ?? '',
		/\bMAESTRO_E2E_CLEAR_STATE=1\b/,
	);
});

void test('clear-state e2e script requires explicit private-key wipe confirmation', () => {
	const script = packageJson.scripts?.['test:e2e:clear-state'] ?? '';
	assert.match(script, /\bMAESTRO_E2E_CLEAR_STATE=1\b/);
	assert.match(
		script,
		/\bFRESSH_ALLOW_APP_DATA_WIPE=I_UNDERSTAND_THIS_DELETES_PRIVATE_KEYS\b/,
	);
});

void test('clear-state request without confirmation is rejected before adb clear', () => {
	assert.match(
		getAppDataWipeError({ MAESTRO_E2E_CLEAR_STATE: '1' }) ?? '',
		/deletes private keys/,
	);
});

void test('clear-state request with explicit confirmation is allowed', () => {
	assert.equal(
		getAppDataWipeError({
			MAESTRO_E2E_CLEAR_STATE: '1',
			FRESSH_ALLOW_APP_DATA_WIPE:
				'I_UNDERSTAND_THIS_DELETES_PRIVATE_KEYS',
		}),
		null,
	);
});

void test('invalid ADB target strings are ignored', () => {
	assert.equal(parseAdbServerSocket(undefined), null);
	assert.equal(parseAdbServerSocket('localhost:5037'), null);
	assert.equal(parseAdbServerSocket('tcp:100.69.79.32'), null);
	assert.equal(parseMaestroHost(undefined), null);
	assert.equal(parseMaestroHost(''), null);
});
