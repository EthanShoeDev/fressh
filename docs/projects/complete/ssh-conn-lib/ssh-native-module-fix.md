# Android SSH Native Module: Crash Root Cause and Fix Plan

This document explains the dev-only crash observed when navigating back
(unmounting the Shell screen) and disconnecting an SSH session, and details the
native changes required in `@dylankenneally/react-native-ssh-sftp` to resolve it
properly.

## Summary

- Symptom: App crashes in development when leaving the Shell screen while an SSH
  shell is active and `disconnect()` runs. Release builds do not crash.
- Root cause: The Android native module sometimes invokes the `startShell`
  callback more than once and lets the shell read loop terminate via an
  exception. In React Native dev mode, invoking a native callback multiple times
  can crash the bridge.
- JS-side mitigations we applied in the app:
  - Removed the artificial 3s timeout before disconnect; disconnect immediately
    on unmount.
  - Replaced the Shell event handler with a no-op on unmount to avoid setState
    after unmount.
- Proper native fix (recommended upstream):
  1. Ensure `startShell` callback is invoked exactly once (on initial start
     only).
  2. Make `closeShell` shut down the loop cleanly and null out resources.
  3. Guard `sendEvent` against emitting when the bridge is inactive.
  4. Optionally remove clients from the `clientPool` after disconnect.

## Where the issue happens

File:
`node_modules/@dylankenneally/react-native-ssh-sftp/android/src/main/java/me/keeex/rnssh/RNSshClientModule.java`

Relevant methods:

- `startShell(String key, String ptyType, Callback callback)`
  - Starts the shell on a background thread, calls `callback.invoke()` when
    connected, then loops reading lines and emitting `Shell` events.
  - On stream termination, the code currently exits via exceptions
    (`IOException`, etc.) and in the catch blocks also calls
    `callback.invoke(error.getMessage())` a second time.

- `closeShell(String key)`
  - Closes output stream, input reader, and the channel, but it does not set the
    fields to `null`. The `startShell` loop uses
    `while (client._bufferedReader != null && ...)`, which relies on `null` to
    terminate cleanly.

- `sendEvent(ReactContext reactContext, String eventName, @Nullable WritableMap params)`
  - Emits DeviceEventManager events without checking whether the React bridge is
    alive.

- `disconnect(String key)`
  - Calls `closeShell(key)` and `disconnectSFTP(key)` and then disconnects the
    session but does not remove the entry from `clientPool`.

## Why dev-only

React Native’s dev bridge is stricter: invoking a native callback multiple times
can trigger an error that surfaces as an immediate crash during development. In
release builds, this usually doesn’t bring the app down the same way, which
matches the behavior observed.

Specifically:

1. `startShell` calls the callback on success (good) but may call the same
   callback again inside a catch block when the shell loop ends with an
   exception (bad). That is a “callback invoked twice” scenario.

2. Because `closeShell` does not null
   `_bufferedReader`/`_dataOutputStream`/`_channel`, the read loop
   (`while (client._bufferedReader != null && (line = ...))`) doesn’t exit by
   the `null` check; it exits by throwing `IOException` when the stream is
   closed, sending control flow to the catch block that re-invokes the callback.

3. Emitting events after the bridge is torn down (e.g., during fast
   unmount-navigate) can also cause noise in dev logs and compound timing
   problems.

## Native changes (proposed)

1. Send the `startShell` callback once only

- Current pattern:
  - On success: `callback.invoke();`
  - On exceptions: `callback.invoke(error.getMessage());` (second invocation)

- Proposed change:
  - Keep the success callback invocation.
  - Remove all subsequent `callback.invoke(...)` inside the catch blocks of
    `startShell`.
  - Log the exception with `Log.e(...)` but do not call the callback again. The
    callback is for “start shell” completion, not for “shell ended later”.

2. Make `closeShell` cleanly terminate the read loop

- After closing resources, set fields to `null`:
  - `client._channel = null;`
  - `client._dataOutputStream = null;`
  - `client._bufferedReader = null;`

- With this, the read loop conditional `client._bufferedReader != null` becomes
  false and exits without throwing.

3. Harden `sendEvent`

