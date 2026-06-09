import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as DocumentPicker from 'expo-document-picker';
import React from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useCSSVariable } from 'uniwind';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/themed/Button';
import { useSurfaceStyle } from '@/components/themed/ThemedScreen';
import { ThemedText } from '@/components/themed/ThemedText';
import { secretsManager, type KeyMetadata } from '@/lib/secrets-manager';
import { useThemeSkin } from '@/lib/theme-skin';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';
import { asyncResultErrorMessage } from '@/lib/utils';

export type KeyListMode = 'manage' | 'select';

type KeyEntry = { id: string; metadata: KeyMetadata };

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
function formatAdded(ms: number) {
	const d = new Date(ms);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Strictly private-key management, rebuilt to match the "Keys & Connect" design:
 * a Generate/Import action row, then a card per key (accent key-glyph, name +
 * DEFAULT badge, added date). Tapping a card raises a detail bottom sheet where
 * ANY key — default or not — can be set-default / renamed / deleted, so renaming
 * a non-default key is two taps. Import lives behind its own sheet, and there's a
 * proper empty state. All chrome comes from the active theme's skin/tokens, so it
 * wears Aurora glass, Monolith brutalism, etc.
 *
 * In `select` mode (the connect form's key picker) the cards just pick: tapping
 * one calls `onSelect(id)` and there's no detail sheet.
 */
export function KeyList(props: {
	mode: KeyListMode;
	onSelect?: (id: string) => void | Promise<void>;
}) {
	const bottomSpace = useBottomTabSpacing();
	const onPrimary = useCSSVariable('--color-button-text-on-primary') as string;
	const secondary = useCSSVariable('--color-text-secondary') as string;
	const listResult = useAtomValue(secretsManager.keys.atoms.list);

	const generate = useAtomSet(secretsManager.keys.atoms.generate);
	const generateResult = useAtomValue(secretsManager.keys.atoms.generate);
	const isGenerating = generateResult.waiting;

	const keys = AsyncResult.isSuccess(listResult) ? listResult.value : [];

	const [importOpen, setImportOpen] = React.useState(false);
	const [detailId, setDetailId] = React.useState<string | null>(null);
	const [renameId, setRenameId] = React.useState<string | null>(null);

	const detailEntry = keys.find((k) => k.id === detailId) ?? null;
	const renameEntry = keys.find((k) => k.id === renameId) ?? null;

	const actions = (
		<View className='mb-5 flex-row gap-2.5'>
			<Button
				className='flex-1'
				title='Generate'
				loading={isGenerating}
				loadingTitle='Generating…'
				icon={<FontAwesome6 name='plus' size={15} color={onPrimary} />}
				onPress={() => {
					generate();
				}}
			/>
			<Button
				className='flex-1'
				variant='outline'
				title='Import'
				icon={<FontAwesome6 name='download' size={14} color={secondary} />}
				onPress={() => setImportOpen(true)}
			/>
		</View>
	);

	const body = AsyncResult.isInitial(listResult) ? (
		<ThemedText className='mt-6 text-center text-sm text-muted'>
			Loading keys…
		</ThemedText>
	) : AsyncResult.isFailure(listResult) ? (
		<ThemedText className='mt-6 text-center text-sm text-danger'>
			Error loading keys
		</ThemedText>
	) : keys.length === 0 ? (
		<EmptyState
			onGenerate={() => generate()}
			generating={isGenerating}
			onImport={() => setImportOpen(true)}
		/>
	) : (
		<>
			<SectionLabel>Your keys</SectionLabel>
			<View className='gap-3'>
				{keys.map((entry) => (
					<KeyCard
						key={entry.id}
						entry={entry}
						onPress={() => {
							if (props.mode === 'select') {
								void props.onSelect?.(entry.id);
							} else {
								setDetailId(entry.id);
							}
						}}
					/>
				))}
			</View>
		</>
	);

	return (
		<View className={props.mode === 'select' ? 'shrink' : 'flex-1'}>
			<ScrollView
				className={props.mode === 'select' ? 'shrink' : 'flex-1'}
				contentContainerStyle={{
					paddingHorizontal: 16,
					paddingTop: 12,
					paddingBottom: props.mode === 'select' ? 24 : bottomSpace + 16,
				}}
			>
				{actions}
				{body}
			</ScrollView>

			{importOpen ? <ImportSheet onClose={() => setImportOpen(false)} /> : null}

			{props.mode === 'manage' && detailEntry ? (
				<KeyDetailSheet
					entry={detailEntry}
					onClose={() => setDetailId(null)}
					onRename={() => {
						setRenameId(detailEntry.id);
						setDetailId(null);
					}}
				/>
			) : null}

			{props.mode === 'manage' && renameEntry ? (
				<RenameDialog entry={renameEntry} onClose={() => setRenameId(null)} />
			) : null}
		</View>
	);
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<ThemedText
			className='mb-2.5 text-[11px] font-semibold uppercase text-primary'
			style={{ letterSpacing: 1.3 }}
		>
			{children}
		</ThemedText>
	);
}

function KeyGlyph({
	isDefault,
	size = 42,
}: {
	isDefault?: boolean;
	size?: number;
}) {
	const skin = useThemeSkin();
	const primary = useCSSVariable('--color-primary') as string;
	return (
		<View
			style={{
				width: size,
				height: size,
				borderRadius: skin.controlRadius,
				backgroundColor: 'rgba(0,0,0,0.28)',
				alignItems: 'center',
				justifyContent: 'center',
				boxShadow: isDefault && skin.glow ? skin.glow : undefined,
			}}
		>
			<MaterialCommunityIcons
				name='key-variant'
				size={Math.round(size * 0.5)}
				color={primary}
			/>
		</View>
	);
}

function DefaultBadge() {
	const primary = useCSSVariable('--color-primary') as string;
	const onPrimary = useCSSVariable('--color-button-text-on-primary') as string;
	return (
		<View
			style={{ backgroundColor: primary, borderRadius: 5 }}
			className='px-1.5 py-0.5'
		>
			<ThemedText
				className='text-[9px] font-extrabold'
				style={{ color: onPrimary, letterSpacing: 0.7 }}
			>
				DEFAULT
			</ThemedText>
		</View>
	);
}

function KeyCard({ entry, onPress }: { entry: KeyEntry; onPress: () => void }) {
	const cardStyle = useSurfaceStyle({ glow: entry.metadata.isDefault });
	const primary = useCSSVariable('--color-primary') as string;
	const muted = useCSSVariable('--color-muted') as string;
	const isDefault = !!entry.metadata.isDefault;
	const label = entry.metadata.label ?? entry.id;

	return (
		<Pressable
			onPress={onPress}
			className='flex-row items-center gap-3 px-3.5 py-3.5'
			style={[cardStyle, isDefault ? { borderColor: primary } : null]}
		>
			<KeyGlyph isDefault={isDefault} />
			<View className='min-w-0 flex-1'>
				<View className='flex-row items-center gap-2'>
					<ThemedText
						numberOfLines={1}
						className='shrink text-[15px] font-semibold text-text-primary'
					>
						{label}
					</ThemedText>
					{isDefault ? <DefaultBadge /> : null}
				</View>
				<ThemedText className='mt-1 text-xs text-muted'>
					Added {formatAdded(entry.metadata.createdAtMs)}
				</ThemedText>
			</View>
			<FontAwesome6 name='chevron-right' size={14} color={muted} />
		</Pressable>
	);
}

function EmptyState({
	onGenerate,
	generating,
	onImport,
}: {
	onGenerate: () => void;
	generating: boolean;
	onImport: () => void;
}) {
	const skin = useThemeSkin();
	const primary = useCSSVariable('--color-primary') as string;
	const onPrimary = useCSSVariable('--color-button-text-on-primary') as string;
	const secondary = useCSSVariable('--color-text-secondary') as string;
	return (
		<View className='mt-16 items-center px-6'>
			<View
				style={{
					width: 84,
					height: 84,
					borderRadius: skin.radius + 6,
					backgroundColor: skin.glass ? 'rgba(255,255,255,0.06)' : undefined,
					alignItems: 'center',
					justifyContent: 'center',
					boxShadow: skin.glow || undefined,
				}}
				className={skin.glass ? '' : 'border border-border bg-surface'}
			>
				<MaterialCommunityIcons name='key-variant' size={34} color={primary} />
			</View>
			<ThemedText className='mt-5 text-[17px] font-semibold text-text-primary'>
				No keys yet
			</ThemedText>
			<ThemedText className='mt-2 max-w-[260px] text-center text-sm leading-5 text-muted'>
				Generate an ed25519 key or import one you already use. Keys let you
				connect without typing a password.
			</ThemedText>
			<View className='mt-5 flex-row gap-2.5'>
				<Button
					title='Generate'
					loading={generating}
					loadingTitle='Generating…'
					icon={<FontAwesome6 name='plus' size={15} color={onPrimary} />}
					onPress={onGenerate}
				/>
				<Button
					variant='outline'
					title='Import'
					icon={<FontAwesome6 name='download' size={14} color={secondary} />}
					onPress={onImport}
				/>
			</View>
		</View>
	);
}

// ---------------------------------------------------------------------------
// Detail bottom sheet — set default / rename / delete for any key
// ---------------------------------------------------------------------------

/** A bottom sheet shell: scrim + a top-rounded surface pinned to the bottom. */
function KeyDetailSheet({
	entry,
	onClose,
	onRename,
}: {
	entry: KeyEntry;
	onClose: () => void;
	onRename: () => void;
}) {
	const onPrimary = useCSSVariable('--color-button-text-on-primary') as string;
	const setDefault = useAtomSet(
		secretsManager.keys.atoms.setDefault(entry.id),
		{
			mode: 'promise',
		},
	);
	const deleteKey = useAtomSet(secretsManager.keys.atoms.delete(entry.id));
	const isDefault = !!entry.metadata.isDefault;
	const label = entry.metadata.label ?? entry.id;

	return (
		<BottomSheet onClose={onClose}>
			<View className='gap-3 px-4 pb-9 pt-2'>
				<View className='flex-row items-center gap-3'>
					<KeyGlyph isDefault={isDefault} size={48} />
					<View className='min-w-0 flex-1'>
						<ThemedText
							numberOfLines={1}
							className='text-[19px] font-bold text-text-primary'
						>
							{label}
						</ThemedText>
						<ThemedText className='mt-0.5 text-xs text-muted'>
							Added {formatAdded(entry.metadata.createdAtMs)}
						</ThemedText>
					</View>
					{isDefault ? <DefaultBadge /> : null}
				</View>

				<View className='mt-1 gap-2.5'>
					{!isDefault ? (
						<Button
							title='Set as default key'
							icon={<FontAwesome6 name='check' size={15} color={onPrimary} />}
							onPress={() => {
								void setDefault()
									.catch(() => undefined)
									.finally(onClose);
							}}
						/>
					) : null}
					<Button variant='outline' title='Rename' onPress={onRename} />
					<Button
						variant='danger'
						title='Delete key'
						onPress={() => {
							deleteKey();
							onClose();
						}}
					/>
				</View>
			</View>
		</BottomSheet>
	);
}

// ---------------------------------------------------------------------------
// Rename dialog — works for ANY key (this is how non-default keys get renamed)
// ---------------------------------------------------------------------------

function RenameDialog({
	entry,
	onClose,
}: {
	entry: KeyEntry;
	onClose: () => void;
}) {
	const skin = useThemeSkin();
	const surface = useCSSVariable('--color-surface') as string;
	const border = useCSSVariable('--color-border-strong') as string;
	const primary = useCSSVariable('--color-primary') as string;
	const [value, setValue] = React.useState(entry.metadata.label ?? '');

	const rename = useAtomSet(secretsManager.keys.atoms.rename(entry.id), {
		mode: 'promise',
	});
	const renameResult = useAtomValue(secretsManager.keys.atoms.rename(entry.id));
	const pending = renameResult.waiting;

	const onSave = () => {
		const next = value.trim();
		if (!next) {
			return;
		}
		void rename(next)
			.catch(() => undefined)
			.finally(onClose);
	};

	return (
		<Modal transparent visible animationType='fade' onRequestClose={onClose}>
			<View className='flex-1 items-center justify-center p-6'>
				<Pressable className='absolute inset-0 bg-overlay' onPress={onClose} />
				<View
					style={{
						backgroundColor: surface,
						borderColor: border,
						borderWidth: 1,
						borderRadius: skin.radius,
					}}
					className='w-full gap-4 p-5'
				>
					<View>
						<ThemedText className='text-lg font-bold text-text-primary'>
							Rename key
						</ThemedText>
						<ThemedText className='mt-1.5 text-[13px] leading-5 text-muted'>
							Enter a new name for this key. This is only a local label — it
							doesn’t change the key itself.
						</ThemedText>
					</View>
					<TextInput
						autoFocus
						value={value}
						onChangeText={setValue}
						placeholder='Key name'
						placeholderTextColorClassName='accent-muted'
						className='px-3.5 py-3 text-base text-text-primary'
						style={{
							borderWidth: 1.5,
							borderColor: primary,
							borderRadius: skin.controlRadius,
							backgroundColor: 'rgba(0,0,0,0.25)',
						}}
						onSubmitEditing={onSave}
					/>
					<View className='flex-row gap-2.5'>
						<Button
							className='flex-1'
							variant='outline'
							title='Cancel'
							onPress={onClose}
						/>
						<Button
							className='flex-1'
							title='Save'
							loading={pending}
							loadingTitle='Saving…'
							onPress={onSave}
						/>
					</View>
				</View>
			</View>
		</Modal>
	);
}

// ---------------------------------------------------------------------------
// Import sheet — paste / file, label, set-default
// ---------------------------------------------------------------------------

function ImportSheet({ onClose }: { onClose: () => void }) {
	return (
		<BottomSheet onClose={onClose} maxHeightPct={88}>
			<KeyboardAwareScrollView
				contentContainerClassName='gap-3 p-4 pb-9'
				keyboardShouldPersistTaps='handled'
				bottomOffset={24}
			>
				<ImportKeyCard onImported={onClose} />
			</KeyboardAwareScrollView>
		</BottomSheet>
	);
}

function ImportKeyCard({ onImported }: { onImported?: () => void }) {
	const [mode, setMode] = React.useState<'paste' | 'file'>('paste');
	const [label, setLabel] = React.useState('Imported Key');
	const [asDefault, setAsDefault] = React.useState(false);
	const [content, setContent] = React.useState('');
	const [fileName, setFileName] = React.useState<string | null>(null);
	const primary = useCSSVariable('--color-primary') as string;
	const onPrimary = useCSSVariable('--color-button-text-on-primary') as string;

	const importKey = useAtomSet(secretsManager.keys.atoms.import, {
		mode: 'promise',
	});
	const importResult = useAtomValue(secretsManager.keys.atoms.import);
	const importPending = importResult.waiting;
	const importErrorMessage = asyncResultErrorMessage(importResult);

	const onImport = async () => {
		// Guard against a double-tap importing the same key twice before the first
		// resolves (and before the sheet closes).
		if (importPending) {
			return;
		}
		const trimmed = content.trim();
		if (!trimmed) {
			return;
		}
		// On failure the error surfaces via `importResult`; reactivity refreshes
		// the key list, so there's nothing to refetch here.
		const success = await importKey({
			value: trimmed,
			label: label || 'Imported Key',
			isDefault: asDefault,
		}).catch(() => undefined);
		if (success) {
			setContent('');
			setFileName(null);
			onImported?.();
		}
	};

	const pickFile = React.useCallback(async () => {
		const res = await DocumentPicker.getDocumentAsync({
			multiple: false,
			copyToCacheDirectory: true,
			type: ['text/*', 'application/*'],
		});
		// Newer expo-document-picker: { canceled: boolean, assets?: [{ uri, name, ... }] }
		const canceled = 'canceled' in res ? res.canceled : false;
		if (canceled) {
			return;
		}
		const asset = res.assets?.[0];
		const file = asset?.file;
		if (!file) {
			return;
		}
		setFileName(asset.name ?? null);
		const data = await file.text();
		setContent(data);
		if (asset.name && (!label || label === 'Imported Key')) {
			setLabel(asset.name.replace(/\.[^.]+$/, ''));
		}
	}, [label]);

	return (
		<View className='gap-3'>
			<ThemedText className='text-lg font-bold text-text-primary'>
				Import private key
			</ThemedText>

			<View className='flex-row overflow-hidden rounded-[10px] border border-border bg-input-background'>
				{(['paste', 'file'] as const).map((m) => (
					<Pressable
						key={m}
						onPress={() => setMode(m)}
						className={
							mode === m
								? 'flex-1 items-center bg-surface py-2.5'
								: 'flex-1 items-center bg-input-background py-2.5'
						}
					>
						<ThemedText
							className={
								mode === m
									? 'font-semibold text-text-primary'
									: 'font-semibold text-muted'
							}
						>
							{m === 'paste' ? 'Paste' : 'File'}
						</ThemedText>
					</Pressable>
				))}
			</View>

			{mode === 'paste' ? (
				<TextInput
					multiline
					placeholder='Paste your private key here'
					placeholderTextColorClassName='accent-muted'
					value={content}
					onChangeText={setContent}
					className='min-h-[120px] rounded-[10px] border border-border bg-input-background p-3 text-text-primary'
					style={{ fontFamily: 'Menlo, ui-monospace, monospace' }}
				/>
			) : (
				<View className='gap-2'>
					<Button
						variant='outline'
						title={fileName ? 'Choose Different File' : 'Choose File'}
						onPress={pickFile}
					/>
					{fileName ? (
						<ThemedText className='text-muted'>Selected: {fileName}</ThemedText>
					) : null}
					{content ? (
						<TextInput
							editable={false}
							multiline
							value={content.slice(0, 500)}
							className='min-h-[80px] rounded-[10px] border border-border bg-input-background p-2.5 text-text-secondary'
							style={{ fontFamily: 'Menlo, ui-monospace, monospace' }}
						/>
					) : null}
				</View>
			)}

			<View className='gap-2'>
				<ThemedText className='text-xs text-text-secondary'>Label</ThemedText>
				<TextInput
					placeholder='Display name'
					placeholderTextColorClassName='accent-muted'
					value={label}
					onChangeText={setLabel}
					className='rounded-[10px] border border-border bg-input-background px-3 py-2.5 text-base text-text-primary'
				/>
			</View>

			<Pressable
				onPress={() => setAsDefault((v) => !v)}
				className='flex-row items-center gap-2.5'
			>
				<View
					className='h-[22px] w-[22px] items-center justify-center rounded-md border-2 border-border'
					style={asDefault ? { backgroundColor: primary } : undefined}
				>
					{asDefault ? (
						<FontAwesome6 name='check' size={11} color={onPrimary} />
					) : null}
				</View>
				<ThemedText className='text-text-secondary'>Set as default</ThemedText>
			</Pressable>

			<Button
				title='Import Key'
				loading={importPending}
				loadingTitle='Importing…'
				onPress={() => {
					void onImport();
				}}
			/>

			{importErrorMessage ? (
				<ThemedText className='text-danger'>
					{importErrorMessage || 'Import failed'}
				</ThemedText>
			) : null}
		</View>
	);
}
