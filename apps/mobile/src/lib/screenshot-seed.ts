/**
 * Demo data seeding for marketing screenshots.
 *
 * Every tab is empty on a fresh `clearState` launch, which makes for dull
 * screenshots. When a build is made with `EXPO_PUBLIC_SCREENSHOT_SEED=1` (see
 * `scripts/screenshots.ts`), `_layout.tsx` calls {@link seedScreenshotData} once
 * at startup to pre-populate the Servers and Commands tabs with plausible demo
 * content. The flag is build-time only and is never set for production builds, so
 * this module is dead code in every shipped app.
 *
 * Keys are intentionally NOT seeded here — the Maestro flow taps "Generate" so the
 * Keys screenshot shows a real ed25519 key without committing a fake private key
 * to the repo.
 *
 * Note on reactivity: presets are stored in MMKV and read through reactive hooks,
 * so seeded presets appear immediately. The connections list is an effect-atom
 * query that does NOT auto-refresh on a non-atom write, so the screenshot flow is
 * ordered to capture the Servers tab only after the live demo connection fires a
 * CONNECTIONS reactivity invalidation (which re-reads the keychain and surfaces
 * these seeded servers too).
 */
import * as Effect from 'effect/Effect';
import { addPreset, getPresets } from './presets';
import { secretsManager } from './secrets-manager';

/** True when this build was made with the screenshot seed flag. */
export const SCREENSHOT_SEED_ENABLED =
	process.env.EXPO_PUBLIC_SCREENSHOT_SEED === '1';

const DEMO_SERVERS = [
	{
		label: 'Production Web',
		host: 'prod-web-01.example.com',
		port: 22,
		username: 'deploy',
	},
	{
		label: 'Database',
		host: 'db.internal.example.com',
		port: 2222,
		username: 'postgres',
	},
	{
		label: 'Raspberry Pi',
		host: 'pi.local',
		port: 22,
		username: 'pi',
	},
] as const;

const DEMO_PRESETS = [
	{ label: 'git status', command: 'git status -sb', autoRun: true },
	{ label: 'disk usage', command: 'df -h', autoRun: true },
	{ label: 'tail logs', command: 'tail -n 50 /var/log/syslog', autoRun: false },
] as const;

/**
 * Pre-populate demo servers + command presets. Safe to run unconditionally — it
 * no-ops unless {@link SCREENSHOT_SEED_ENABLED}. Idempotent: servers upsert by
 * deterministic id, and presets are only seeded when none exist yet.
 * `_layout.tsx` forks this on the app runtime at startup.
 */
export const seedScreenshotData = Effect.gen(function* () {
	if (!SCREENSHOT_SEED_ENABLED) return;

	yield* Effect.logInfo('Seeding demo data for screenshots');

	yield* Effect.forEach(
		DEMO_SERVERS,
		(server, index) =>
			secretsManager.connections.utils.upsertConnection({
				details: {
					host: server.host,
					port: server.port,
					username: server.username,
					security: { type: 'password', password: 'demo-password' },
				},
				// Higher priority sorts first; keep the array order in the list.
				priority: DEMO_SERVERS.length - index,
				label: server.label,
			}),
		{ concurrency: 'unbounded' },
	);

	if (getPresets().length === 0) {
		for (const preset of DEMO_PRESETS) addPreset(preset);
	}

	yield* Effect.logInfo('Demo data seeded');
}).pipe(
	Effect.catch((error) => Effect.logError('Failed to seed demo data', error)),
	Effect.annotateLogs({ module: 'ScreenshotSeed' }),
);
