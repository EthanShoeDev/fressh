import { format } from 'date-fns';
import * as Arr from 'effect/Array';
import * as Str from 'effect/String';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { Section } from '@/components/settings-controls';
import { Button } from '@/components/themed/button';
import { ThemedScreen } from '@/components/themed/themed-screen';
import { ThemedText } from '@/components/themed/themed-text';
import { revokeHost, useKnownHosts } from '@/lib/host-keys';
import { hostPortLabel, type KnownHostEntry } from '@/lib/known-hosts';
import { appRuntime } from '@/lib/runtime';
import { useBottomTabSpacing } from '@/lib/use-bottom-tab-spacing';

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
    return [...byTarget.entries()].sort(([a], [b]) => Str.localeCompare(b)(a));
  }, [entries]);

  if (groups.length === 0) {
    return (
      <ThemedScreen edges={[]}>
        <View className='flex-1 items-center justify-center p-8'>
          <ThemedText className='text-center text-base text-muted'>
            No known hosts yet — servers you trust will appear here.
          </ThemedText>
        </View>
      </ThemedScreen>
    );
  }

  return (
    <ThemedScreen edges={[]}>
      <ScrollView
        className='flex-1'
        contentContainerClassName='p-4'
        contentContainerStyle={{ paddingBottom: bottomSpace + 16 }}
      >
        {Arr.map(groups, ([label, group]) => (
          <Section key={label} title={label}>
            <View className='gap-2'>
              {Arr.map(group.entries, (entry) => (
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
    </ThemedScreen>
  );
}

/** "Mar 4, 2026" — date-fns' built-in en-US tokens, so no reliance on Hermes Intl. */
function formatTrusted(ms: number) {
  return format(ms, 'MMM d, yyyy');
}

function KnownHostCard({ entry }: { entry: KnownHostEntry }) {
  return (
    <View className='bg-surface rounded-[10px] border border-border px-3 py-3'>
      <ThemedText className='text-text-primary text-base font-semibold'>
        {entry.algorithm}
      </ThemedText>
      <ThemedText mono selectable className='mt-1 text-xs leading-5 text-muted'>
        {entry.fingerprintSha256}
      </ThemedText>
      {entry.trustedAtMs > 0 ? (
        <ThemedText className='text-text-secondary mt-1 text-xs'>
          Trusted {formatTrusted(entry.trustedAtMs)}
        </ThemedText>
      ) : null}
    </View>
  );
}
