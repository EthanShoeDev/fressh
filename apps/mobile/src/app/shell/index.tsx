import {
	RnRussh,
	type SshConnection,
	type SshShellSession,
} from '@fressh/react-native-uniffi-russh';
import { FlashList } from '@shopify/flash-list';
import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

type ShellWithConnection = SshShellSession & { connection: SshConnection };

export default function ShellList() {
	const connectionsWithShells = RnRussh.listSshConnectionsWithShells();
	const shellsFirstList = connectionsWithShells.reduce<ShellWithConnection[]>(
		(acc, curr) => {
			acc.push(...curr.shells.map((shell) => ({ ...shell, connection: curr })));
			return acc;
		},
		[],
	);

	return (
		<View style={styles.container}>
			{shellsFirstList.length === 0 ? (
				<EmptyState />
			) : (
				<FlashList
					data={shellsFirstList}
					renderItem={({ item }) => <ShellCard shell={item} />}
					// maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 0.2 }}
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
	text: { color: '#E5E7EB', marginBottom: 8 },
});
