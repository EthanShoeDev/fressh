import { type ComponentProps, forwardRef, useMemo } from 'react';
import { PixelRatio } from 'react-native';
import { getHostComponent, type HybridRef } from 'react-native-nitro-modules';

import TerminalViewConfig from '../nitrogen/generated/shared/json/TerminalConfig.json';
import type { TerminalMethods, TerminalProps } from '../nitro/Terminal.nitro';

/** Ref handle for imperative methods on the native terminal view. */
export type TerminalRef = HybridRef<TerminalProps, TerminalMethods>;

/** Cursor shapes the renderer can draw (config override; see fressh-render). */
export type CursorStyle = 'block' | 'beam' | 'underline' | 'hollow';

/**
 * Friendly, logical-unit terminal config (the "assemble in RN, pass it" object).
 * The wrapper scales sizes by device pixel density and serializes to the native
 * `configJson` string prop. All fields optional — omitted ones use renderer
 * defaults. `colorScheme` names must match the Rust presets (see `ColorScheme::
 * by_name`): 'default' | 'solarizedDark' | 'solarizedLight' | 'dracula' |
 * 'gruvboxDark'.
 */
export interface TerminalRenderConfig {
	/** Font size in logical points. */
	fontSize?: number;
	/** Inner padding in logical points, applied to both axes. */
	padding?: number;
	cursorStyle?: CursorStyle;
	colorScheme?: string;
	/** Draw bold text using the bright color variants. */
	boldIsBright?: boolean;
}

/** Default font size (logical points) when `config.fontSize` is unset. */
const DEFAULT_FONT_PT = 16;

/** Serialize the friendly config to the native wire format (physical px). */
function buildConfigJson(config: TerminalRenderConfig | undefined) {
	const density = PixelRatio.get();
	const fontPt =
		config?.fontSize && config.fontSize > 0 ? config.fontSize : DEFAULT_FONT_PT;
	const padPt = config?.padding ?? 0;
	return JSON.stringify({
		fontSizePx: fontPt * density,
		paddingXPx: padPt * density,
		paddingYPx: padPt * density,
		cursorStyle: config?.cursorStyle ?? 'block',
		colorScheme: config?.colorScheme ?? 'default',
		boldIsBright: config?.boldIsBright ?? true,
	});
}

const NativeTerminal = getHostComponent<TerminalProps, TerminalMethods>(
	'Terminal',
	() => TerminalViewConfig,
);

/** Props for the JS `<Terminal>` wrapper: the native component's props (incl. RN
 * view props like `style`) minus the wire `configJson`, plus the friendly `config`
 * object. */
export type TerminalComponentProps = Omit<
	ComponentProps<typeof NativeTerminal>,
	'configJson'
> & {
	config?: TerminalRenderConfig;
};

/**
 * Native terminal view (Nitro HybridView). Renders the durable `Term` that
 * fressh-core keeps for `shellId`. Accepts standard RN view props (e.g. `style`)
 * and a `config` object that is scaled + serialized to the renderer.
 */
export const Terminal = forwardRef<TerminalRef, TerminalComponentProps>(
	function Terminal({ config, ...props }, ref) {
		const configJson = useMemo(
			() => buildConfigJson(config),
			[
				config?.fontSize,
				config?.padding,
				config?.cursorStyle,
				config?.colorScheme,
				config?.boldIsBright,
			],
		);
		// The runtime ref is the Nitro HybridRef (TerminalRef); the host-component's
		// TS ref type is looser, so cast to keep the public contract.
		return (
			<NativeTerminal ref={ref as never} {...props} configJson={configJson} />
		);
	},
);
