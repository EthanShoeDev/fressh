import { scheduleTask } from '@effect/atom-react';
import * as AtomRegistry from 'effect/unstable/reactivity/AtomRegistry';

/**
 * The app's single atom registry — state atoms (ssh-store, terminal-semantics,
 * the host-key prompt queue) live here alongside the async atoms.
 *
 * Owned by us (instead of atom-react's module-default registry) so
 * non-React code — the SSH event plane, Effect programs, stream sources — can
 * read/write/subscribe imperatively to the SAME instance the hooks use.
 * `_layout.tsx` supplies it to React through `RegistryContext.Provider`.
 * Options mirror atom-react's default registry.
 */
export const atomRegistry = AtomRegistry.make({
	scheduleTask,
	defaultIdleTTL: 400,
});
