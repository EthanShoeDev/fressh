const E2E_DISABLE_AUTO_CONNECT_PARAM = 'fresshE2eDisableAutoConnect';

export type AutoConnectLaunchAction = {
	routeToConnectionForm: boolean;
	skipAutoConnect: boolean;
};

const defaultLaunchAction: AutoConnectLaunchAction = {
	routeToConnectionForm: false,
	skipAutoConnect: false,
};

export function getAutoConnectLaunchActionForUrl(
	url: string | null,
): AutoConnectLaunchAction {
	if (!url) return defaultLaunchAction;
	try {
		const parsed = new URL(url);
		const value = parsed.searchParams.get(E2E_DISABLE_AUTO_CONNECT_PARAM);
		const skipAutoConnect = value === '1' || value === 'true';
		if (!skipAutoConnect) return defaultLaunchAction;
		return {
			routeToConnectionForm: true,
			skipAutoConnect,
		};
	} catch {
		return defaultLaunchAction;
	}
}

export function shouldSkipInitialAutoConnectForUrl(url: string | null) {
	return getAutoConnectLaunchActionForUrl(url).skipAutoConnect;
}
