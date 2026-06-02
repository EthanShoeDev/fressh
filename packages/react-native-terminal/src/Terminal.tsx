import { getHostComponent, type HybridRef } from 'react-native-nitro-modules';

import TerminalConfig from '../nitrogen/generated/shared/json/TerminalConfig.json';
import type { TerminalMethods, TerminalProps } from '../nitro/Terminal.nitro';

/** Ref handle for imperative methods on the native terminal view. */
export type TerminalRef = HybridRef<TerminalProps, TerminalMethods>;

/**
 * Native terminal view (Nitro HybridView). Renders a hardcoded demo terminal
 * from the bundled font at `fontPath` (PoC). Accepts standard RN view props
 * (e.g. `style`).
 */
export const Terminal = getHostComponent<TerminalProps, TerminalMethods>(
	'Terminal',
	() => TerminalConfig,
);