- Before emitting:
  - `if (reactContext == null || !reactContext.hasActiveCatalystInstance()) { return; }`
  - Wrap `emit` in a try/catch to prevent rare bridge-state races:
    ```java
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
        .emit(eventName, params);
    } catch (Throwable t) {
      Log.w(LOGTAG, "Failed to emit event " + eventName, t);
    }
    ```

4. Optionally remove clients from the pool after disconnect

- In `disconnect(String key)`, after `client._session.disconnect();`, call
  `clientPool.remove(key);` so future lookups cannot access stale references.

## Example diffs (illustrative)

Note: Line numbers may vary; these are conceptual patches to apply in the
indicated methods.

### In `startShell`

```java
// On success (keep):
callback.invoke();

// In catch blocks (change):
} catch (JSchException error) {
  Log.e(LOGTAG, "Error starting shell: " + error.getMessage());
  // DO NOT invoke callback again here
} catch (IOException error) {
  Log.e(LOGTAG, "Error starting shell: " + error.getMessage());
  // DO NOT invoke callback again here
} catch (Exception error) {
  Log.e(LOGTAG, "Error starting shell: " + error.getMessage());
  // DO NOT invoke callback again here
}
```

### In `closeShell`

```java
if (client._channel != null) {
  client._channel.disconnect();
}
if (client._dataOutputStream != null) {
  client._dataOutputStream.flush();
  client._dataOutputStream.close();
}
if (client._bufferedReader != null) {
  client._bufferedReader.close();
}

// Ensure the shell loop terminates cleanly:
client._channel = null;
client._dataOutputStream = null;
client._bufferedReader = null;
```

### In `sendEvent`

```java
private void sendEvent(ReactContext reactContext, String eventName, @Nullable WritableMap params) {
  if (reactContext == null || !reactContext.hasActiveCatalystInstance()) {
    return;
  }
  try {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
      .emit(eventName, params);
  } catch (Throwable t) {
    Log.w(LOGTAG, "Failed to emit event " + eventName, t);
  }
}
```

### In `disconnect`

```java
SSHClient client = clientPool.get(key);
if (client != null) {
  client._session.disconnect();
  clientPool.remove(key); // optional but recommended
}
```

## Why these changes fix the issue

- Single-callback guarantee: React Native mandates native callbacks are invoked
  once per request. Making `startShell` callback only for the initial start
  satisfies this and prevents dev crashes.
- Clean loop termination: Nulling the stream references ensures the shell loop
  exits by condition rather than by exception, avoiding the catch path that
  previously re-invoked the callback.
- Safe event emission: Avoids emitting into a destroyed bridge during fast
  navigation/unmount cycles, reducing flakiness in dev.
- Resource hygiene: Removing client entries and nulling references prevents
  accidental reuse of stale state and helps GC.

## What we changed in app code (JS)

- In `apps/mobile/src/app/shell.tsx`:
  - Removed `setTimeout` and disconnect immediately in the unmount cleanup.
  - Replaced the `Shell` event handler with a no-op in the effect cleanup to
    avoid setState on an unmounted component while native drains.
  - We deliberately did not call `closeShell()` ourselves, since the library’s
    `disconnect()` already handles it.

These app-level changes reduce the timing window and stop React state updates
after unmount. They help, but the true fix is in the native module as outlined
above.

## Testing

1. Build a Dev Client (or run a development build) so the native module is
   loaded.
2. Connect, navigate to the shell, then press back to unmount while the shell is
   active.
3. Capture logs:
   - `adb logcat --pid=$(adb shell pidof -s dev.fressh.app) RNSSHClient:V ReactNative:V ReactNativeJS:V AndroidRuntime:E *:S`
4. With the native changes applied, verify:
   - No “callback invoked twice” or RN bridge callback violations.
   - No crash in dev.
   - Events stop cleanly and disconnect completes.

## Upstreaming

These fixes are small, safe, and self-contained. Consider opening a PR to
`@dylankenneally/react-native-ssh-sftp` with:

- Callback discipline in `startShell`.
- Clean resource nulling in `closeShell`.
- Safe `sendEvent`.
- Optional `clientPool.remove(key)` on disconnect.

Until it’s merged, you can maintain a `patch-package` to keep the project stable
in development.
