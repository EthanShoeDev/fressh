import { useMutation, useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { secretsManager } from '@/lib/secrets-manager';
import { useTheme } from '@/lib/theme';

export type KeyListMode = 'manage' | 'select';

export function KeyList(props: {
	mode: KeyListMode;
	onSelect?: (id: string) => void | Promise<void>;
}) {
	const listKeysQuery = useQuery(secretsManager.keys.query.list);
	const theme = useTheme();

	const generateMutation = useMutation({
		mutationFn: async () => {
			const id = `key_${Date.now()}`;
			const pair = await secretsManager.keys.utils.generateKeyPair({
				type: 'rsa',
				keySize: 4096,
			});
			await secretsManager.keys.utils.upsertPrivateKey({
				keyId: id,
				metadata: { priority: 0, label: 'New Key', isDefault: false },
				value: pair,
			});
		},
		onSuccess: () => listKeysQuery.refetch(),
	});

	return (
		<ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
			<ImportKeyCard onImported={() => listKeysQuery.refetch()} />

			<Pressable
				style={[
					{
						backgroundColor: theme.colors.primary,
						borderRadius: 12,
						paddingVertical: 14,
						alignItems: 'center',
					},
					generateMutation.isPending && { opacity: 0.7 },
				]}
				disabled={generateMutation.isPending}
				onPress={() => {
					generateMutation.mutate();
				}}
			>
				<Text
					style={{
						color: theme.colors.buttonTextOnPrimary,
						fontWeight: '700',
						fontSize: 14,
						letterSpacing: 0.3,
					}}
				>
					{generateMutation.isPending
						? 'Generating…'
						: 'Generate New Key (ed25519)'}
				</Text>
			</Pressable>

			{listKeysQuery.isLoading ? (
				<Text style={{ color: theme.colors.muted }}>Loading keys…</Text>
			) : listKeysQuery.isError ? (
				<Text style={{ color: theme.colors.danger }}>Error loading keys</Text>
			) : listKeysQuery.data?.length ? (
				<View style={{ gap: 12 }}>
					{listKeysQuery.data.map((k) => (
						<KeyRow
							key={k.id}
							entryId={k.id}
							mode={props.mode}
							onSelected={props.onSelect}
						/>
					))}
				</View>
			) : (
				<Text style={{ color: theme.colors.muted }}>No keys yet</Text>
			)}
		</ScrollView>
	);
}

function ImportKeyCard({ onImported }: { onImported: () => void }) {
	const theme = useTheme();
	const [mode, setMode] = React.useState<'paste' | 'file'>('paste');
	const [label, setLabel] = React.useState('Imported Key');
	const [asDefault, setAsDefault] = React.useState(false);
	const [content, setContent] = React.useState('');
	const [fileName, setFileName] = React.useState<string | null>(null);

	const importMutation = useMutation({
		mutationFn: async () => {
			const trimmed = content.trim();
			if (!trimmed) throw new Error('No key content provided');
			const keyId = `key_${Crypto.randomUUID()}`;
			await secretsManager.keys.utils.upsertPrivateKey({
				keyId,
				metadata: {
					priority: 0,
					label: label || 'Imported Key',
					isDefault: asDefault,
				},
				value: trimmed,
			});
		},
		onSuccess: () => {
			setContent('');
			setFileName(null);
			onImported();
		},
	});

	const pickFile = React.useCallback(async () => {
		const res = await DocumentPicker.getDocumentAsync({
			multiple: false,
			copyToCacheDirectory: true,
			type: ['text/*', 'application/*'],
		});
		// Newer expo-document-picker: { canceled: boolean, assets?: [{ uri, name, ... }] }
		const canceled = 'canceled' in res ? res.canceled : false;
		if (canceled) return;
		const asset = res.assets?.[0];
		const file = asset?.file;
		if (!file) return;
		setFileName(asset.name ?? null);
		const data = await file.text();
		setContent(data);
		if (asset.name && (!label || label === 'Imported Key')) {
			setLabel(String(asset.name).replace(/\.[^.]+$/, ''));
		}
	}, [label]);

	return (
		<View
			style={{
				backgroundColor: theme.colors.surface,
				borderRadius: 12,
				borderWidth: 1,
				borderColor: theme.colors.border,
				padding: 12,
				gap: 12,
			}}
		>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontWeight: '700',
					fontSize: 16,
				}}
			>
				Import Private Key
			</Text>

			<View
				style={{
					flexDirection: 'row',
					backgroundColor: theme.colors.inputBackground,
					borderRadius: 10,
					borderWidth: 1,
					borderColor: theme.colors.border,
					overflow: 'hidden',
				}}
			>
				{(['paste', 'file'] as const).map((m) => (
					<Pressable
						key={m}
						onPress={() => setMode(m)}
						style={{
							flex: 1,
							paddingVertical: 10,
							alignItems: 'center',
							backgroundColor:
								mode === m
									? theme.colors.surface
									: theme.colors.inputBackground,
						}}
					>
						<Text
							style={{
								color:
									mode === m ? theme.colors.textPrimary : theme.colors.muted,
								fontWeight: '600',
							}}
						>
							{m === 'paste' ? 'Paste' : 'File'}
						</Text>
					</Pressable>
				))}
			</View>

			{mode === 'paste' ? (
				<TextInput
					multiline
					placeholder="Paste your private key here"
					placeholderTextColor={theme.colors.muted}
					value={content}
					onChangeText={setContent}
					style={{
						minHeight: 120,
						backgroundColor: theme.colors.inputBackground,
						color: theme.colors.textPrimary,
						borderWidth: 1,
						borderColor: theme.colors.border,
						borderRadius: 10,
						padding: 12,
						fontFamily: 'Menlo, ui-monospace, monospace',
					}}
				/>
			) : (
				<View style={{ gap: 8 }}>
					<Pressable
						onPress={pickFile}
						style={{
							backgroundColor: theme.colors.transparent,
							borderWidth: 1,
							borderColor: theme.colors.border,
							borderRadius: 10,
							paddingVertical: 12,
							alignItems: 'center',
						}}
					>
						<Text
							style={{ color: theme.colors.textSecondary, fontWeight: '600' }}
						>
							{fileName ? 'Choose Different File' : 'Choose File'}
						</Text>
					</Pressable>
					{fileName ? (
						<Text style={{ color: theme.colors.muted }}>
							Selected: {fileName}
						</Text>
					) : null}
					{content ? (
						<TextInput
							editable={false}
							multiline
							value={content.slice(0, 500)}
							style={{
								minHeight: 80,
								backgroundColor: theme.colors.inputBackground,
								color: theme.colors.textSecondary,
								borderWidth: 1,
								borderColor: theme.colors.border,
								borderRadius: 10,
								padding: 10,
								fontFamily: 'Menlo, ui-monospace, monospace',
							}}
						/>
					) : null}
				</View>
			)}

			<View style={{ gap: 8 }}>
				<Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
					Label
				</Text>
				<TextInput
					placeholder="Display name"
					placeholderTextColor={theme.colors.muted}
					value={label}
					onChangeText={setLabel}
					style={{
						backgroundColor: theme.colors.inputBackground,
						color: theme.colors.textPrimary,
						borderWidth: 1,
						borderColor: theme.colors.border,
						borderRadius: 10,
						paddingHorizontal: 12,
						paddingVertical: 10,
						fontSize: 16,
					}}
				/>
			</View>

			<Pressable
				onPress={() => setAsDefault((v) => !v)}
				style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
			>
				<View
					style={{
						width: 22,
						height: 22,
						borderRadius: 6,
						borderWidth: 2,
						borderColor: theme.colors.border,
						backgroundColor: asDefault
							? theme.colors.primary
							: theme.colors.transparent,
					}}
				/>
				<Text style={{ color: theme.colors.textSecondary }}>
					Set as default
				</Text>
			</Pressable>

			<Pressable
				disabled={importMutation.isPending}
				onPress={() => importMutation.mutate()}
				style={{
					backgroundColor: theme.colors.primary,
					borderRadius: 12,
					paddingVertical: 12,
					alignItems: 'center',
					opacity: importMutation.isPending ? 0.6 : 1,
				}}
			>
				<Text
					style={{
						color: theme.colors.buttonTextOnPrimary,
						fontWeight: '700',
					}}
				>
					{importMutation.isPending ? 'Importing…' : 'Import Key'}
				</Text>
			</Pressable>

			{importMutation.isError ? (
				<Text style={{ color: theme.colors.danger }}>
					{(importMutation.error as Error).message || 'Import failed'}
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
	const theme = useTheme();
	const entryQuery = useQuery(secretsManager.keys.query.get(props.entryId));
	const entry = entryQuery.data;
	const [label, setLabel] = React.useState(
		entry?.manifestEntry.metadata.label ?? '',
	);

	const renameMutation = useMutation({
		mutationFn: async (newLabel: string) => {
			if (!entry) return;
			await secretsManager.keys.utils.upsertPrivateKey({
				keyId: entry.manifestEntry.id,
				value: entry.value,
				metadata: {
					priority: entry.manifestEntry.metadata.priority,
					label: newLabel,
					isDefault: entry.manifestEntry.metadata.isDefault,
				},
			});
		},
		onSuccess: () => entryQuery.refetch(),
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			await secretsManager.keys.utils.deletePrivateKey(props.entryId);
		},
		onSuccess: () => entryQuery.refetch(),
	});

	const setDefaultMutation = useMutation({
		mutationFn: async () => {
			const entries = await secretsManager.keys.utils.listEntriesWithValues();
			await Promise.all(
				entries.map((e) =>
					secretsManager.keys.utils.upsertPrivateKey({
						keyId: e.id,
						value: e.value,
						metadata: {
							priority: e.metadata.priority,
							label: e.metadata.label,
							isDefault: e.id === props.entryId,
						},
					}),
				),
			);
		},
		onSuccess: async () => {
			await entryQuery.refetch();
			if (props.mode === 'select' && props.onSelected) {
				await props.onSelected(props.entryId);
			}
		},
	});

	if (!entry) return null;

	return (
		<View
			style={{
				flexDirection: 'row',
				alignItems: 'flex-start',
				justifyContent: 'space-between',
				backgroundColor: theme.colors.inputBackground,
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 12,
				paddingHorizontal: 12,
				paddingVertical: 12,
			}}
		>
			<View style={{ flex: 1, marginRight: 8 }}>
				<Text
					style={{
						color: theme.colors.textPrimary,
						fontSize: 15,
						fontWeight: '600',
					}}
				>
					{entry.manifestEntry.metadata.label ?? entry.manifestEntry.id}
					{entry.manifestEntry.metadata.isDefault ? '  • Default' : ''}
				</Text>
				<Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
					ID: {entry.manifestEntry.id}
				</Text>
				{props.mode === 'manage' ? (
					<TextInput
						style={{
							borderWidth: 1,
							borderColor: theme.colors.border,
							backgroundColor: theme.colors.inputBackground,
							color: theme.colors.textPrimary,
							borderRadius: 10,
							paddingHorizontal: 12,
							paddingVertical: 10,
							fontSize: 16,
							marginTop: 8,
						}}
						placeholder="Display name"
						placeholderTextColor={theme.colors.muted}
						value={label}
						onChangeText={setLabel}
					/>
				) : null}
			</View>
			<View style={{ gap: 6, alignItems: 'flex-end' }}>
				{props.mode === 'select' ? (
					<Pressable
						onPress={() => {
							setDefaultMutation.mutate();
						}}
						style={{
							backgroundColor: theme.colors.primary,
							borderRadius: 10,
							paddingVertical: 12,
							paddingHorizontal: 10,
							alignItems: 'center',
						}}
					>
						<Text
							style={{
								color: theme.colors.buttonTextOnPrimary,
								fontWeight: '700',
								fontSize: 12,
							}}
						>
							Select
						</Text>
					</Pressable>
				) : null}
				{props.mode === 'manage' ? (
					<Pressable
						style={[
							{
								backgroundColor: theme.colors.transparent,
								borderWidth: 1,
								borderColor: theme.colors.border,
								borderRadius: 10,
								paddingVertical: 8,
								paddingHorizontal: 10,
								alignItems: 'center',
							},
							renameMutation.isPending && { opacity: 0.6 },
						]}
						onPress={() => {
							renameMutation.mutate(label);
						}}
						disabled={renameMutation.isPending}
					>
						<Text
							style={{
								color: theme.colors.textSecondary,
								fontWeight: '600',
								fontSize: 12,
							}}
						>
							{renameMutation.isPending ? 'Saving…' : 'Save'}
						</Text>
					</Pressable>
				) : null}
				{!entry.manifestEntry.metadata.isDefault ? (
					<Pressable
						style={{
							backgroundColor: theme.colors.transparent,
							borderWidth: 1,
							borderColor: theme.colors.border,
							borderRadius: 10,
							paddingVertical: 8,
							paddingHorizontal: 10,
							alignItems: 'center',
						}}
						onPress={() => {
							setDefaultMutation.mutate();
						}}
					>
						<Text
							style={{
								color: theme.colors.textSecondary,
								fontWeight: '600',
								fontSize: 12,
							}}
						>
							Set Default
						</Text>
					</Pressable>
				) : null}
				<Pressable
					style={{
						backgroundColor: theme.colors.transparent,
						borderWidth: 1,
						borderColor: theme.colors.danger,
						borderRadius: 10,
						paddingVertical: 8,
						paddingHorizontal: 10,
						alignItems: 'center',
					}}
					onPress={() => {
						deleteMutation.mutate();
					}}
				>
					<Text
						style={{
							color: theme.colors.danger,
							fontWeight: '700',
							fontSize: 12,
						}}
					>
						Delete
					</Text>
				</Pressable>
			</View>
		</View>
	);
}
