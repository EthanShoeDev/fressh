import { Terminal } from '@fressh/react-native-terminal';
import { View } from 'react-native';

/**
 * Temporary test screen for the native terminal renderer PoC. Renders the
 * hardcoded demo terminal (uses the bundled DejaVu Sans Mono when fontPath="").
 */
export default function TerminalTestScreen() {
	return (
		<View className='flex-1 bg-black'>
			<Terminal fontPath='' style={{ flex: 1 }} />
		</View>
	);
}
