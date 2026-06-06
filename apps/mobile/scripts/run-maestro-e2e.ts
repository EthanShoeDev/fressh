import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const APP_ID = 'com.finalapp.vibe2';
const DEFAULT_FLOW_PATH = 'test/e2e/';
const DEFAULT_ADB_SERVER_PORT = '5037';
const APP_DATA_WIPE_CONFIRMATION =
	'I_UNDERSTAND_THIS_DELETES_PRIVATE_KEYS';

export type AdbServerTarget = {
	host: string;
	port: string;
};

export type MaestroE2eEnv = Record<string, string | undefined> & {
	ADB_SERVER_SOCKET?: string;
	FRESSH_ALLOW_APP_DATA_WIPE?: string;
	MAESTRO_E2E_CLEAR_STATE?: string;
	MAESTRO_E2E_PREP?: string;
	MAESTRO_HOST?: string;
};

type ResolvedAdbServerTarget = {
	source: 'adb-server-socket' | 'maestro-host';
	target: AdbServerTarget;
};

export function parseAdbServerSocket(
	socket: string | undefined,
): AdbServerTarget | null {
	if (!socket) return null;
	const match = /^tcp:([^:]+):(\d+)$/.exec(socket);
	if (!match) return null;
	const [, host, port] = match;
	if (!host || !port) return null;
	return { host, port };
}

export function parseMaestroHost(
	host: string | undefined,
): AdbServerTarget | null {
	if (!host) return null;
	const match = /^([^:]+)(?::(\d+))?$/.exec(host);
	if (!match) return null;
	const [, targetHost, targetPort] = match;
	if (!targetHost) return null;
	return { host: targetHost, port: targetPort ?? DEFAULT_ADB_SERVER_PORT };
}

export function resolveAdbServerTarget(
	env: MaestroE2eEnv,
): ResolvedAdbServerTarget | null {
	const maestroHost = parseMaestroHost(env.MAESTRO_HOST);
	if (maestroHost) {
		return { source: 'maestro-host', target: maestroHost };
	}
	const adbServerSocket = parseAdbServerSocket(env.ADB_SERVER_SOCKET);
	if (!adbServerSocket) return null;
	return { source: 'adb-server-socket', target: adbServerSocket };
}

export function buildAdbTargetArgs(
	resolvedTarget: ResolvedAdbServerTarget | null,
): string[] {
	if (!resolvedTarget) return [];
	return ['-H', resolvedTarget.target.host, '-P', resolvedTarget.target.port];
}

export function buildMaestroEnv(
	env: MaestroE2eEnv,
	resolvedTarget: ResolvedAdbServerTarget | null,
): MaestroE2eEnv {
	if (!resolvedTarget) return env;
	return {
		...env,
		ADB_SERVER_SOCKET: `tcp:${resolvedTarget.target.host}:${resolvedTarget.target.port}`,
	};
}

export function buildMaestroArgs(flowArgs: string[]): string[] {
	return ['test', ...(flowArgs.length > 0 ? flowArgs : [DEFAULT_FLOW_PATH])];
}

export function shouldStartMaestroAdbProxy(
	resolvedTarget: ResolvedAdbServerTarget | null,
): boolean {
	if (!resolvedTarget) return false;
	const { host, port } = resolvedTarget.target;
	if (port !== DEFAULT_ADB_SERVER_PORT) return true;
	return !['127.0.0.1', '::1', 'localhost'].includes(host);
}

export function getAppDataWipeError(env: MaestroE2eEnv): string | null {
	if (env.MAESTRO_E2E_CLEAR_STATE !== '1') return null;
	if (env.FRESSH_ALLOW_APP_DATA_WIPE === APP_DATA_WIPE_CONFIRMATION) {
		return null;
	}
	return [
		'Refusing to clear app data for com.finalapp.vibe2.',
		'This deletes private keys, saved hosts, and other local app state.',
		'To run this destructive e2e reset intentionally, set:',
		`FRESSH_ALLOW_APP_DATA_WIPE=${APP_DATA_WIPE_CONFIRMATION}`,
	].join('\n');
}

