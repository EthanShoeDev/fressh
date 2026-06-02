import type { HybridRef } from 'react-native-nitro-modules';
import type {
	TerminalMethods,
	TerminalProps,
} from '../nitro/Terminal.nitro';

// TODO(scaffold): once `nitro-codegen` runs, wire the real host component:
//
//   import { getHostComponent } from 'react-native-nitro-modules';
//   import TerminalConfig from '../nitrogen/generated/shared/json/TerminalConfig.json';
//   export const Terminal = getHostComponent<TerminalProps, TerminalMethods>(
//       'Terminal',
//       () => TerminalConfig,
//   );
//
// Until then this is a typed placeholder so the public API shape is reviewable.

export type TerminalRef = HybridRef<TerminalProps, TerminalMethods>;

export const Terminal = (_props: TerminalProps): null => {
	throw new Error(
		'@fressh/react-native-terminal: native view not built yet (run nitro-codegen + the umbrella native build). See docs/projects/native-rendering-refactor.md §10.',
	);
};
