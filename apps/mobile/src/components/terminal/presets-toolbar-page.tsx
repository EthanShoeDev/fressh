import { FontAwesome6 } from '@expo/vector-icons';
import * as Arr from 'effect/Array';
import * as Str from 'effect/String';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { PresetEditDialog } from '@/components/terminal/preset-edit-dialog';
import { ThemedText } from '@/components/themed/themed-text';
import { type Preset, usePresets } from '@/lib/presets';
import { useThemeSkin } from '@/lib/theme-skin';

/**
 * Page 2 of the paged keyboard toolbar: one-tap preset commands. Tap runs the
 * preset (via `onRun`, which sends it to the PTY); long-press edits it; the
 * trailing `+` adds a new one. See docs/projects/future/preset-command-buttons.md.
 */
export function PresetsToolbarPage({
  onRun,
}: {
  onRun: (preset: Preset) => void;
}) {
  const presets = usePresets();
  const skin = useThemeSkin();
  const border = useCSSVariable('--color-border') as string;
  const surface = useCSSVariable('--color-surface') as string;
  const primary = useCSSVariable('--color-primary') as string;

  // null = closed; 'new' = add; otherwise the preset being edited.
  const [editing, setEditing] = React.useState<Preset | 'new' | null>(null);

  return (
    <View className='flex-1 justify-center'>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{
          alignItems: 'center',
          gap: 7,
          paddingRight: 4,
        }}
      >
        {presets.length === 0 ? (
          <ThemedText className='px-1 text-xs text-muted'>
            No presets yet — tap
          </ThemedText>
        ) : null}

        {Arr.map(presets, (preset) => (
          <Pressable
            key={preset.id}
            // Stable id for the screenshot/e2e flows (label-derived, since the
            // preset id is a random uuid): e.g. "git status" → preset-git-status.
            testID={`preset-${Str.replaceAll(/\s+/g, '-')(Str.toLowerCase(preset.label))}`}
            onPress={() => onRun(preset)}
            onLongPress={() => setEditing(preset)}
            className='items-center justify-center px-3 py-2'
            style={{
              borderRadius: skin.controlRadius,
              borderWidth: 1,
              borderColor: border,
              backgroundColor: surface,
            }}
          >
            <ThemedText
              className='text-text-primary text-[13px] font-semibold'
              numberOfLines={1}
              style={skin.mono ? { fontFamily: skin.monoFamily } : undefined}
            >
              {preset.label}
            </ThemedText>
          </Pressable>
        ))}

        <Pressable
          accessibilityLabel='Add preset command'
          onPress={() => setEditing('new')}
          className='h-9 w-9 items-center justify-center'
          style={{
            borderRadius: skin.controlRadius,
            borderWidth: 1,
            borderColor: border,
            backgroundColor: surface,
          }}
        >
          <FontAwesome6 name='plus' size={13} color={primary} />
        </Pressable>
      </ScrollView>

      {editing !== null ? (
        <PresetEditDialog
          preset={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}
