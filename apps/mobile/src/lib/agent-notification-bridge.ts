export const HEARTBEAT_STALE_MS = 75_000;

export type AgentNotificationBridgeStatus =
	| 'inactive'
	| 'starting'
	| 'active'
	| 'degraded'
	| 'stopped-by-os-or-connection';

export type AgentNotificationBridgeState = {
	status: AgentNotificationBridgeStatus;
	lastHeartbeatAtMs: number | null;
	lastSeenId: string | null;
};

export class AgentNotificationBridgeStateMachine {
	private currentState: AgentNotificationBridgeState = {
		status: 'inactive',
		lastHeartbeatAtMs: null,
		lastSeenId: null,
	};

	get state(): AgentNotificationBridgeState {
		return { ...this.currentState };
	}

	markStarting(): void {
		this.currentState = {
			...this.currentState,
			status: 'starting',
		};
	}

	recordHeartbeat(nowMs: number): void {
		this.currentState = {
			...this.currentState,
			status: 'active',
			lastHeartbeatAtMs: nowMs,
		};
	}

	recordEventId(id: string): void {
		this.currentState = {
			...this.currentState,
			lastSeenId: id,
		};
	}

	checkHeartbeat(nowMs: number): void {
		const { lastHeartbeatAtMs, status } = this.currentState;
		if (status !== 'active' && status !== 'degraded') return;
		if (lastHeartbeatAtMs === null) return;
		if (nowMs - lastHeartbeatAtMs < HEARTBEAT_STALE_MS) return;
		this.markDegraded();
	}

	markDegraded(): void {
		this.currentState = {
			...this.currentState,
			status: 'degraded',
		};
	}

	markInactive(): void {
		this.currentState = {
			...this.currentState,
			status: 'inactive',
		};
	}

	markStoppedByOsOrConnection(): void {
		this.currentState = {
			...this.currentState,
			status: 'stopped-by-os-or-connection',
		};
	}
}
