# Fressh Android Agent Notification Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Fressh Android bridge that listens to M-Dev tmux notification events over SSH and posts best-effort local Android notifications.

**Architecture:** Fressh starts one long-lived `mdev tmux notifications listen` shell channel while an Android foreground-service tmux shell is alive. Pure TypeScript modules parse JSONL, dedupe per `connectionId | session | windowId`, track bridge health, and build remote commands; a native Android module posts/cancels alert notifications on channel `fressh_agent_alerts`. The design remains best-effort connected delivery: no polling for remote status, no cloud push, and no guarantee after Android stops the service or SSH connection.

**Tech Stack:** Expo React Native, TypeScript, Node `tsx --test` integration tests, Expo config plugin-generated Kotlin, existing UniFFI russh SSH shell API.

---

## Scope

Implement only the Fressh side tracked by [mulyoved/fressh#56](https://github.com/mulyoved/fressh/issues/56). This plan assumes the M-Dev command from [mulyoved/skills#39](https://github.com/mulyoved/skills/issues/39) exists by the time manual end-to-end verification runs.

Source repo for execution: `/home/muly/fressh`.

Design reference: `/home/muly/fressh/docs/superpowers/specs/2026-05-22-mdev-tmux-status-android-notifications-design.md`.

## File Structure

- Create `apps/mobile/src/lib/agent-notification-events.ts`
  - Pure parser, command builders, pending-key helpers, notification-id hashing, and dedupe store.
- Create `apps/mobile/test/integration/agent-notification-events.test.ts`
  - Node tests for parser, command builders, dedupe, and notification ids.
- Modify `apps/mobile/plugins/with-foreground-service.ts`
  - Extend generated Kotlin module to create `fressh_agent_alerts`, post agent notifications, and cancel them without touching the SSH foreground notification.
- Create `apps/mobile/src/lib/agent-notifications-native.ts`
  - TypeScript wrapper around native notification methods.
- Create `apps/mobile/test/integration/agent-notifications-native-plugin.test.ts`
  - String-level tests for generated Kotlin channel/method behavior.
- Create `apps/mobile/src/lib/ssh-jsonl-listener.ts`
  - Opens a long-lived non-tmux SSH shell, starts the listener command, splits stdout into lines, and exposes a stop handle.
- Create `apps/mobile/test/integration/ssh-jsonl-listener.test.ts`
  - Fake shell tests for chunk splitting, malformed line isolation, and cleanup.
- Create `apps/mobile/src/lib/agent-notification-bridge.ts`
  - Bridge state machine/controller helpers for health transitions, heartbeat stale detection, restart backoff, and event handling.
- Create `apps/mobile/test/integration/agent-notification-bridge.test.ts`
  - Pure tests for bridge health, dedupe, stale heartbeat, resume restart, and notification calls.
- Create `apps/mobile/src/lib/AgentNotificationBridgeManager.tsx`
  - React component mounted from `AutoConnectManager` that wires the store, listener, native notifications, and lifecycle.
- Modify `apps/mobile/src/lib/auto-connect.tsx`
  - Render `AgentNotificationBridgeManager`.
- Modify `apps/mobile/src/lib/host-browser-actions.ts`
  - Add current-window-id command builder for visible-window acknowledgement.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Acknowledge matching pending notifications when the visible tmux window id is observed.
- Modify `apps/mobile/test/integration/host-browser-actions.test.ts`
  - Cover the current-window-id command builder.

## Task 1: Event Parser, Commands, Dedupe, And IDs

**Files:**
- Create: `/home/muly/fressh/apps/mobile/src/lib/agent-notification-events.ts`
- Create: `/home/muly/fressh/apps/mobile/test/integration/agent-notification-events.test.ts`
- Modify: `/home/muly/fressh/apps/mobile/src/lib/host-browser-actions.ts`
- Modify: `/home/muly/fressh/apps/mobile/test/integration/host-browser-actions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/home/muly/fressh/apps/mobile/test/integration/agent-notification-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentNotificationDedupe,
	buildAgentNotificationListenCommand,
	createAgentNotificationPendingKey,
	createStableNotificationId,
	parseAgentNotificationLine,
} from '../../src/lib/agent-notification-events';

void test('parseAgentNotificationLine accepts tmux status events and heartbeats', () => {
	assert.deepEqual(
		parseAgentNotificationLine(
			JSON.stringify({
				id: 'main:@12:1000:waiting',
				type: 'tmux_status',
				session: 'main',
				target: 'main:4',
				windowId: '@12',
				windowIndex: '4',
				windowName: 'fressh',
				status: 'waiting',
				icon: '💬',
				createdAtMs: 1000,
			}),
		),
		{
			id: 'main:@12:1000:waiting',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'fressh',
			status: 'waiting',
			icon: '💬',
			createdAtMs: 1000,
		},
	);
	assert.deepEqual(
		parseAgentNotificationLine(
			'{"type":"heartbeat","session":"main","createdAtMs":2000}',
		),
		{ type: 'heartbeat', session: 'main', createdAtMs: 2000 },
	);
});

void test('parseAgentNotificationLine rejects malformed lines', () => {
	assert.equal(parseAgentNotificationLine('not json'), null);
	assert.equal(parseAgentNotificationLine('{"type":"tmux_status"}'), null);
	assert.equal(
		parseAgentNotificationLine(
			'{"type":"tmux_status","status":"working","icon":"🤖"}',
		),
		null,
	);
});

void test('listen command quotes session and since id', () => {
	assert.equal(
		buildAgentNotificationListenCommand("main'quoted"),
		"mdev tmux notifications listen --session 'main'\\''quoted'",
	);
	assert.equal(
		buildAgentNotificationListenCommand('main', "main:@12:1:'bad"),
		"mdev tmux notifications listen --session 'main' --since-id 'main:@12:1:'\\''bad'",
	);
});

void test('pending keys and notification ids are stable', () => {
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	assert.equal(key, 'conn-1|main|@12');
	assert.equal(createStableNotificationId(key), createStableNotificationId(key));
	assert.notEqual(
		createStableNotificationId(key),
		createStableNotificationId('conn-1|main|@13'),
	);
});

void test('dedupe posts once until matching key is acknowledged', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = 'conn-1|main|@12';

	assert.equal(dedupe.markPendingIfNew(key, 42), true);
	assert.equal(dedupe.markPendingIfNew(key, 42), false);
	assert.deepEqual(dedupe.acknowledge(key), [42]);
	assert.equal(dedupe.markPendingIfNew(key, 42), true);
});
```

Append to `/home/muly/fressh/apps/mobile/test/integration/host-browser-actions.test.ts` imports and tests:

```ts
	buildTmuxCurrentWindowIdCommand,
```

```ts
void test('current window id command shell-quotes tmux session', () => {
	assert.equal(
		buildTmuxCurrentWindowIdCommand("main'quoted"),
		"tmux display-message -p -t 'main'\\''quoted:' '#{window_id}'",
	);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test test/integration/agent-notification-events.test.ts test/integration/host-browser-actions.test.ts
```

Expected: FAIL because `agent-notification-events.ts` and `buildTmuxCurrentWindowIdCommand` do not exist.

- [ ] **Step 3: Implement event helpers**

Create `/home/muly/fressh/apps/mobile/src/lib/agent-notification-events.ts`:

```ts
import { quoteShell } from './host-browser-actions';

export type AgentNotificationStatus = 'waiting' | 'done';

export type AgentNotificationEvent = {
	id: string;
	type: 'tmux_status';
	session: string;
	target: string;
	windowId: string;
	windowIndex: string;
	windowName: string;
	status: AgentNotificationStatus;
	icon: '💬' | '✅';
	createdAtMs: number;
};

export type AgentNotificationHeartbeat = {
	type: 'heartbeat';
	session: string;
	createdAtMs: number;
};

export type AgentNotificationLine =
	| AgentNotificationEvent
	| AgentNotificationHeartbeat;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function parseAgentNotificationLine(
	line: string,
): AgentNotificationLine | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) return null;

	if (parsed.type === 'heartbeat') {
		if (
			typeof parsed.session !== 'string' ||
			typeof parsed.createdAtMs !== 'number'
		) {
			return null;
		}
		return {
			type: 'heartbeat',
			session: parsed.session,
			createdAtMs: parsed.createdAtMs,
		};
	}

	if (parsed.type !== 'tmux_status') return null;
	if (parsed.status !== 'waiting' && parsed.status !== 'done') return null;
	if (parsed.icon !== '💬' && parsed.icon !== '✅') return null;
	const stringKeys = [
		'id',
		'session',
		'target',
		'windowId',
		'windowIndex',
		'windowName',
	] as const;
	for (const key of stringKeys) {
		if (typeof parsed[key] !== 'string') return null;
	}
	if (typeof parsed.createdAtMs !== 'number') return null;

	return {
		id: parsed.id,
		type: 'tmux_status',
		session: parsed.session,
		target: parsed.target,
		windowId: parsed.windowId,
		windowIndex: parsed.windowIndex,
		windowName: parsed.windowName,
		status: parsed.status,
		icon: parsed.icon,
		createdAtMs: parsed.createdAtMs,
	};
}

export function buildAgentNotificationListenCommand(
	session: string,
	sinceId?: string | null,
): string {
	const parts = [
		'mdev tmux notifications listen --session',
		quoteShell(session),
	];
	if (sinceId) {
		parts.push('--since-id', quoteShell(sinceId));
	}
	return parts.join(' ');
}

export function createAgentNotificationPendingKey(input: {
	connectionId: string;
	session: string;
	windowId: string;
}) {
	return `${input.connectionId}|${input.session}|${input.windowId}`;
}

export function createStableNotificationId(key: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i += 1) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export class AgentNotificationDedupe {
	private readonly pending = new Map<string, number>();

	markPendingIfNew(key: string, notificationId: number) {
		if (this.pending.has(key)) return false;
		this.pending.set(key, notificationId);
		return true;
	}

	acknowledge(key: string) {
		const notificationId = this.pending.get(key);
		if (notificationId === undefined) return [];
		this.pending.delete(key);
		return [notificationId];
	}

	acknowledgeMatching(predicate: (key: string) => boolean) {
		const ids: number[] = [];
		for (const [key, notificationId] of this.pending) {
			if (!predicate(key)) continue;
			this.pending.delete(key);
			ids.push(notificationId);
		}
		return ids;
	}
}
```

In `/home/muly/fressh/apps/mobile/src/lib/host-browser-actions.ts`, add:

```ts
export function buildTmuxCurrentWindowIdCommand(
	tmuxSessionName: string,
): string {
	return `tmux display-message -p -t ${quoteShell(`${tmuxSessionName}:`)} '#{window_id}'`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test test/integration/agent-notification-events.test.ts test/integration/host-browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/muly/fressh
git add apps/mobile/src/lib/agent-notification-events.ts apps/mobile/test/integration/agent-notification-events.test.ts apps/mobile/src/lib/host-browser-actions.ts apps/mobile/test/integration/host-browser-actions.test.ts
git commit -m "Add agent notification event helpers"
```

## Task 2: Native Android Agent Notification Methods

**Files:**
- Modify: `/home/muly/fressh/apps/mobile/plugins/with-foreground-service.ts`
- Create: `/home/muly/fressh/apps/mobile/src/lib/agent-notifications-native.ts`
- Create: `/home/muly/fressh/apps/mobile/test/integration/agent-notifications-native-plugin.test.ts`

- [ ] **Step 1: Write failing plugin tests**

Create `/home/muly/fressh/apps/mobile/test/integration/agent-notifications-native-plugin.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function foregroundPluginSource() {
	return readFile(
		new URL('../../plugins/with-foreground-service.ts', import.meta.url)
			.pathname,
		'utf8',
	);
}

void test('foreground service plugin defines a separate agent alert channel', async () => {
	const source = await foregroundPluginSource();

	assert.match(source, /AGENT_ALERT_CHANNEL_ID = "fressh_agent_alerts"/);
	assert.match(source, /AGENT_ALERT_CHANNEL_NAME = "Fressh Agent Alerts"/);
	assert.match(source, /NotificationManager\.IMPORTANCE_DEFAULT/);
});

void test('foreground service native module exposes agent alert methods', async () => {
	const source = await foregroundPluginSource();

	assert.match(source, /fun postAgentAlert\(/);
	assert.match(source, /fun cancelAgentAlert\(/);
	assert.match(source, /notify\(notificationId, buildAgentAlertNotification/);
	assert.match(source, /cancel\(notificationId\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test test/integration/agent-notifications-native-plugin.test.ts
```

Expected: FAIL because the generated Kotlin template does not include agent alert channel/methods.

- [ ] **Step 3: Extend generated Kotlin template**

In `/home/muly/fressh/apps/mobile/plugins/with-foreground-service.ts`, update `SSH_FOREGROUND_SERVICE_KOTLIN` inside the template:

Add agent channel creation inside `ensureNotificationChannel()` after the existing channel:

```kotlin
    val alertChannel = NotificationChannel(
      AGENT_ALERT_CHANNEL_ID,
      AGENT_ALERT_CHANNEL_NAME,
      NotificationManager.IMPORTANCE_DEFAULT
    )
    alertChannel.description = AGENT_ALERT_CHANNEL_DESCRIPTION
    manager.createNotificationChannel(alertChannel)
```

Add this Kotlin method inside `SshForegroundService` before `acquireWakeLock()`:

```kotlin
  private fun buildAgentAlertNotification(
    title: String,
    message: String,
    connectionId: String,
    session: String,
    target: String,
    windowId: String
  ): Notification {
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra(EXTRA_AGENT_CONNECTION_ID, connectionId)
      putExtra(EXTRA_AGENT_SESSION, session)
      putExtra(EXTRA_AGENT_TARGET, target)
      putExtra(EXTRA_AGENT_WINDOW_ID, windowId)
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      connectionId.hashCode() xor windowId.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    return NotificationCompat.Builder(this, AGENT_ALERT_CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(message)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .build()
  }

  fun postAgentAlert(
    notificationId: Int,
    title: String,
    message: String,
    connectionId: String,
    session: String,
    target: String,
    windowId: String
  ) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(
      notificationId,
      buildAgentAlertNotification(title, message, connectionId, session, target, windowId)
    )
  }

  fun cancelAgentAlert(notificationId: Int) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(notificationId)
  }
```

Add constants in the companion object:

```kotlin
    private const val AGENT_ALERT_CHANNEL_ID = "fressh_agent_alerts"
    private const val AGENT_ALERT_CHANNEL_NAME = "Fressh Agent Alerts"
    private const val AGENT_ALERT_CHANNEL_DESCRIPTION = "Agent status notifications"
    const val EXTRA_AGENT_CONNECTION_ID = "agentConnectionId"
    const val EXTRA_AGENT_SESSION = "agentSession"
    const val EXTRA_AGENT_TARGET = "agentTarget"
    const val EXTRA_AGENT_WINDOW_ID = "agentWindowId"
```

Update `FOREGROUND_SERVICE_MODULE_KOTLIN` with methods inside `ForegroundServiceModule`:

```kotlin
  @ReactMethod
  fun postAgentAlert(
    notificationId: Int,
    title: String,
    message: String,
    connectionId: String,
    session: String,
    target: String,
    windowId: String,
    promise: Promise
  ) {
    try {
      val serviceIntent = Intent(reactContext, SshForegroundService::class.java)
      val service = reactContext.getSystemService(android.app.ActivityManager::class.java)
      val appContext = reactContext.applicationContext
      val notificationManager = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val intent = Intent(appContext, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(SshForegroundService.EXTRA_AGENT_CONNECTION_ID, connectionId)
        putExtra(SshForegroundService.EXTRA_AGENT_SESSION, session)
        putExtra(SshForegroundService.EXTRA_AGENT_TARGET, target)
        putExtra(SshForegroundService.EXTRA_AGENT_WINDOW_ID, windowId)
      }
      val pendingIntent = PendingIntent.getActivity(
        appContext,
        connectionId.hashCode() xor windowId.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val notification = NotificationCompat.Builder(appContext, "fressh_agent_alerts")
        .setContentTitle(title)
        .setContentText(message)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentIntent(pendingIntent)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build()
      notificationManager.notify(notificationId, notification)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("AGENT_ALERT_POST_FAILED", e)
    }
  }

  @ReactMethod
  fun cancelAgentAlert(notificationId: Int, promise: Promise) {
    try {
      val manager = reactContext.applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(notificationId)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("AGENT_ALERT_CANCEL_FAILED", e)
    }
  }
```

Also ensure `FOREGROUND_SERVICE_MODULE_KOTLIN` imports `android.app.NotificationManager`, `android.app.PendingIntent`, `android.content.Context`, `android.content.Intent`, and `androidx.core.app.NotificationCompat`.

- [ ] **Step 4: Add TypeScript wrapper**

Create `/home/muly/fressh/apps/mobile/src/lib/agent-notifications-native.ts`:

```ts
import { NativeModules, Platform } from 'react-native';
import { rootLogger } from './logger';

const logger = rootLogger.extend('AgentNotifications');

type AgentNotificationsNativeModule = {
	postAgentAlert: (
		notificationId: number,
		title: string,
		message: string,
		connectionId: string,
		session: string,
		target: string,
		windowId: string,
	) => Promise<void>;
	cancelAgentAlert: (notificationId: number) => Promise<void>;
};

const nativeModule = NativeModules.FresshForegroundService as
	| AgentNotificationsNativeModule
	| undefined;

export async function postAgentAlertNotification(input: {
	notificationId: number;
	title: string;
	message: string;
	connectionId: string;
	session: string;
	target: string;
	windowId: string;
}) {
	if (Platform.OS !== 'android' || !nativeModule) return;
	try {
		await nativeModule.postAgentAlert(
			input.notificationId,
			input.title,
			input.message,
			input.connectionId,
			input.session,
			input.target,
			input.windowId,
		);
	} catch (error) {
		logger.warn('agent alert notification post failed', error);
	}
}

export async function cancelAgentAlertNotification(notificationId: number) {
	if (Platform.OS !== 'android' || !nativeModule) return;
	try {
		await nativeModule.cancelAgentAlert(notificationId);
	} catch (error) {
		logger.warn('agent alert notification cancel failed', error);
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test test/integration/agent-notifications-native-plugin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/muly/fressh
git add apps/mobile/plugins/with-foreground-service.ts apps/mobile/src/lib/agent-notifications-native.ts apps/mobile/test/integration/agent-notifications-native-plugin.test.ts
git commit -m "Add native agent alert notifications"
```

## Task 3: Long-Lived SSH JSONL Listener

**Files:**
- Create: `/home/muly/fressh/apps/mobile/src/lib/ssh-jsonl-listener.ts`
- Create: `/home/muly/fressh/apps/mobile/test/integration/ssh-jsonl-listener.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/home/muly/fressh/apps/mobile/test/integration/ssh-jsonl-listener.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { startSshJsonlListener } from '../../src/lib/ssh-jsonl-listener';

function bytes(text: string) {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

void test('startSshJsonlListener sends command and splits chunked lines', async () => {
	const sent: string[] = [];
	const removed: bigint[] = [];
	let listener: ((event: { bytes: ArrayBuffer; stream: 'stdout' }) => void) | null =
		null;
	const shell = {
		channelId: 7,
		addListener: (cb: typeof listener) => {
			listener = cb;
			return 99n;
		},
		removeListener: (id: bigint) => {
			removed.push(id);
		},
		sendData: async (data: ArrayBuffer) => {
			sent.push(new TextDecoder().decode(data));
		},
		close: async () => {},
	};
	const connection = {
		startShell: async () => shell,
	};
	const lines: string[] = [];

	const handle = await startSshJsonlListener({
		connection: connection as never,
		command: 'mdev tmux notifications listen --session main',
		onLine: (line) => lines.push(line),
		onExit: () => {},
	});

	assert.deepEqual(sent, ['mdev tmux notifications listen --session main\n']);
	listener?.({ bytes: bytes('{"a":'), stream: 'stdout' });
	listener?.({ bytes: bytes('1}\n{"b":2}\n'), stream: 'stdout' });
	assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
	await handle.stop();
	assert.deepEqual(removed, [99n]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test test/integration/ssh-jsonl-listener.test.ts
```

Expected: FAIL because `ssh-jsonl-listener.ts` does not exist.

- [ ] **Step 3: Implement listener helper**

Create `/home/muly/fressh/apps/mobile/src/lib/ssh-jsonl-listener.ts`:

```ts
import {
	type ListenerEvent,
	type SshConnection,
	type TerminalChunk,
} from '@fressh/react-native-uniffi-russh';
import { rootLogger } from './logger';

const logger = rootLogger.extend('SshJsonlListener');

function isTerminalChunk(event: ListenerEvent): event is TerminalChunk {
	return 'bytes' in event && 'stream' in event;
}

export type SshJsonlListenerHandle = {
	stop: () => Promise<void>;
};

export async function startSshJsonlListener(input: {
	connection: SshConnection;
	command: string;
	onLine: (line: string) => void;
	onExit: (error?: unknown) => void;
}): Promise<SshJsonlListenerHandle> {
	const shell = await input.connection.startShell({
		term: 'Xterm',
		useTmux: false,
		tmuxSessionName: '',
	});
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';
	let stopped = false;

	const listenerId = shell.addListener(
		(event) => {
			if (!isTerminalChunk(event) || !event.bytes || stopped) return;
			buffer += decoder.decode(event.bytes, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) input.onLine(trimmed);
			}
		},
		{ cursor: { mode: 'live' } },
	);

	try {
		await shell.sendData(
			encoder.encode(`${input.command}\n`).buffer as ArrayBuffer,
		);
	} catch (error) {
		logger.warn('failed to start JSONL listener command', error);
		input.onExit(error);
	}

	return {
		stop: async () => {
			stopped = true;
			shell.removeListener(listenerId);
			try {
				await shell.close();
			} catch (error) {
				logger.warn('failed to close JSONL listener shell', error);
			}
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test test/integration/ssh-jsonl-listener.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/muly/fressh
git add apps/mobile/src/lib/ssh-jsonl-listener.ts apps/mobile/test/integration/ssh-jsonl-listener.test.ts
git commit -m "Add SSH JSONL listener helper"
```

## Task 4: Bridge State Machine

**Files:**
- Create: `/home/muly/fressh/apps/mobile/src/lib/agent-notification-bridge.ts`
- Create: `/home/muly/fressh/apps/mobile/test/integration/agent-notification-bridge.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/home/muly/fressh/apps/mobile/test/integration/agent-notification-bridge.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentNotificationBridgeStateMachine,
	HEARTBEAT_STALE_MS,
} from '../../src/lib/agent-notification-bridge';

void test('bridge state transitions through start, heartbeat, stale, and stop', () => {
	const bridge = new AgentNotificationBridgeStateMachine();

	assert.equal(bridge.state.status, 'inactive');
	bridge.markStarting();
	assert.equal(bridge.state.status, 'starting');
	bridge.recordHeartbeat(1000);
	assert.equal(bridge.state.status, 'active');
	bridge.checkHeartbeat(1000 + HEARTBEAT_STALE_MS - 1);
	assert.equal(bridge.state.status, 'active');
	bridge.checkHeartbeat(1000 + HEARTBEAT_STALE_MS);
	assert.equal(bridge.state.status, 'degraded');
	bridge.markStoppedByOsOrConnection();
	assert.equal(bridge.state.status, 'stopped-by-os-or-connection');
});

void test('bridge tracks last seen event id', () => {
	const bridge = new AgentNotificationBridgeStateMachine();

	bridge.recordEventId('main:@12:1:waiting');
	assert.equal(bridge.state.lastSeenId, 'main:@12:1:waiting');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test test/integration/agent-notification-bridge.test.ts
```

Expected: FAIL because `agent-notification-bridge.ts` does not exist.

- [ ] **Step 3: Implement bridge state machine**

Create `/home/muly/fressh/apps/mobile/src/lib/agent-notification-bridge.ts`:

```ts
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
	state: AgentNotificationBridgeState = {
		status: 'inactive',
		lastHeartbeatAtMs: null,
		lastSeenId: null,
	};

	markStarting() {
		this.state = { ...this.state, status: 'starting' };
	}

	recordHeartbeat(nowMs: number) {
		this.state = {
			...this.state,
			status: 'active',
			lastHeartbeatAtMs: nowMs,
		};
	}

	recordEventId(id: string) {
		this.state = { ...this.state, lastSeenId: id };
	}

	checkHeartbeat(nowMs: number) {
		const lastHeartbeatAtMs = this.state.lastHeartbeatAtMs;
		if (
			lastHeartbeatAtMs !== null &&
			nowMs - lastHeartbeatAtMs >= HEARTBEAT_STALE_MS
		) {
			this.state = { ...this.state, status: 'degraded' };
		}
	}

	markDegraded() {
		this.state = { ...this.state, status: 'degraded' };
	}

	markInactive() {
		this.state = { ...this.state, status: 'inactive' };
	}

	markStoppedByOsOrConnection() {
		this.state = { ...this.state, status: 'stopped-by-os-or-connection' };
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test test/integration/agent-notification-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/muly/fressh
git add apps/mobile/src/lib/agent-notification-bridge.ts apps/mobile/test/integration/agent-notification-bridge.test.ts
git commit -m "Add agent notification bridge state"
```

## Task 5: React Bridge Manager

**Files:**
- Create: `/home/muly/fressh/apps/mobile/src/lib/AgentNotificationBridgeManager.tsx`
- Modify: `/home/muly/fressh/apps/mobile/src/lib/auto-connect.tsx`

- [ ] **Step 1: Add bridge manager component**

Create `/home/muly/fressh/apps/mobile/src/lib/AgentNotificationBridgeManager.tsx`:

```tsx
import React from 'react';
import { Platform } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import {
	AgentNotificationBridgeStateMachine,
	HEARTBEAT_STALE_MS,
} from './agent-notification-bridge';
import {
	AgentNotificationDedupe,
	buildAgentNotificationListenCommand,
	createAgentNotificationPendingKey,
	createStableNotificationId,
	parseAgentNotificationLine,
} from './agent-notification-events';
import {
	cancelAgentAlertNotification,
	postAgentAlertNotification,
} from './agent-notifications-native';
import { rootLogger } from './logger';
import { useSshStore } from './ssh-store';
import {
	type SshJsonlListenerHandle,
	startSshJsonlListener,
} from './ssh-jsonl-listener';

const logger = rootLogger.extend('AgentNotificationBridge');
const RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function AgentNotificationBridgeManager() {
	const { shells, connections } = useSshStore(
		useShallow((s) => ({
			shells: Object.values(s.shells),
			connections: s.connections,
		})),
	);
	const latestShell = React.useMemo(() => {
		if (shells.length === 0) return null;
		return shells.reduce((latest, shell) =>
			shell.createdAtMs > latest.createdAtMs ? shell : latest,
		);
	}, [shells]);
	const bridgeRef = React.useRef(new AgentNotificationBridgeStateMachine());
	const dedupeRef = React.useRef(new AgentNotificationDedupe());
	const listenerRef = React.useRef<SshJsonlListenerHandle | null>(null);
	const restartTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const heartbeatTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(
		null,
	);
	const restartAttemptRef = React.useRef(0);

	const connection = latestShell
		? connections[latestShell.connectionId]
		: undefined;
	const session = connection?.connectionDetails.tmuxSessionName?.trim() || 'main';

	const clearTimers = React.useCallback(() => {
		if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
		if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
		restartTimerRef.current = null;
		heartbeatTimerRef.current = null;
	}, []);

	const stopListener = React.useCallback(async () => {
		clearTimers();
		const listener = listenerRef.current;
		listenerRef.current = null;
		if (listener) await listener.stop();
	}, [clearTimers]);

	const startListener = React.useCallback(async () => {
		if (Platform.OS !== 'android' || !connection || !latestShell) return;
		if (listenerRef.current) return;
		bridgeRef.current.markStarting();
		const command = buildAgentNotificationListenCommand(
			session,
			bridgeRef.current.state.lastSeenId,
		);
		try {
			listenerRef.current = await startSshJsonlListener({
				connection,
				command,
				onLine: (line) => {
					const parsed = parseAgentNotificationLine(line);
					if (!parsed) {
						logger.warn('ignored malformed agent notification line', { line });
						return;
					}
					if (parsed.type === 'heartbeat') {
						bridgeRef.current.recordHeartbeat(parsed.createdAtMs);
						return;
					}
					bridgeRef.current.recordEventId(parsed.id);
					const key = createAgentNotificationPendingKey({
						connectionId: connection.connectionId,
						session: parsed.session,
						windowId: parsed.windowId,
					});
					const notificationId = createStableNotificationId(key);
					if (!dedupeRef.current.markPendingIfNew(key, notificationId)) return;
					void postAgentAlertNotification({
						notificationId,
						title: parsed.status === 'waiting' ? 'Agent waiting' : 'Agent done',
						message: `${parsed.windowName || parsed.target} needs attention`,
						connectionId: connection.connectionId,
						session: parsed.session,
						target: parsed.target,
						windowId: parsed.windowId,
					});
				},
				onExit: (error) => {
					logger.warn('agent notification listener exited', error);
					listenerRef.current = null;
					bridgeRef.current.markDegraded();
				},
			});
			restartAttemptRef.current = 0;
			heartbeatTimerRef.current = setInterval(() => {
				bridgeRef.current.checkHeartbeat(Date.now());
				if (bridgeRef.current.state.status !== 'degraded') return;
				void stopListener().then(() => {
					void startListener();
				});
			}, HEARTBEAT_STALE_MS);
		} catch (error) {
			logger.warn('failed to start agent notification listener', error);
			bridgeRef.current.markDegraded();
			const attempt = restartAttemptRef.current;
			restartAttemptRef.current = attempt + 1;
			const delay =
				RESTART_DELAYS_MS[Math.min(attempt, RESTART_DELAYS_MS.length - 1)] ??
				30_000;
			restartTimerRef.current = setTimeout(() => {
				void startListener();
			}, delay);
		}
	}, [connection, latestShell, session, stopListener]);

	React.useEffect(() => {
		if (Platform.OS !== 'android') return;
		if (!connection || !latestShell) {
			void stopListener();
			bridgeRef.current.markStoppedByOsOrConnection();
			return;
		}
		void startListener();
		return () => {
			void stopListener();
		};
	}, [connection, latestShell, startListener, stopListener]);

	React.useEffect(() => {
		globalThis.__FRESSH_AGENT_NOTIFICATIONS__ = {
			acknowledge: (connectionId: string, windowId: string) => {
				const ids = dedupeRef.current.acknowledgeMatching((key) =>
					key === `${connectionId}|${session}|${windowId}`,
				);
				for (const id of ids) void cancelAgentAlertNotification(id);
			},
		};
		return () => {
			delete globalThis.__FRESSH_AGENT_NOTIFICATIONS__;
		};
	}, [session]);

	return null;
}

declare global {
	// eslint-disable-next-line no-var
	var __FRESSH_AGENT_NOTIFICATIONS__:
		| { acknowledge: (connectionId: string, windowId: string) => void }
		| undefined;
}
```

- [ ] **Step 2: Mount manager in auto-connect**

In `/home/muly/fressh/apps/mobile/src/lib/auto-connect.tsx`, add import:

```ts
import { AgentNotificationBridgeManager } from './AgentNotificationBridgeManager';
```

Replace the final `return null;` in `AutoConnectManager` with:

```tsx
	return <AgentNotificationBridgeManager />;
```

- [ ] **Step 3: Run typecheck to catch integration errors**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm run typecheck
```

Expected: PASS. If TypeScript rejects `globalThis.__FRESSH_AGENT_NOTIFICATIONS__`, keep the `declare global` block in the manager file exactly as shown.

- [ ] **Step 4: Commit**

```bash
cd /home/muly/fressh
git add apps/mobile/src/lib/AgentNotificationBridgeManager.tsx apps/mobile/src/lib/auto-connect.tsx
git commit -m "Start agent notification bridge with SSH service"
```

## Task 6: Visible Window Acknowledgement

**Files:**
- Modify: `/home/muly/fressh/apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Add visible-window acknowledgement in shell detail**

In `/home/muly/fressh/apps/mobile/src/app/shell/detail.tsx`, import the command builder:

```ts
	buildTmuxCurrentWindowIdCommand,
```

Add this callback after `runHostBrowserCommand`:

```ts
	const acknowledgeVisibleAgentNotification = useCallback(() => {
		if (!connection || !tmuxEnabled) return;
		const sessionName = tmuxTarget.trim() || 'main';
		void (async () => {
			try {
				const output = await runHostBrowserCommand(
					buildTmuxCurrentWindowIdCommand(sessionName),
					10_000,
				);
				const windowId = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
				if (!windowId) return;
				globalThis.__FRESSH_AGENT_NOTIFICATIONS__?.acknowledge(
					connection.connectionId,
					windowId,
				);
			} catch (error) {
				logger.warn('agent notification acknowledge failed', error);
			}
		})();
	}, [connection, runHostBrowserCommand, tmuxEnabled, tmuxTarget]);
```

Add this effect near other lifecycle effects:

```ts
	useEffect(() => {
		acknowledgeVisibleAgentNotification();
	}, [acknowledgeVisibleAgentNotification]);
```

This acknowledges only when the detail screen is visible and the active tmux window id matches a pending event.

- [ ] **Step 2: Run targeted tests and typecheck**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test test/integration/host-browser-actions.test.ts
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/muly/fressh
git add apps/mobile/src/app/shell/detail.tsx
git commit -m "Acknowledge visible agent notifications"
```

## Task 7: Verification Gate

**Files:**
- No source changes expected unless verification catches issues.

- [ ] **Step 1: Run focused integration tests**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm exec tsx --test \
  test/integration/agent-notification-events.test.ts \
  test/integration/agent-notifications-native-plugin.test.ts \
  test/integration/ssh-jsonl-listener.test.ts \
  test/integration/agent-notification-bridge.test.ts \
  test/integration/host-browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run mobile lint check**

Run:

```bash
cd /home/muly/fressh/apps/mobile
pnpm run lint:check
```

Expected: PASS.

- [ ] **Step 4: Run preview manual smoke test**

After M-Dev issue 39 is implemented and installed on the remote host, run:

```bash
adb connect 100.113.210.6:5555
cd /home/muly/fressh/apps/mobile
pnpm exec eas build --local --profile preview --platform android
```

Install the produced APK on the connected Android device. Then:

1. Open Fressh and connect to a tmux-enabled `main` session.
2. Background Fressh.
3. On the remote, run `mdev tmux set status waiting main:4`.
4. Expected: Android posts a `Fressh Agent Alerts` notification.
5. Open Fressh to the shell and select/view the matching window.
6. Run `mdev tmux set status done main:4` after changing away from the previous pending state.
7. Expected: Android can post again after acknowledgement.

- [ ] **Step 5: Commit verification fixes if source changed**

If verification required fixes, commit them:

```bash
cd /home/muly/fressh
git status --short
git add apps/mobile
git commit -m "Fix agent notification bridge verification"
```

If no files changed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: parser, JSONL listener, native alert channel, dedupe, bridge health, heartbeat stale restart, resume restart, visible-window acknowledgement, and best-effort connected behavior are covered.
- Out of scope: no cloud push, no tmux status polling for notification discovery, no manual remote `tmux set-option` detection, no delivery after service/SSH death.
- Execution dependency: complete the M-Dev plan first for end-to-end manual verification.
