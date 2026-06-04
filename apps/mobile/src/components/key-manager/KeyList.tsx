import { useAtomSet, useAtomValue } from '@effect/atom-react';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as DocumentPicker from 'expo-document-picker';
import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { secretsManager } from '@/lib/secrets-manager';
import { asyncResultErrorMessage } from '@/lib/utils';

export type KeyListMode = 'manage' | 'select';

export function KeyList(props: {
	mode: KeyListMode;
	onSelect?: (id: string) => void | Promise<void>;
}) {
	const listResult = useAtomValue(secretsManager.keys.atoms.list);

	const generate = useAtomSet(secretsManager.keys.atoms.generate);
	const generateResult = useAtomValue(secretsManager.keys.atoms.generate);
	const isGenerating = generateResult.waiting;

	const keys = AsyncResult.isSuccess(listResult) ? listResult.value : [];

	return (
		<ScrollView contentContainerClassName='gap-4 p-4'>
			<ImportKeyCard />

			<Pressable
				className={
					isGenerating
						? 'items-center rounded-xl bg-primary py-3.5 opacity-70'
						: 'items-center rounded-xl bg-primary py-3.5'
				}
				disabled={isGenerating}
				onPress={() => {
					generate();
				}}
			>
				<Text className='text-sm font-bold tracking-[0.3px] text-button-text-on-primary'>
					{isGenerating ? 'Generating…' : 'Generate New Key (ed25519)'}
				</Text>
			</Pressable>

			{AsyncResult.isInitial(listResult) ? (
				<Text className='text-muted'>Loading keys…</Text>
			) : AsyncResult.isFailure(listResult) ? (
				<Text className='text-danger'>Error loading keys</Text>
			) : keys.length ? (
				<View className='gap-3'>
					{keys.map((k) => (
						<KeyRow
							key={k.id}
							entryId={k.id}
							mode={props.mode}
							onSelected={props.onSelect}
						/>
					))}
				</View>
			) : (
				<Text className='text-muted'>No keys yet</Text>
			)}
		</ScrollView>
	);
}

