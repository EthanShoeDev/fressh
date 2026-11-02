import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Arr from 'effect/Array';
import { pipe } from 'effect/Function';
import * as Match from 'effect/Match';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import * as Str from 'effect/String';
import { useRouter } from 'expo-router';
import React from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { RenameDialog } from '@/components/rename-dialog';
import { Button } from '@/components/themed/button';
import { ScreenHeader } from '@/components/themed/screen-header';
import { ThemedScreen } from '@/components/themed/themed-screen';
import { ThemedText } from '@/components/themed/themed-text';
import { useSurfaceStyle } from '@/components/themed/use-surface-style';
import { secretsManager } from '@/lib/secrets-manager';
import {
  useServerLiveStatus,
  type ServerLiveStatus,
} from '@/lib/server-status';
import { applyCase, useThemeSkin } from '@/lib/theme-skin';
import { useBottomTabSpacing } from '@/lib/use-bottom-tab-spacing';

/**
 * Option-3 "Unified Servers" home. Saved connections lead, each card carrying
 * its live shell status; the old form-first Hosts screen moves behind the `+`
 * (the `connect` route). The whole screen takes on the active theme's character
 * via the skin (sharp edge-to-edge rows for Monolith, gradient canvas, etc.).
 */
export default function ServersScreen() {
  return (
    <ThemedScreen edges={['top']}>
      <ServersContent />
    </ThemedScreen>
  );
}

