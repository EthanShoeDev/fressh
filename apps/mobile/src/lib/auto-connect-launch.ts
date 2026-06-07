const E2E_DISABLE_AUTO_CONNECT_PARAM = 'fresshE2eDisableAutoConnect';

export function shouldSkipInitialAutoConnectForUrl(url: string | null) {
	if (!url) return false;
	try {
		const parsed = new URL(url);
		const value = parsed.searchParams.get(E2E_DISABLE_AUTO_CONNECT_PARAM);
		return value === '1' || value === 'true';
	} catch {
		return false;
	}
}
