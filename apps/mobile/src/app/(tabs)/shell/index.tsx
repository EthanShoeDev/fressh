import {
	type RnRussh,
	type SshConnection,
	type SshShellSession,
} from '@fressh/react-native-uniffi-russh';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { listSshShellsQueryOptions } from '@/lib/query-fns';

export default function TabsShellList() {
	return <ShellList />;
}

type ShellWithConnection = SshShellSession & { connection: SshConnection };

function ShellList() {
	const connectionsWithShells = useQuery(listSshShellsQueryOptions);

	if (!connectionsWithShells.data) {
		return <LoadingState />;
	}
	return <LoadedState connectionsWithShells={connectionsWithShells.data} />;
}

function LoadingState() {
	return (
		<View style={styles.container}>
			<Text style={styles.text}>Loading...</Text>
		</View>
	);
}

function LoadedState({
	connectionsWithShells,
}: {
	connectionsWithShells: ReturnType<
		typeof RnRussh.listSshConnectionsWithShells
	>;
}) {
	const shellsFirstList = connectionsWithShells.reduce<ShellWithConnection[]>(
		(acc, curr) => {
			acc.push(...curr.shells.map((shell) => ({ ...shell, connection: curr })));
			return acc;
		},
		[],
	);

	return (
		<View style={{ flex: 1 }}>
			{shellsFirstList.length === 0 ? (
				<EmptyState />
			) : (
				<FlashList
					data={shellsFirstList}
					keyExtractor={(item) => `${item.connectionId}:${item.channelId}`}
					renderItem={({ item }) => <ShellCard shell={item} />}
					ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
					contentContainerStyle={{ paddingVertical: 16 }}
					style={{ flex: 1 }}
				/>
			)}
		</View>
	);
}

function EmptyState() {
	return (
		<View style={styles.container}>
			<Text style={styles.text}>No active shells. Connect from Host tab.</Text>
			<Link href="/">Go to Host</Link>
		</View>
	);
}

function ShellCard({ shell }: { shell: ShellWithConnection }) {
	return (
		<View style={styles.container}>
			<Text style={styles.text}>{shell.connectionId}</Text>
			<Text style={styles.text}>{shell.createdAtMs}</Text>
			<Text style={styles.text}>{shell.pty}</Text>
			<Text style={styles.text}>{shell.connection.connectionDetails.host}</Text>
			<Text style={styles.text}>{shell.connection.connectionDetails.port}</Text>
			<Text style={styles.text}>
				{shell.connection.connectionDetails.username}
			</Text>
			<Text style={styles.text}>
				{shell.connection.connectionDetails.security.type}
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
	text: { color: 'black', marginBottom: 8 },
});
