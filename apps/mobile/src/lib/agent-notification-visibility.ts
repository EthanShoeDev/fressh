import { createAgentNotificationRouteIdentityKey } from './agent-notification-route-identity';
import { buildTmuxCurrentWindowIdCommand } from './host-browser-actions';
import { rootLogger } from './logger';
import { buildTmuxSelectWindowCommand } from './tmux-scrollback';

const logger = rootLogger.extend('AgentNotificationVisibility');

export type VisibleAgentNotificationSnapshot = {
	isFocused: boolean;
	isAppActive: boolean;
	connectionId: string | null;
	channelId: number | null;
	tmuxTarget: string;
};

export type VisibleAgentNotificationAcknowledgeOptions = {
	platformOS: string;
	connectionId: string | null;
	channelId: number;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	getVisibility: () => VisibleAgentNotificationSnapshot;
	nextRequestId: () => number;
	isCurrentRequest: (requestId: number) => boolean;
	runCommand: (command: string, timeoutMs: number) => Promise<string>;
	acknowledge: (
		connectionId: string,
		session: string,
		windowId: string,
	) => void;
	warn: (message: string, error: unknown) => void;
};

export type AgentNotificationRouteOptions = {
	agentConnectionId: string | null;
	storedConnectionId: string | null | undefined;
	agentSession: string | null;
	agentWindowId: string | null;
	agentEventId: string | null;
	agentTapToken: string | null;
	tmuxTarget: string;
	isRouteHandled: (routeKey: string) => boolean;
	markRouteHandled: (routeKey: string) => void;
	consumeAuthorizedRouteToken: (
		connectionId: string,
		session: string,
		windowId: string,
		eventId: string,
		tapToken: string,
	) => boolean;
	restoreAuthorizedRouteToken?: (
		connectionId: string,
		session: string,
		windowId: string,
		eventId: string,
		tapToken: string,
	) => boolean;
	runCommand: (command: string, timeoutMs: number) => Promise<string>;
	acknowledge: (
		connectionId: string,
		session: string,
		windowId: string,
	) => void;
	warn: (message: string, error: unknown) => void;
};

const pendingListeners = new Set<() => void>();
let acknowledgeInFlight = false;
let acknowledgeQueued = false;
let latestAcknowledgeOptions: VisibleAgentNotificationAcknowledgeOptions | null =
	null;
let queuedAcknowledgeWaiters: {
	resolve: () => void;
	reject: (error: unknown) => void;
}[] = [];

export function subscribeAgentNotificationPending(listener: () => void) {
	pendingListeners.add(listener);
	return () => {
		pendingListeners.delete(listener);
	};
}

export function notifyAgentNotificationPending() {
	for (const listener of Array.from(pendingListeners)) {
		try {
			listener();
		} catch (error) {
			logger.warn('agent notification pending listener failed', error);
		}
	}
}

export async function handleAgentNotificationRoute({
	agentConnectionId,
	storedConnectionId,
	agentSession,
	agentWindowId,
	agentEventId,
	agentTapToken,
	tmuxTarget,
	isRouteHandled,
	markRouteHandled,
	consumeAuthorizedRouteToken,
	restoreAuthorizedRouteToken,
	runCommand,
	acknowledge,
	warn,
}: AgentNotificationRouteOptions) {
	const notificationConnectionId = agentConnectionId || storedConnectionId;
	if (!agentWindowId || !notificationConnectionId) {
		return false;
	}
	if (
		agentConnectionId &&
		storedConnectionId &&
		agentConnectionId !== storedConnectionId
	) {
		return false;
	}
	const session = agentSession || tmuxTarget.trim() || 'main';
	if (!agentEventId || !agentTapToken) {
		return false;
	}
	const routeKey = createAgentNotificationRouteIdentityKey({
		connectionId: notificationConnectionId,
		session,
		windowId: agentWindowId,
		eventId: agentEventId,
	});
	if (isRouteHandled(routeKey)) return false;
	let consumedRouteToken = false;
	try {
		consumedRouteToken = consumeAuthorizedRouteToken(
			notificationConnectionId,
			session,
			agentWindowId,
			agentEventId,
			agentTapToken,
		);
	} catch (error) {
		warn('failed to consume agent notification route token', error);
		return false;
	}
	if (!consumedRouteToken) {
		return false;
	}

	try {
		await runCommand(
			buildTmuxSelectWindowCommand(session, agentWindowId),
			10_000,
		);
		markRouteHandled(routeKey);
		acknowledge(notificationConnectionId, session, agentWindowId);
		return true;
	} catch (error) {
		if (restoreAuthorizedRouteToken) {
			try {
				restoreAuthorizedRouteToken(
					notificationConnectionId,
					session,
					agentWindowId,
					agentEventId,
					agentTapToken,
				);
			} catch (restoreError) {
				warn('failed to restore agent notification route token', restoreError);
			}
		}
		warn('failed to select agent notification window', error);
		return false;
	}
}

