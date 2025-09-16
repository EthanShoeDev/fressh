import { useMutation, useQuery } from '@tanstack/react-query';
import React from 'react';
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native';
import { secretsManager } from '@/lib/secrets-manager';

export type KeyListMode = 'manage' | 'select';

export function KeyList(props: {
	mode: KeyListMode;
	onSelect?: (id: string) => void | Promise<void>;
}) {
	const listKeysQuery = useQuery(secretsManager.keys.query.list);

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
		<ScrollView contentContainerStyle={{ padding: 16 }}>
			<Pressable
				style={[
					styles.primaryButton,
					generateMutation.isPending && { opacity: 0.7 },
				]}
				disabled={generateMutation.isPending}
				onPress={() => generateMutation.mutate()}
			>
				<Text style={styles.primaryButtonText}>
					{generateMutation.isPending
						? 'Generating…'
						: 'Generate New RSA 4096 Key'}
				</Text>
			</Pressable>

			{listKeysQuery.isLoading ? (
				<Text style={styles.muted}>Loading keys…</Text>
			) : listKeysQuery.isError ? (
				<Text style={styles.error}>Error loading keys</Text>
			) : listKeysQuery.data?.length ? (
				<View>
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
				<Text style={styles.muted}>No keys yet</Text>
			)}
		</ScrollView>
	);
}

function KeyRow(props: {
	entryId: string;
	mode: KeyListMode;
	onSelected?: (id: string) => void | Promise<void>;
}) {
	const entryQuery = useQuery(secretsManager.keys.query.get(props.entryId));
	const entry = entryQuery.data;
	const [label, setLabel] = React.useState(
		entry?.manifestEntry.metadata?.label ?? '',
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
		<View style={styles.row}>
			<View style={{ flex: 1, marginRight: 8 }}>
				<Text style={styles.rowTitle}>
					{entry.manifestEntry.metadata?.label ?? entry.manifestEntry.id}
					{entry.manifestEntry.metadata?.isDefault ? '  • Default' : ''}
				</Text>
				<Text style={styles.rowSub}>ID: {entry.manifestEntry.id}</Text>
				{props.mode === 'manage' ? (
					<TextInput
						style={styles.input}
						placeholder="Display name"
						placeholderTextColor="#9AA0A6"
						value={label}
						onChangeText={setLabel}
					/>
				) : null}
			</View>
			<View style={styles.rowActions}>
				{props.mode === 'select' ? (
					<Pressable
						onPress={() => setDefaultMutation.mutate()}
						style={styles.primaryButton}
					>
						<Text style={styles.primaryButtonText}>Select</Text>
					</Pressable>
				) : null}
				{props.mode === 'manage' ? (
					<Pressable
						style={[
							styles.secondaryButton,
							renameMutation.isPending && { opacity: 0.6 },
						]}
						onPress={() => renameMutation.mutate(label)}
						disabled={renameMutation.isPending}
					>
						<Text style={styles.secondaryButtonText}>
							{renameMutation.isPending ? 'Saving…' : 'Save'}
						</Text>
					</Pressable>
				) : null}
				{!entry.manifestEntry.metadata?.isDefault ? (
					<Pressable
						style={styles.secondaryButton}
						onPress={() => setDefaultMutation.mutate()}
					>
						<Text style={styles.secondaryButtonText}>Set Default</Text>
					</Pressable>
				) : null}
				<Pressable
					style={styles.dangerButton}
					onPress={() => deleteMutation.mutate()}
				>
					<Text style={styles.dangerButtonText}>Delete</Text>
				</Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	primaryButton: {
		backgroundColor: '#2563EB',
		borderRadius: 10,
		paddingVertical: 12,
		alignItems: 'center',
		marginBottom: 12,
	},
	primaryButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
	muted: { color: '#9AA0A6' },
	error: { color: '#FCA5A5' },
	row: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		justifyContent: 'space-between',
		backgroundColor: '#0E172B',
		borderWidth: 1,
		borderColor: '#2A3655',
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		marginBottom: 10,
	},
	rowTitle: { color: '#E5E7EB', fontSize: 15, fontWeight: '600' },
	rowSub: { color: '#9AA0A6', fontSize: 12, marginTop: 2 },
	rowActions: { gap: 6, alignItems: 'flex-end' },
	secondaryButton: {
		backgroundColor: 'transparent',
		borderWidth: 1,
		borderColor: '#2A3655',
		borderRadius: 10,
		paddingVertical: 8,
		paddingHorizontal: 10,
		alignItems: 'center',
	},
	secondaryButtonText: { color: '#C6CBD3', fontWeight: '600', fontSize: 12 },
	dangerButton: {
		backgroundColor: 'transparent',
		borderWidth: 1,
		borderColor: '#7F1D1D',
		borderRadius: 10,
		paddingVertical: 8,
		paddingHorizontal: 10,
		alignItems: 'center',
	},
	dangerButtonText: { color: '#FCA5A5', fontWeight: '700', fontSize: 12 },
	input: {
		borderWidth: 1,
		borderColor: '#2A3655',
		backgroundColor: '#0E172B',
		color: '#E5E7EB',
		borderRadius: 10,
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 16,
		marginTop: 8,
	},
});