function ImportKeyCard() {
	const [mode, setMode] = React.useState<'paste' | 'file'>('paste');
	const [label, setLabel] = React.useState('Imported Key');
	const [asDefault, setAsDefault] = React.useState(false);
	const [content, setContent] = React.useState('');
	const [fileName, setFileName] = React.useState<string | null>(null);

	const importKey = useAtomSet(secretsManager.keys.atoms.import, {
		mode: 'promise',
	});
	const importResult = useAtomValue(secretsManager.keys.atoms.import);
	const importPending = importResult.waiting;
	const importErrorMessage = asyncResultErrorMessage(importResult);

	const onImport = async () => {
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
		<View className='gap-3 rounded-xl border border-border bg-surface p-3'>
			<Text className='text-base font-bold text-text-primary'>
				Import Private Key
			</Text>

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
						<Text
							className={
								mode === m
									? 'font-semibold text-text-primary'
									: 'font-semibold text-muted'
							}
						>
							{m === 'paste' ? 'Paste' : 'File'}
						</Text>
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
					<Pressable
						onPress={pickFile}
						className='items-center rounded-[10px] border border-border bg-transparent py-3'
					>
						<Text className='font-semibold text-text-secondary'>
							{fileName ? 'Choose Different File' : 'Choose File'}
						</Text>
					</Pressable>
					{fileName ? (
						<Text className='text-muted'>Selected: {fileName}</Text>
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
				<Text className='text-xs text-text-secondary'>Label</Text>
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
					className={
						asDefault
							? 'h-[22px] w-[22px] rounded-md border-2 border-border bg-primary'
							: 'h-[22px] w-[22px] rounded-md border-2 border-border bg-transparent'
					}
				/>
				<Text className='text-text-secondary'>Set as default</Text>
			</Pressable>

			<Pressable
				disabled={importPending}
				onPress={() => {
					void onImport();
				}}
				className={
					importPending
						? 'items-center rounded-xl bg-primary py-3 opacity-60'
						: 'items-center rounded-xl bg-primary py-3'
				}
			>
				<Text className='font-bold text-button-text-on-primary'>
					{importPending ? 'Importing…' : 'Import Key'}
				</Text>
			</Pressable>

			{importErrorMessage ? (
				<Text className='text-danger'>
					{importErrorMessage || 'Import failed'}
				</Text>
			) : null}
		</View>
	);
}

function KeyRow(props: {
	entryId: string;
	mode: KeyListMode;
	onSelected?: (id: string) => void | Promise<void>;
}) {
	const entryResult = useAtomValue(
		secretsManager.keys.atoms.get(props.entryId),
	);
	const entry = AsyncResult.isSuccess(entryResult)
		? entryResult.value
		: undefined;
	const [label, setLabel] = React.useState(entry?.metadata.label ?? '');

	const rename = useAtomSet(secretsManager.keys.atoms.rename(props.entryId));
	const renameResult = useAtomValue(
		secretsManager.keys.atoms.rename(props.entryId),
	);
	const renamePending = renameResult.waiting;

	const deleteKey = useAtomSet(secretsManager.keys.atoms.delete(props.entryId));

	const setDefault = useAtomSet(
		secretsManager.keys.atoms.setDefault(props.entryId),
		{ mode: 'promise' },
	);

	const onSetDefault = async () => {
		// Reactivity refreshes the list + this row after the mutation completes.
		await setDefault().catch(() => undefined);
		if (props.mode === 'select' && props.onSelected) {
			await props.onSelected(props.entryId);
		}
	};

	if (!entry) {
		return null;
	}

	return (
		<View className='flex-row items-start justify-between rounded-xl border border-border bg-input-background px-3 py-3'>
			<View className='mr-2 flex-1'>
				<Text className='text-[15px] font-semibold text-text-primary'>
					{entry.metadata.label ?? entry.id}
					{entry.metadata.isDefault ? '  • Default' : ''}
				</Text>
				<Text className='mt-0.5 text-xs text-muted'>ID: {entry.id}</Text>
				{props.mode === 'manage' ? (
					<TextInput
						className='mt-2 rounded-[10px] border border-border bg-input-background px-3 py-2.5 text-base text-text-primary'
						placeholder='Display name'
						placeholderTextColorClassName='accent-muted'
						value={label}
						onChangeText={setLabel}
					/>
				) : null}
			</View>
			<View className='items-end gap-1.5'>
				{props.mode === 'select' ? (
					<Pressable
						onPress={() => {
							void onSetDefault();
						}}
						className='items-center rounded-[10px] bg-primary px-2.5 py-3'
					>
						<Text className='text-xs font-bold text-button-text-on-primary'>
							Select
						</Text>
					</Pressable>
				) : null}
				{props.mode === 'manage' ? (
					<Pressable
						className={
							renamePending
								? 'items-center rounded-[10px] border border-border bg-transparent px-2.5 py-2 opacity-60'
								: 'items-center rounded-[10px] border border-border bg-transparent px-2.5 py-2'
						}
						onPress={() => {
							rename(label);
						}}
						disabled={renamePending}
					>
						<Text className='text-xs font-semibold text-text-secondary'>
							{renamePending ? 'Saving…' : 'Save'}
						</Text>
					</Pressable>
				) : null}
				{!entry.metadata.isDefault ? (
					<Pressable
						className='items-center rounded-[10px] border border-border bg-transparent px-2.5 py-2'
						onPress={() => {
							void onSetDefault();
						}}
					>
						<Text className='text-xs font-semibold text-text-secondary'>
							Set Default
						</Text>
					</Pressable>
				) : null}
				<Pressable
					className='items-center rounded-[10px] border border-danger bg-transparent px-2.5 py-2'
					onPress={() => {
						deleteKey();
					}}
				>
					<Text className='text-xs font-bold text-danger'>Delete</Text>
				</Pressable>
			</View>
		</View>
	);
}
