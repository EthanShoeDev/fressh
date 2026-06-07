import {
	closePreviewTerm,
	createPreviewTerm,
	Terminal,
} from '@fressh/react-native-terminal';
import { useEffect } from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/themed/ThemedText';
import { useTerminalRenderConfig } from '@/lib/preferences';

/** Reserved shell id for the settings preview. Can't collide with a real shell id
 *  (`connectionId:channelId`). */
const PREVIEW_ID = '__preview__';

// Canned shell output that exercises the palette so changing any Terminal setting
// shows a representative result: a colored prompt, an `ls --color` listing (dirs
// blue, executables green), a `git status` (green staged / red deleted), a row of
// bright/dim swatches, bold text (so "bold is bright" is visibly demonstrated), and
// the cursor parked at a fresh prompt. ASCII-only so each char is one byte.
const ESC = '\u001B'; // the SGR escape char (0x1b)
const DEMO = [
	`${ESC}[1;32muser@phone${ESC}[0m:${ESC}[1;34m~/code${ESC}[0m$ ls`,
	`${ESC}[1;34msrc${ESC}[0m  ${ESC}[1;34mnode_modules${ESC}[0m  ${ESC}[1;32mbuild.sh${ESC}[0m  README.md`,
	`${ESC}[1;32muser@phone${ESC}[0m:${ESC}[1;34m~/code${ESC}[0m$ git status`,
	`${ESC}[32m  staged:  app.ts${ESC}[0m   ${ESC}[31m  deleted: old.ts${ESC}[0m`,
	`${ESC}[90mdim ${ESC}[96mcyan ${ESC}[95mmagenta ${ESC}[93myellow ${ESC}[91mred${ESC}[0m`,
	`${ESC}[1;32muser@phone${ESC}[0m:${ESC}[1;34m~/code${ESC}[0m$ `,
].join('\r\n');

// Built once at module load (read-only; reused across mounts). ASCII → one byte
// per char, so the code point IS the byte.
const DEMO_BYTES = Uint8Array.from(DEMO, (ch) => ch.codePointAt(0) ?? 0).buffer;

/**
 * A small live preview of the terminal, fed a canned snippet so the user sees what
 * their color-scheme / font-size / padding / cursor / bold-is-bright choices look
 * like *as they change them*. It's a real native `<Terminal>` bound to a non-SSH
 * preview shell, so the live `config` reflows it exactly like a session would — the
 * whole point being fidelity to the real renderer.
 *
 * Shows the **terminal** palette only; it is independent of the app's UI theme
 * (phosphor/graphite/aurora/monolith) — see the caption.
 */
export function TerminalPreview() {
	const config = useTerminalRenderConfig();

	useEffect(() => {
		// Create on mount, tear down on unmount. Config changes do NOT re-create the
		// term — they flow through the `<Terminal config>` prop and reflow natively.
		createPreviewTerm(PREVIEW_ID, DEMO_BYTES);
		return () => {
			void closePreviewTerm(PREVIEW_ID);
		};
	}, []);

	return (
		<View>
			<View className='h-44 overflow-hidden rounded-[10px] border border-border'>
				<Terminal
					shellId={PREVIEW_ID}
					fontPath=''
					config={config}
					style={{ flex: 1 }}
				/>
			</View>
			<ThemedText className='mt-1.5 text-xs text-text-secondary'>
				Live preview — shows the terminal palette, not the app theme.
			</ThemedText>
		</View>
	);
}
