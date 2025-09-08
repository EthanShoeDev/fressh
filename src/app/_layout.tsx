import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { queryClient } from '../lib/utils'

export default function RootLayout() {
	return (
		<QueryClientProvider client={queryClient}>
			<Stack screenOptions={{ headerShown: false }} />
		</QueryClientProvider>
	)
}
