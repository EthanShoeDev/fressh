import React from 'react';
import { BackHandler, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/themed/Button';
import { ThemedText } from '@/components/themed/ThemedText';
import { useAtomValue } from '@effect/atom-react';
import {
	hostKeyPromptHeadAtom,
	type PendingHostKey,
	resolveHostKeyPrompt,
} from '@/lib/host-keys';
import { hostPortLabel } from '@/lib/known-hosts';
import { appRuntime } from '@/lib/runtime';
import { useThemeSkin } from '@/lib/theme-skin';

/**
 * The global host-key trust prompt (TOFU). Mounted once near the app root so
 * every connect path — connect form, reconnect, the Commands-tab one-off
 * runner — gets the same dialog with no per-call wiring. Renders the head of
 * the prompt queue; answering (or the connection dying) reveals the next.
 *
 * NOT an RN `Modal` on purpose: iOS presents one modal VC at a time, and a
 * connect always has one up already (the connect form's ConnectingOverlay, or
 * the command runner's BottomSheet) — a second `Modal` here is silently
 * dropped ("Attempt to present ... which is already presenting"), the user
 * never sees the prompt, and the connection parks forever. So this renders as
 * an absolute in-tree overlay above the root `<Stack/>`, and those two modals
 * hide themselves while a prompt is pending (they subscribe to the queue) so
 * they can't cover it.
 *
 * A deliberate centered dialog: the scrim is inert and only an explicit button
 * press answers, so a stray tap can't silently trust (or abort) a connection.
 * Android back rejects.
 */
export function HostKeyPrompt() {
	const head = useAtomValue(hostKeyPromptHeadAtom);
	if (!head) {
		return null;
	}
	// Keyed by connectionId so per-prompt state (the double-tap guard) resets.
	return <HostKeyDialog key={head.connectionId} pending={head} />;
}

const MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

/** "Mar 4, 2026" — avoids leaning on Hermes Intl for a tiny, predictable label. */
function formatTrusted(ms: number) {
	const d = new Date(ms);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function HostKeyDialog({ pending }: { pending: PendingHostKey }) {
	const skin = useThemeSkin();
	const surface = useCSSVariable('--color-surface') as string;
	const border = useCSSVariable('--color-border-strong') as string;
	const danger = useCSSVariable('--color-danger') as string;
	const answeredRef = React.useRef(false);

	const { info, verdict, prior } = pending;
	const changed = verdict === 'changed';

	const answer = React.useCallback(
		(accept: boolean) => {
			if (answeredRef.current) {
				return;
			}
			answeredRef.current = true;
			appRuntime.runSync(resolveHostKeyPrompt(pending.connectionId, accept));
		},
		[pending.connectionId],
	);

	// Hardware back rejects (the safe default) — there's no Modal supplying
	// `onRequestClose` anymore.
	React.useEffect(() => {
		const sub = BackHandler.addEventListener('hardwareBackPress', () => {
			answer(false);
			return true;
		});
		return () => sub.remove();
	}, [answer]);

	return (
		<View className='absolute inset-0 z-50 items-center justify-center p-6'>
			{/* Inert scrim: a security decision needs an explicit button press. */}
			<View className='absolute inset-0 bg-overlay' />
			<View
				style={{
					backgroundColor: surface,
					borderColor: changed ? danger : border,
					borderWidth: changed ? 1.5 : 1,
					borderRadius: skin.radius,
				}}
				className='w-full gap-4 p-5'
			>
				<View>
					<ThemedText
						className={`text-lg font-bold ${changed ? 'text-danger' : 'text-text-primary'}`}
					>
						{changed ? '⚠ Server identity changed' : 'Verify new server'}
					</ThemedText>
					<ThemedText className='mt-1.5 text-[13px] leading-5 text-muted'>
						{changed
							? `The key offered by this server does not match the one you trusted${prior ? ` on ${formatTrusted(prior.trustedAtMs)}` : ''}. This can mean a man-in-the-middle attack, or that the server was reinstalled or rekeyed.`
							: 'This server isn’t in your known hosts yet. Check the fingerprint against one you trust before continuing.'}
					</ThemedText>
				</View>

				<View className='gap-1'>
					<ThemedText className='text-xs font-semibold uppercase text-text-secondary'>
						Server
					</ThemedText>
					<ThemedText mono selectable className='text-[13px] text-text-primary'>
						{hostPortLabel(info.host, info.port)}
						{info.remoteIp && info.remoteIp !== info.host
							? `  (${info.remoteIp})`
							: ''}
					</ThemedText>
				</View>

				{changed && prior ? (
					<>
						<Fingerprint
							label={`Previously trusted (${prior.algorithm})`}
							value={prior.fingerprintSha256}
							radius={skin.controlRadius}
							muted
						/>
						<Fingerprint
							label={`Offered now (${info.algorithm})`}
							value={info.fingerprintSha256}
							radius={skin.controlRadius}
							danger
						/>
					</>
				) : (
					<Fingerprint
						label={`Fingerprint (${info.algorithm})`}
						value={info.fingerprintSha256}
						radius={skin.controlRadius}
					/>
				)}

				{changed ? (
					<View className='flex-row gap-2.5'>
						{/* The safe default gets the prominent filled style. */}
						<Button
							className='flex-1'
							title='Reject'
							onPress={() => answer(false)}
						/>
						<Button
							className='flex-1'
							variant='danger'
							title='Trust new key'
							onPress={() => answer(true)}
						/>
					</View>
				) : (
					<View className='flex-row gap-2.5'>
						<Button
							className='flex-1'
							variant='outline'
							title='Reject'
							onPress={() => answer(false)}
						/>
						<Button
							className='flex-1'
							title='Trust'
							onPress={() => answer(true)}
						/>
					</View>
				)}
			</View>
		</View>
	);
}

function Fingerprint({
	label,
	value,
	radius,
	muted,
	danger,
}: {
	label: string;
	value: string;
	radius: number;
	muted?: boolean;
	danger?: boolean;
}) {
	return (
		<View className='gap-1'>
			<ThemedText className='text-xs font-semibold uppercase text-text-secondary'>
				{label}
			</ThemedText>
			<View
				className='px-3 py-2.5'
				style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: radius }}
			>
				<ThemedText
					mono
					selectable
					className={`text-xs leading-5 ${danger ? 'text-danger' : muted ? 'text-muted' : 'text-text-primary'}`}
				>
					{value}
				</ThemedText>
			</View>
		</View>
	);
}