function ServersContent() {
  const router = useRouter();
  const skin = useThemeSkin();
  const marginBottom = useBottomTabSpacing();
  const primaryColor = useCSSVariable('--color-primary') as string;
  const mutedColor = useCSSVariable('--color-muted') as string;
  const [query, setQuery] = React.useState('');
  const listResult = useAtomValue(secretsManager.connections.atoms.list);
  const entries = AsyncResult.isSuccess(listResult) ? listResult.value : [];

  const needle = Str.toLowerCase(Str.trim(query));
  const filtered =
    needle === ''
      ? entries
      : Arr.filter(entries, (e) => Str.includes(needle)(Str.toLowerCase(e.id)));

  return (
    <View className='flex-1'>
      <ScreenHeader
        title='Servers'
        right={
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='New connection'
            onPress={() => router.push('/servers/connect')}
            hitSlop={8}
            className='bg-surface h-9 w-9 items-center justify-center border border-border'
            style={{ borderRadius: skin.controlRadius }}
          >
            <FontAwesome6 name='plus' size={16} color={primaryColor} />
          </Pressable>
        }
      />

      {/* Search */}
      <View className='px-5 pt-2 pb-2'>
        <View
          className='bg-input-background flex-row items-center gap-2 border border-border px-3 py-2.5'
          style={{ borderRadius: skin.controlRadius }}
        >
          <FontAwesome6 name='magnifying-glass' size={14} color={mutedColor} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={applyCase(skin, 'Search servers…')}
            placeholderTextColorClassName='accent-muted'
            autoCapitalize='none'
            autoCorrect={false}
            className='text-text-primary flex-1 p-0 text-[15px]'
            style={skin.mono ? { fontFamily: skin.monoFamily } : undefined}
          />
        </View>
      </View>

      <ScrollView
        className='flex-1'
        contentContainerStyle={{
          paddingHorizontal: skin.edgeToEdge ? 0 : 20,
          paddingTop: 8,
          paddingBottom: marginBottom,
        }}
      >
        {AsyncResult.isInitial(listResult) ? (
          <ThemedText className='mt-6 text-center text-sm text-muted'>
            Loading servers…
          </ThemedText>
        ) : AsyncResult.isFailure(listResult) ? (
          <ThemedText className='text-danger mt-6 text-center text-sm'>
            Error loading servers
          </ThemedText>
        ) : filtered.length === 0 ? (
          <EmptyState hasServers={entries.length > 0} />
        ) : (
          <View className={skin.edgeToEdge ? '' : 'gap-3'}>
            {Arr.map(filtered, (entry, i) => (
              <ServerRow key={entry.id} id={entry.id} index={i} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function EmptyState({ hasServers }: { hasServers: boolean }) {
  const router = useRouter();
  if (hasServers) {
    return (
      <ThemedText className='mt-6 text-center text-sm text-muted'>
        No servers match your search.
      </ThemedText>
    );
  }
  return (
    <View className='mt-16 items-center gap-3 px-6'>
      <ThemedText className='text-text-primary text-base font-semibold'>
        No saved servers yet
      </ThemedText>
      <ThemedText className='text-center text-sm text-muted'>
        Connect to a host and it’ll show up here.
      </ThemedText>
      <Button
        className='mt-2'
        title='New Connection'
        onPress={() => router.push('/servers/connect')}
      />
    </View>
  );
}

const STATUS_DOT: Record<ServerLiveStatus, string> = {
  live: 'bg-success',
  idle: 'bg-warning',
  off: 'bg-muted',
};

function ServerRow({ id, index }: { id: string; index: number }) {
  const router = useRouter();
  const skin = useThemeSkin();
  const cardStyle = useSurfaceStyle();
  const successColor = useCSSVariable('--color-success') as string;
  const primaryColor = useCSSVariable('--color-primary') as string;
  const mutedColor = useCSSVariable('--color-muted') as string;
  const detailsResult = useAtomValue(secretsManager.connections.atoms.get(id));
  const deleteConnection = useAtomSet(
    secretsManager.connections.atoms.delete(id),
  );
  const renameConnection = useAtomSet(
    secretsManager.connections.atoms.updateMetadata(id),
    { mode: 'promise' },
  );
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);

  const entry = AsyncResult.isSuccess(detailsResult)
    ? detailsResult.value
    : undefined;
  const details = entry?.value;
  const label = entry?.metadata.label;

  const status = useServerLiveStatus(
    details
      ? {
          host: details.host,
          port: details.port,
          username: details.username,
        }
      : undefined,
  );

  const rawTitle =
    label ?? (details ? `${details.username}@${details.host}` : id);
  const title = applyCase(skin, rawTitle);
  const host = details ? `${details.username}@${details.host}` : '';
  const liveTag = Match.value(status.status).pipe(
    Match.when(
      'live',
      () =>
        `${status.shellCount} ${applyCase(skin, status.shellCount === 1 ? 'shell live' : 'shells live')}`,
    ),
    Match.when('idle', () => applyCase(skin, 'idle')),
    Match.when('off', () => applyCase(skin, 'offline')),
    Match.exhaustive,
  );
  const dotGlow =
    status.status === 'live' ? `0px 0px 8px ${successColor}` : undefined;

  const open = () =>
    router.push({ pathname: '/servers/detail', params: { id } });
  const longPress = () => setActionsOpen(true);

  const monoFamily = skin.mono ? skin.monoFamily : undefined;

  return (
    <>
      {skin.edgeToEdge ? (
        // Brutalist (Monolith): numbered, full-bleed, hairline divider.
        <Pressable
          onPress={open}
          onLongPress={longPress}
          className='flex-row items-center gap-3.5 border-b border-border px-5 py-4'
        >
          <ThemedText
            className='text-[11px] font-bold text-primary'
            style={{ fontFamily: monoFamily, letterSpacing: 1 }}
          >
            {pipe(String(index + 1), Str.padStart(2, '0'))}
          </ThemedText>
          <View className='min-w-0 flex-1'>
            <ThemedText
              className='text-text-primary text-[16px] font-bold'
              numberOfLines={1}
              style={{ fontFamily: monoFamily, letterSpacing: skin.tracking }}
            >
              {title}
            </ThemedText>
            <ThemedText
              className='mt-0.5 text-[11px] text-muted'
              numberOfLines={1}
              style={{ fontFamily: monoFamily, letterSpacing: 1 }}
            >
              {host}
            </ThemedText>
          </View>
          <ThemedText
            className='text-[10px] font-bold'
            style={{
              fontFamily: monoFamily,
              letterSpacing: 1,
              color: status.status === 'off' ? mutedColor : primaryColor,
            }}
          >
            [{liveTag}]
          </ThemedText>
        </Pressable>
      ) : (
        // Rounded card (Phosphor/Graphite/Aurora/default).
        <Pressable
          onPress={open}
          onLongPress={longPress}
          className='flex-row items-center gap-3 px-4 py-3.5'
          style={cardStyle}
        >
          <View
            className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status.status]}`}
            style={dotGlow === undefined ? undefined : { boxShadow: dotGlow }}
          />
          <View className='min-w-0 flex-1'>
            <ThemedText
              className='text-text-primary text-[15px] font-semibold'
              numberOfLines={1}
              style={
                monoFamily !== undefined && monoFamily !== ''
                  ? { fontFamily: monoFamily }
                  : undefined
              }
            >
              {title}
            </ThemedText>
            <ThemedText className='mt-0.5 text-xs text-muted' numberOfLines={1}>
              {status.status === 'off'
                ? applyCase(skin, 'No active shells')
                : liveTag}
            </ThemedText>
          </View>
          <ThemedText className='px-1 text-[20px] text-muted'>›</ThemedText>
        </Pressable>
      )}

      <ActionsSheet
        open={actionsOpen}
        title={rawTitle}
        onClose={() => setActionsOpen(false)}
        onRename={() => {
          setActionsOpen(false);
          setRenaming(true);
        }}
        onDelete={() => {
          setActionsOpen(false);
          deleteConnection();
        }}
      />

      {renaming ? (
        <RenameDialog
          title='Rename server'
          description='A local label only — it doesn’t change the connection.'
          initial={label ?? ''}
          placeholder={host || 'Server name'}
          onClose={() => setRenaming(false)}
          onSave={(next) =>
            // Empty ⇒ clear the label and fall back to user@host.
            renameConnection({ label: next || undefined }).then(() => {
              setRenaming(false);
            })
          }
        />
      ) : null}
    </>
  );
}

function ActionsSheet({
  open,
  title,
  onClose,
  onRename,
  onDelete,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      transparent
      visible={open}
      animationType='fade'
      onRequestClose={onClose}
    >
      <Pressable className='bg-overlay flex-1' onPress={onClose}>
        <View className='border-border-strong mt-auto gap-2 border bg-background p-4'>
          <ThemedText className='text-text-primary mb-1 text-base font-bold'>
            {title}
          </ThemedText>
          <Button variant='outline' title='Rename' onPress={onRename} />
          <Button variant='danger' title='Delete server' onPress={onDelete} />
          <Button variant='outline' title='Cancel' onPress={onClose} />
        </View>
      </Pressable>
    </Modal>
  );
}