export async function acknowledgeVisibleAgentNotification({
	platformOS,
	connectionId,
	channelId,
	tmuxEnabled,
	tmuxTarget,
	getVisibility,
	nextRequestId,
	isCurrentRequest,
	runCommand,
	acknowledge,
	warn,
}: VisibleAgentNotificationAcknowledgeOptions) {
	const options = {
		platformOS,
		connectionId,
		channelId,
		tmuxEnabled,
		tmuxTarget,
		getVisibility,
		nextRequestId,
		isCurrentRequest,
		runCommand,
		acknowledge,
		warn,
	};
	if (acknowledgeInFlight) {
		latestAcknowledgeOptions = options;
		acknowledgeQueued = true;
		return new Promise<void>((resolve, reject) => {
			queuedAcknowledgeWaiters.push({ resolve, reject });
		});
	}
	acknowledgeInFlight = true;
	let activeQueuedWaiters: typeof queuedAcknowledgeWaiters = [];
	try {
		let activeOptions = options;
		do {
			acknowledgeQueued = false;
			latestAcknowledgeOptions = null;
			await acknowledgeVisibleAgentNotificationOnce(activeOptions);
			for (const waiter of activeQueuedWaiters) waiter.resolve();
			activeQueuedWaiters = [];
			if (acknowledgeQueued && latestAcknowledgeOptions) {
				activeOptions = latestAcknowledgeOptions;
				activeQueuedWaiters = queuedAcknowledgeWaiters;
				queuedAcknowledgeWaiters = [];
			}
		} while (acknowledgeQueued);
	} catch (error) {
		for (const waiter of activeQueuedWaiters) waiter.reject(error);
		for (const waiter of queuedAcknowledgeWaiters) waiter.reject(error);
		queuedAcknowledgeWaiters = [];
		throw error;
	} finally {
		latestAcknowledgeOptions = null;
		acknowledgeInFlight = false;
	}
}

async function acknowledgeVisibleAgentNotificationOnce({
	platformOS,
	connectionId,
	channelId,
	tmuxEnabled,
	tmuxTarget,
	getVisibility,
	nextRequestId,
	isCurrentRequest,
	runCommand,
	acknowledge,
	warn,
}: VisibleAgentNotificationAcknowledgeOptions) {
	if (platformOS !== 'android') return;
	if (!connectionId || !tmuxEnabled) return;

	const initialVisibility = getVisibility();
	if (!initialVisibility.isFocused || !initialVisibility.isAppActive) return;

	try {
		const sessionName = tmuxTarget.trim() || 'main';
		const requestId = nextRequestId();
		const connectionIdSnapshot = connectionId;
		const channelIdSnapshot = channelId;
		const sessionNameSnapshot = sessionName;
		const output = await runCommand(
			buildTmuxCurrentWindowIdCommand(sessionName),
			10_000,
		);
		const windowId = output
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.at(-1);
		const visibility = getVisibility();
		if (!windowId || !visibility.isFocused || !visibility.isAppActive) return;
		if (!isCurrentRequest(requestId)) return;
		if (visibility.connectionId !== connectionIdSnapshot) return;
		if (visibility.channelId !== channelIdSnapshot) return;
		if (visibility.tmuxTarget !== sessionNameSnapshot) return;
		acknowledge(connectionIdSnapshot, sessionNameSnapshot, windowId);
	} catch (error) {
		warn('agent notification acknowledge failed', error);
	}
}
