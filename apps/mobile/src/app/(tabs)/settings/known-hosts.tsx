import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { Section } from '@/components/settings-controls';
import { Button } from '@/components/themed/Button';
import { ThemedText } from '@/components/themed/ThemedText';
import { revokeHost, useKnownHosts } from '@/lib/host-keys';
import { hostPortLabel, type KnownHostEntry } from '@/lib/known-hosts';
import { appRuntime } from '@/lib/runtime';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';

/**
 * Settings → Security → Known hosts: every host key the user has trusted
 * (TOFU pins from lib/host-keys.ts), grouped by host:port, with revoke —
 * the mobile `ssh-keygen -R`. Revoking just re-prompts on the next connect,
 * so there's no confirm step (matching the Keys tab's immediate delete).
 *
 * No Native/Custom split: two-line mono fingerprint rows don't map onto the
 * @expo/ui form primitives, so the list renders in RN cards under every theme
 * (the precedent set by the theme grid on the settings root).
 */
export default function KnownHostsSettings() {
	const entries = useKnownHosts();
	const bottomSpace = useBottomTabSpacing();

	// Group per host:port — a host can be pinned under several algorithms.
	const groups = useMemo(() => {
		const byTarget = new Map<
			string,
			{ host: string; port: number; entries: KnownHostEntry[] }
		>();
		for (const entry of entries) {
			const label = hostPortLabel(entry.host, entry.port);
			const group = byTarget.get(label) ?? {
				host: entry.host,
				port: entry.port,
				entries: [],
			};
			group.entries.push(entry);
			byTarget.set(label, group);
		}
		return [...byTarget.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [entries]);

	if (groups.length === 0) {
		return (
			<View className='flex-1 items-center justify-center bg-background p-8'>
				<ThemedText className='text-center text-base text-muted'>
					No known hosts yet — servers you trust will appear here.
				</ThemedText>
			</View>
		);
	}

	return (
		<View className='flex-1 bg-background'>
			<ScrollView
				className='flex-1'
				contentContainerClassName='p-4'
				contentContainerStyle={{ paddingBottom: bottomSpace + 16 }}
			>
				{groups.map(([label, group]) => (
					<Section key={label} title={label}>
						<View className='gap-2'>
							{group.entries.map((entry) => (
								<KnownHostCard
									key={`${entry.algorithm}:${entry.fingerprintSha256}`}
									entry={entry}
								/>
							))}
							<Button
								size='sm'
								variant='danger'
								title='Revoke'
								onPress={() => {
									appRuntime.runSync(revokeHost(group.host, group.port));
								}}
							/>
						</View>
					</Section>
				))}
			</ScrollView>
		</View>
	);
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

function KnownHostCard({ entry }: { entry: KnownHostEntry }) {
	return (
		<View className='rounded-[10px] border border-border bg-surface px-3 py-3'>
			<ThemedText className='text-base font-semibold text-text-primary'>
				{entry.algorithm}
			</ThemedText>
			<ThemedText mono selectable className='mt-1 text-xs leading-5 text-muted'>
				{entry.fingerprintSha256}
			</ThemedText>
			{entry.trustedAtMs > 0 ? (
				<ThemedText className='mt-1 text-xs text-text-secondary'>
					Trusted {formatTrusted(entry.trustedAtMs)}
				</ThemedText>
			) : null}
		</View>
	);
}
