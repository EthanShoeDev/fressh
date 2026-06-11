import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as References from 'effect/References';
import { KnownHosts } from './host-keys';

/**
 * The app's Effect runtime and the service layers behind it.
 *
 * Effect code logs natively (`yield* Effect.logInfo(...)`, with a module
 * annotation via `Effect.annotateLogs`); plain boundaries (React handlers,
 * the SSH event plane) run their Effect programs through {@link appRuntime}.
 * The effect-atom runtime in `secrets-manager.ts` is built from the same
 * {@link appLayer}, so atoms see the same services and logging. App state
 * lives in atoms on the shared registry (see `lib/atom-registry.ts`).
 *
 * Service layers merge into {@link appLayer}; add new services here.
 */

const LoggerLayer = Layer.mergeAll(
	Logger.layer([Logger.consolePretty()]),
	Layer.succeed(References.MinimumLogLevel, 'Debug'),
);

export const appLayer = Layer.mergeAll(LoggerLayer, KnownHosts.layer);

/** Builds synchronously, so `runSync` is safe from module scope onward. */
export const appRuntime = ManagedRuntime.make(appLayer);
