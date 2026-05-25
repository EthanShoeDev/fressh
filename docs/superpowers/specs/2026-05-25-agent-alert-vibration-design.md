# Agent Alert Vibration Design

## Goal

Agent alert notifications should vibrate by default when a new pending agent
status notification is posted. Users should be able to turn this vibration off
without affecting the persistent SSH foreground-service notification.

## Scope

This applies only to Android agent alert notifications posted from tmux status
events. It does not change the persistent `Fressh Terminal` foreground
notification, mdev event generation, notification routing, or notification tap
handling.

## User Setting

Add an `Agent alert vibration` preference in the mobile app settings. The
preference defaults to enabled.

The value is stored in the existing settings MMKV storage and is read when
posting an agent alert. If the setting is missing or unreadable, the app treats
vibration as enabled.

## Android Channel Design

Android 8 and newer bind vibration behavior to notification channels, and
existing channels cannot be reliably changed by app code after the user or
system has created them. To keep behavior deterministic, use two agent alert
channels:

- `fressh_agent_alerts_vibrate`: default channel for agent alerts, vibration
  enabled.
- `fressh_agent_alerts`: quiet fallback channel, vibration disabled.

The existing `fressh_agent_alerts` channel remains valid for users who disable
vibration and for compatibility with already-installed builds.

The vibrating channel should use `IMPORTANCE_DEFAULT`, private lock-screen
visibility, `enableVibration(true)`, and a short vibration pattern. The quiet
channel should keep the current behavior.

## Data Flow

When Fressh receives a tmux notification event:

1. The agent notification bridge builds the pending alert.
2. The bridge reads the agent alert vibration preference.
3. JS passes `vibrate: boolean` to the native `postAgentAlert` method.
4. Native Android chooses the notification channel from that value.
5. Android posts the alert notification using the selected channel.

Only pending agent alerts use this path. Foreground SSH service notifications
continue using `fressh_ssh`.

## Error Handling

If the setting cannot be read, default to vibration enabled.

If the native module does not support the new argument, the wrapper should fail
gracefully through the existing warning/false path during development tests.
The production build updates JS and native code together, so no runtime
compatibility shim is required.

## Testing

Add integration coverage for:

- The default vibration preference is enabled.
- The JS native wrapper forwards the `vibrate` argument.
- The native plugin source defines `fressh_agent_alerts_vibrate`.
- The vibrating channel enables vibration and the quiet channel remains
  available.
- Agent notification posting passes the current preference into the native
  wrapper.

Manual Android verification:

1. Install a fresh preview APK.
2. Confirm `SshForegroundService` is running.
3. Trigger `mdev tmux set status waiting <target>`.
4. Confirm Android posts an agent notification on
   `fressh_agent_alerts_vibrate`.
5. Disable the setting and trigger another waiting event.
6. Confirm Android posts on `fressh_agent_alerts`.
