import { useMutation, useQuery } from '@tanstack/react-query';
import React from 'react';
import {
	Modal,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	View,
	ActivityIndicator,
} from 'react-native';
import { secretsManager } from '../lib/secrets-manager';

export function KeyManagerModal(props: {
	visible: boolean;
	onClose: () => void;
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
                value: pair.privateKey,
            });
        },
    });

	async function handleDelete(keyId: string) {
		await secretsManager.keys.utils.deletePrivateKey(keyId);
	}

	async function handleSetDefault(keyId: string) {
		const entries = await secretsManager.keys.utils.listEntriesWithValues();
		await Promise.all(
			entries.map((e) =>
				secretsManager.keys.utils.upsertPrivateKey({
					keyId: e.id,
					value: e.value,
					metadata: {
						priority: e.metadata.priority,
						label: e.metadata.label,
						isDefault: e.id === keyId,
					},
				}),
			),
		);
	}

	async function handleGenerate() {
    await generateMutation.mutateAsync();
	}

	return (
		<Modal visible={props.visible} transparent animationType="slide">
			<View style={styles.overlay}>
				<View style={styles.sheet}>
					<View style={styles.header}>
						<Text style={styles.title}>Manage Keys</Text>
						<Pressable style={styles.closeBtn} onPress={props.onClose}>
							<Text style={styles.closeText}>Close</Text>
						</Pressable>
					</View>

                    <Pressable
                        style={[
                            styles.primaryButton,
                            generateMutation.isPending && { opacity: 0.7 },
                        ]}
                        disabled={generateMutation.isPending}
                        onPress={handleGenerate}
                    >
                        <Text style={styles.primaryButtonText}>
                            {generateMutation.isPending
                                ? 'Generating…'
                                : 'Generate New RSA 4096 Key'}
                        </Text>
                    </Pressable>

					{listKeysQuery.isLoading ? (
						<View style={styles.centerRow}>
							<ActivityIndicator color="#9AA0A6" />
							<Text style={styles.muted}> Loading keys…</Text>
						</View>
					) : listKeysQuery.isError ? (
						<Text style={styles.error}>Error loading keys</Text>
					) : listKeysQuery.data?.length ? (
						<View>
							{listKeysQuery.data.map((k) => (
								<KeyRow
									key={k.id}
									entry={k}
									onDelete={() => handleDelete(k.id)}
									onSetDefault={() => handleSetDefault(k.id)}
								/>
							))}
						</View>
					) : (
						<Text style={styles.muted}>No keys yet</Text>
					)}
				</View>
			</View>
		</Modal>
	);
}

function KeyRow(props: {
	entry: Awaited<
		ReturnType<typeof secretsManager.keys.utils.listEntriesWithValues>
	>[number];
	onDelete: () => void;
	onSetDefault: () => void;
}) {
    const [isEditing, setIsEditing] = React.useState(false);
    const [label, setLabel] = React.useState(props.entry.metadata?.label ?? '');
    const isDefault = props.entry.metadata?.isDefault;

    const renameMutation = useMutation({
        mutationFn: async (newLabel: string) => {
            await secretsManager.keys.utils.upsertPrivateKey({
                keyId: props.entry.id,
                value: props.entry.value,
                metadata: {
                    priority: props.entry.metadata.priority,
                    label: newLabel,
                    isDefault: props.entry.metadata.isDefault,
                },
            });
        },
        onSuccess: () => setIsEditing(false),
    });

    async function saveLabel() {
        await renameMutation.mutateAsync(label);
    }

	return (
		<View style={styles.row}>
			<View style={{ flex: 1, marginRight: 8 }}>
				<Text style={styles.rowTitle}>
					{(props.entry.metadata?.label ?? props.entry.id) +
						(isDefault ? '  • Default' : '')}
				</Text>
				<Text style={styles.rowSub}>ID: {props.entry.id}</Text>
				{isEditing ? (
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
				{!isDefault ? (
					<Pressable
						style={styles.secondaryButton}
						onPress={props.onSetDefault}
					>
						<Text style={styles.secondaryButtonText}>Set Default</Text>
					</Pressable>
				) : null}
                {isEditing ? (
                    <Pressable
                        style={[
                            styles.secondaryButton,
                            renameMutation.isPending && { opacity: 0.6 },
                        ]}
                        onPress={saveLabel}
                        disabled={renameMutation.isPending}
                    >
                        <Text style={styles.secondaryButtonText}>
                            {renameMutation.isPending ? 'Saving…' : 'Save'}
                        </Text>
                    </Pressable>
                ) : (
                    <Pressable
                        style={styles.secondaryButton}
                        onPress={() => setIsEditing(true)}
                    >
                        <Text style={styles.secondaryButtonText}>Rename</Text>
                    </Pressable>
                )}
				<Pressable style={styles.dangerButton} onPress={props.onDelete}>
					<Text style={styles.dangerButtonText}>Delete</Text>
				</Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	overlay: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.4)',
		justifyContent: 'flex-end',
	},
	sheet: {
		backgroundColor: '#0B1324',
		borderTopLeftRadius: 16,
		borderTopRightRadius: 16,
		padding: 16,
		borderColor: '#1E293B',
		borderWidth: 1,
	},
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 8,
	},
	title: {
		color: '#E5E7EB',
		fontSize: 18,
		fontWeight: '700',
	},
	closeBtn: {
		paddingHorizontal: 8,
		paddingVertical: 6,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: '#2A3655',
	},
	closeText: {
		color: '#C6CBD3',
		fontWeight: '600',
	},
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
	primaryButton: {
		backgroundColor: '#2563EB',
		borderRadius: 10,
		paddingVertical: 12,
		alignItems: 'center',
		marginBottom: 12,
	},
	primaryButtonText: {
		color: '#FFFFFF',
		fontWeight: '700',
		fontSize: 14,
	},
	centerRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	muted: {
		color: '#9AA0A6',
	},
	error: {
		color: '#FCA5A5',
	},
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
	rowTitle: {
		color: '#E5E7EB',
		fontSize: 15,
		fontWeight: '600',
	},
	rowSub: {
		color: '#9AA0A6',
		fontSize: 12,
		marginTop: 2,
	},
	rowActions: {
		gap: 6,
		alignItems: 'flex-end',
	},
	secondaryButton: {
		backgroundColor: 'transparent',
		borderWidth: 1,
		borderColor: '#2A3655',
		borderRadius: 10,
		paddingVertical: 8,
		paddingHorizontal: 10,
		alignItems: 'center',
	},
	secondaryButtonText: {
		color: '#C6CBD3',
		fontWeight: '600',
		fontSize: 12,
	},
	dangerButton: {
		backgroundColor: 'transparent',
		borderWidth: 1,
		borderColor: '#7F1D1D',
		borderRadius: 10,
		paddingVertical: 8,
		paddingHorizontal: 10,
		alignItems: 'center',
	},
	dangerButtonText: {
		color: '#FCA5A5',
		fontWeight: '700',
		fontSize: 12,
	},
});

export default KeyManagerModal;