function run(
	command: string,
	args: string[],
	opts?: { env?: MaestroE2eEnv; optional?: boolean },
) {
	const result = spawnSync(command, args, {
		env: opts?.env as NodeJS.ProcessEnv | undefined,
		stdio: opts?.optional ? 'ignore' : 'inherit',
	});
	if (result.status === 0) return;
	if (opts?.optional) return;
	process.exit(result.status ?? 1);
}

export function buildLocalAdbEnv(
	env: MaestroE2eEnv = process.env,
): MaestroE2eEnv {
	const nextEnv = { ...env };
	delete nextEnv.ADB_SERVER_SOCKET;
	delete nextEnv.ANDROID_ADB_SERVER_ADDRESS;
	delete nextEnv.ANDROID_ADB_SERVER_PORT;
	return nextEnv;
}

function startMaestroAdbProxy(
	resolvedTarget: ResolvedAdbServerTarget | null,
): ChildProcess | null {
	if (!shouldStartMaestroAdbProxy(resolvedTarget)) return null;
	if (!resolvedTarget) return null;

	const socatCheck = spawnSync('socat', ['-V'], { stdio: 'ignore' });
	if (socatCheck.status !== 0) {
		throw new Error(
			'Remote ADB e2e requires socat to proxy the host ADB server for Maestro.',
		);
	}

	run('adb', ['kill-server'], { env: buildLocalAdbEnv(), optional: true });
	const proxy = spawn(
		'socat',
		[
			`TCP-LISTEN:${DEFAULT_ADB_SERVER_PORT},bind=127.0.0.1,fork,reuseaddr`,
			`TCP:${resolvedTarget.target.host}:${resolvedTarget.target.port}`,
		],
		{ stdio: 'ignore' },
	);
	spawnSync('sleep', ['0.2'], { stdio: 'ignore' });
	if (proxy.exitCode !== null) {
		throw new Error('Failed to start local ADB proxy for Maestro.');
	}
	return proxy;
}

function stopMaestroAdbProxy(proxy: ChildProcess | null) {
	if (!proxy || proxy.killed) return;
	proxy.kill();
}

export function runMaestroE2e(
	env: MaestroE2eEnv = process.env,
	flowArgs: string[] = process.argv.slice(2),
) {
	const appDataWipeError = getAppDataWipeError(env);
	if (appDataWipeError) {
		console.error(appDataWipeError);
		process.exit(1);
	}

	const resolvedTarget = resolveAdbServerTarget(env);
	const adbTargetArgs = buildAdbTargetArgs(resolvedTarget);
	const maestroEnv = buildMaestroEnv(env, resolvedTarget);
	const maestroAdbProxy = startMaestroAdbProxy(resolvedTarget);

	try {
		if (env.MAESTRO_E2E_CLEAR_STATE === '1') {
			run('adb', [...adbTargetArgs, 'shell', 'am', 'force-stop', APP_ID], {
				optional: true,
			});
			run('adb', [...adbTargetArgs, 'shell', 'pm', 'clear', APP_ID]);
			run(
				'adb',
				[
					...adbTargetArgs,
					'shell',
					'pm',
					'grant',
					APP_ID,
					'android.permission.POST_NOTIFICATIONS',
				],
				{ optional: true },
			);
		} else if (env.MAESTRO_E2E_PREP !== '0') {
			run('adb', [...adbTargetArgs, 'shell', 'am', 'force-stop', APP_ID], {
				optional: true,
			});
		}

		run('maestro', buildMaestroArgs(flowArgs), { env: maestroEnv });
	} finally {
		stopMaestroAdbProxy(maestroAdbProxy);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	runMaestroE2e();
}
