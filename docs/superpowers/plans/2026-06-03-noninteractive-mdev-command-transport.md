# Noninteractive Mdev Command Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a noninteractive SSH command transport and migrate mobile Workmux app commands away from hidden interactive shell channels.

**Architecture:** `react-native-uniffi-russh` gains one-shot and streaming SSH exec-channel APIs that do not request a PTY. Mobile wraps those APIs in focused command runners, uses them for `mdev tmux app ...` and notification JSONL streams, and leaves interactive shells only for the visible terminal and non-Workmux legacy side-channel commands.

**Tech Stack:** Rust, russh, UniFFI React Native bindings, TypeScript, React Native, Node integration tests, pnpm, cargo.

---

## Scope Check

This plan covers one dependency chain:

- native SSH exec primitives,
- TypeScript API wrapping,
- mobile command runners,
- notification listener migration,
- Workmux one-shot command migration,
- regression guards and Android verification.

The native and mobile parts are not independent projects because the mobile fix
depends on the native exec API. Each task still leaves the repo in a testable
state and includes a commit.

## File Structure

Native SSH package:

- Create `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_command.rs`
  - Owns command result records, stream event records, stream callbacks, command stream handle, and exec-channel logic.
- Modify `packages/react-native-uniffi-russh/rust/uniffi-russh/src/lib.rs`
  - Exposes the new native module to UniFFI.
- Modify `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`
  - Adds exported `run_command` and `start_command_stream` methods that delegate to `ssh_command`.
- Regenerate generated binding files under `packages/react-native-uniffi-russh/src/generated`, `cpp/generated`, Android, and iOS outputs with the existing package generator.
- Modify `packages/react-native-uniffi-russh/src/api.ts`
  - Adds ideal TypeScript command types and wraps generated callbacks into ergonomic TS events.

Mobile command infrastructure:

- Create `apps/mobile/src/lib/remote-command-runner.ts`
  - One-shot timeout/cancellation, UTF-8 decoding, exit status handling, and Workmux failure formatting.
- Create `apps/mobile/test/integration/remote-command-runner.test.ts`
  - Pure Node tests for one-shot command behavior.
- Create `apps/mobile/src/lib/remote-jsonl-listener.ts`
  - Streaming stdout line splitting, stderr logging hook, timeout/cancellation, and close handling.
- Create `apps/mobile/test/integration/remote-jsonl-listener.test.ts`
  - Pure Node tests for clean JSONL streaming and failure paths.
- Modify `apps/mobile/src/lib/AgentNotificationBridgeManager.tsx`
  - Uses `startRemoteJsonlListener` instead of `startSshJsonlListener`.
- Modify or delete `apps/mobile/src/lib/ssh-jsonl-listener.ts`
  - Remove the hidden shell implementation after migration.
- Modify or delete `apps/mobile/test/integration/ssh-jsonl-listener.test.ts`
  - Replace shell-channel expectations with streaming exec expectations.

Mobile Workmux migration:

- Create `apps/mobile/src/lib/host-command-router.ts`
  - Chooses exec runner for `mdev tmux app ...` and preserves shell side-channel execution for non-Workmux commands.
- Create `apps/mobile/test/integration/host-command-router.test.ts`
  - Verifies Workmux commands never use `startShell`.
- Modify `apps/mobile/src/lib/shell-modals.tsx`
  - Routes browser/context/notification Workmux commands through the router.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Passes the remote command runner into browser actions and Workmux keyboard flows.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`
  - Keep semantic command builders; no direct transport logic should be added here.

Regression guards:

- Create `apps/mobile/test/integration/workmux-command-boundary.test.ts`
  - Static checks for forbidden direct app-command strings in `apps/mobile/src`.

## Task 1: Add Native SSH Command Exec Primitives

**Files:**

- Create: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_command.rs`
- Create: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_channel.rs`
- Modify: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/lib.rs`
- Modify: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`
- Modify: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`
- Modify: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/utils.rs`

Status: implemented and CE1-hardened. The source files above are now authoritative over the original illustrative snippets below. The implemented shape includes exec-request success/failure handling, bounded command channel open/exec/eof startup awaits with a total exec-reply deadline, bounded shell channel open/request startup awaits with total reply deadlines, connection disconnect on channel-open timeout before a channel owner exists, required stdin EOF after accepted exec, non-final server EOF handling so exit metadata is preserved, bounded one-shot and startup output, bounded startup message count, exported native output-cap constants for the Task 2 API contract, close-on-drop startup channel guards, weak command-stream registry ownership with drop cleanup, registry race cleanup, best-effort/idempotent public close methods, bounded disconnect, and panic-safe foreign callback emission. `RunCommandOptions` is a new native Task 1 record, and Task 2 keeps the TypeScript wrapper's ergonomic `{ command }` call by mapping omitted `maxOutputBytes` to the native default. Native command completion remains intentionally unbounded after exec acceptance; Task 3 adds one-shot timeout/cancellation at the mobile runner layer.

- [x] **Step 1: Write failing native command collector tests**

Create `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_command.rs` with this initial test-focused content:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_output_collector_separates_streams_and_exit_status() {
        let mut collector = CommandOutputCollector::default();

        collector.record_stdout(b"hello\n");
        collector.record_stderr(b"warn\n");
        collector.record_exit_status(7);

        let output = collector.finish();

        assert_eq!(output.stdout, b"hello\n");
        assert_eq!(output.stderr, b"warn\n");
        assert_eq!(output.exit_status, Some(7));
        assert_eq!(output.exit_signal, None);
    }

    #[test]
    fn command_output_collector_preserves_exit_signal() {
        let mut collector = CommandOutputCollector::default();

        collector.record_stdout(b"before\n");
        collector.record_exit_signal("TERM".to_string());

        let output = collector.finish();

        assert_eq!(output.stdout, b"before\n");
        assert_eq!(output.stderr, b"");
        assert_eq!(output.exit_status, None);
        assert_eq!(output.exit_signal, Some("TERM".to_string()));
    }
}
```

Modify `packages/react-native-uniffi-russh/rust/uniffi-russh/src/lib.rs`:

```rust
pub mod private_key;
pub mod ssh_command;
pub mod ssh_connection;
pub mod ssh_shell;
pub mod utils;
```

- [x] **Step 2: Run native tests to verify they fail**

Run:

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test command_output_collector
```

Expected: FAIL because `CommandOutputCollector` and command output records are not defined.

- [x] **Step 3: Add the native command module**

Replace `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_command.rs` with:

```rust
use std::sync::{Arc, Weak};

use russh::{client, ChannelMsg};
use tokio::sync::Mutex as AsyncMutex;

use crate::{
    ssh_connection::SshConnection,
    utils::{now_ms, SshError},
};

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct RunCommandOptions {
    pub command: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct CommandOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_status: Option<u32>,
    pub exit_signal: Option<String>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct StartCommandStreamOptions {
    pub command: String,
    pub on_event_callback: Arc<dyn CommandStreamCallback>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum CommandStreamEvent {
    Stdout { bytes: Vec<u8> },
    Stderr { bytes: Vec<u8> },
    ExitStatus { exit_status: u32 },
    ExitSignal { signal_name: String },
    Closed,
}

#[uniffi::export(with_foreign)]
pub trait CommandStreamCallback: Send + Sync {
    fn on_event(&self, event: CommandStreamEvent);
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct CommandStreamInfo {
    pub channel_id: u32,
    pub created_at_ms: f64,
    pub connection_id: String,
}

#[derive(Default)]
pub(crate) struct CommandOutputCollector {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_status: Option<u32>,
    exit_signal: Option<String>,
}

impl CommandOutputCollector {
    pub(crate) fn record_stdout(&mut self, bytes: &[u8]) {
        self.stdout.extend_from_slice(bytes);
    }

    pub(crate) fn record_stderr(&mut self, bytes: &[u8]) {
        self.stderr.extend_from_slice(bytes);
    }

    pub(crate) fn record_exit_status(&mut self, exit_status: u32) {
        self.exit_status = Some(exit_status);
    }

    pub(crate) fn record_exit_signal(&mut self, signal_name: String) {
        self.exit_signal = Some(signal_name);
    }

    pub(crate) fn finish(self) -> CommandOutput {
        CommandOutput {
            stdout: self.stdout,
            stderr: self.stderr,
            exit_status: self.exit_status,
            exit_signal: self.exit_signal,
        }
    }
}

#[derive(uniffi::Object)]
pub struct CommandStreamSession {
    pub info: CommandStreamInfo,
    parent: Weak<SshConnection>,
    writer: AsyncMutex<russh::ChannelWriteHalf<client::Msg>>,
    reader_task: tokio::task::JoinHandle<()>,
}

#[uniffi::export(async_runtime = "tokio")]
impl CommandStreamSession {
    pub fn get_info(&self) -> CommandStreamInfo {
        self.info.clone()
    }

    pub async fn close(&self) -> Result<(), SshError> {
        self.close_internal().await
    }
}

impl CommandStreamSession {
    async fn close_internal(&self) -> Result<(), SshError> {
        self.writer.lock().await.close().await.ok();
        self.reader_task.abort();
        if let Some(parent) = self.parent.upgrade() {
            parent.command_streams.lock().await.remove(&self.info.channel_id);
        }
        Ok(())
    }
}

pub(crate) async fn run_command(
    connection: &SshConnection,
    options: RunCommandOptions,
) -> Result<CommandOutput, SshError> {
    let mut channel = {
        let client_handle = connection.client_handle.lock().await;
        client_handle.channel_open_session().await?
    };
    channel.exec(true, options.command).await?;
    channel.eof().await?;

    let mut collector = CommandOutputCollector::default();

    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => collector.record_stdout(&data),
            ChannelMsg::ExtendedData { data, .. } => collector.record_stderr(&data),
            ChannelMsg::ExitStatus { exit_status } => {
                collector.record_exit_status(exit_status);
            }
            ChannelMsg::ExitSignal { signal_name, .. } => {
                collector.record_exit_signal(signal_name);
            }
            // EOF only means no more channel data; continue so later exit
            // status/signal metadata is still captured.
            ChannelMsg::Eof => {}
            ChannelMsg::Close => break,
            _ => {}
        }
    }

    channel.close().await.ok();
    Ok(collector.finish())
}

pub(crate) async fn start_command_stream(
    connection: &SshConnection,
    options: StartCommandStreamOptions,
) -> Result<Arc<CommandStreamSession>, SshError> {
    let started_at_ms = now_ms();
    let channel = {
        let client_handle = connection.client_handle.lock().await;
        client_handle.channel_open_session().await?
    };
    let channel_id: u32 = channel.id().into();
    channel.exec(true, options.command).await?;
    channel.eof().await?;

    let (mut reader, writer) = channel.split();
    let callback = options.on_event_callback.clone();

    let reader_task = tokio::spawn(async move {
        while let Some(message) = reader.wait().await {
            match message {
                ChannelMsg::Data { data } => {
                    callback.on_event(CommandStreamEvent::Stdout {
                        bytes: data.to_vec(),
                    });
                }
                ChannelMsg::ExtendedData { data, .. } => {
                    callback.on_event(CommandStreamEvent::Stderr {
                        bytes: data.to_vec(),
                    });
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    callback.on_event(CommandStreamEvent::ExitStatus { exit_status });
                }
                ChannelMsg::ExitSignal { signal_name, .. } => {
                    callback.on_event(CommandStreamEvent::ExitSignal { signal_name });
                }
                // EOF only means no more channel data; keep reading for
                // exit status/signal and final close.
                ChannelMsg::Eof => {}
                ChannelMsg::Close => {
                    callback.on_event(CommandStreamEvent::Closed);
                    break;
                }
                _ => {}
            }
        }
    });

    let session = Arc::new(CommandStreamSession {
        info: CommandStreamInfo {
            channel_id,
            created_at_ms: started_at_ms,
            connection_id: connection.info.connection_id.clone(),
        },
        parent: connection.self_weak.lock().await.clone(),
        writer: AsyncMutex::new(writer),
        reader_task,
    });

    connection
        .command_streams
        .lock()
        .await
        .insert(channel_id, session.clone());

    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_output_collector_separates_streams_and_exit_status() {
        let mut collector = CommandOutputCollector::default();

        collector.record_stdout(b"hello\n");
        collector.record_stderr(b"warn\n");
        collector.record_exit_status(7);

        let output = collector.finish();

        assert_eq!(output.stdout, b"hello\n");
        assert_eq!(output.stderr, b"warn\n");
        assert_eq!(output.exit_status, Some(7));
        assert_eq!(output.exit_signal, None);
    }

    #[test]
    fn command_output_collector_preserves_exit_signal() {
        let mut collector = CommandOutputCollector::default();

        collector.record_stdout(b"before\n");
        collector.record_exit_signal("TERM".to_string());

        let output = collector.finish();

        assert_eq!(output.stdout, b"before\n");
        assert_eq!(output.stderr, b"");
        assert_eq!(output.exit_status, None);
        assert_eq!(output.exit_signal, Some("TERM".to_string()));
    }
}
```

Modify imports in `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`:

```rust
use crate::ssh_command::{
    CommandOutput, CommandStreamSession, RunCommandOptions, StartCommandStreamOptions,
};
```

Add this field to `SshConnection` next to `shells`:

```rust
pub(crate) command_streams: AsyncMutex<HashMap<u32, Arc<CommandStreamSession>>>,
```

Initialize the field in `connect` where `SshConnection` is constructed:

```rust
command_streams: AsyncMutex::new(HashMap::new()),
```

Add these exported methods inside the existing `impl SshConnection` block:

```rust
pub async fn run_command(&self, opts: RunCommandOptions) -> Result<CommandOutput, SshError> {
    crate::ssh_command::run_command(self, opts).await
}

pub async fn start_command_stream(
    &self,
    opts: StartCommandStreamOptions,
) -> Result<Arc<CommandStreamSession>, SshError> {
    crate::ssh_command::start_command_stream(self, opts).await
}
```

Modify `disconnect` to close command streams before disconnecting the handle:

```rust
let command_streams: Vec<Arc<CommandStreamSession>> = {
    let map = self.command_streams.lock().await;
    map.values().cloned().collect()
};
for stream in command_streams {
    stream.close().await?;
}
```

- [x] **Step 4: Run native tests to verify they pass**

Run:

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test command_output_collector
```

Expected: PASS for the two collector tests.

- [x] **Step 5: Run native compile checks**

Run:

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test
```

Expected: PASS.

- [x] **Step 6: Commit native command primitives**

Run:

```bash
git add \
  packages/react-native-uniffi-russh/rust/uniffi-russh/src/lib.rs \
  packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_channel.rs \
  packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_command.rs \
  packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs \
  packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs \
  packages/react-native-uniffi-russh/rust/uniffi-russh/src/utils.rs \
  docs/superpowers/plans/2026-06-03-noninteractive-mdev-command-transport.md
git commit -m "Add noninteractive SSH command primitives"
```

## Task 2: Regenerate Bindings And Wrap The TypeScript API

**Files:**

- Modify: generated files under `packages/react-native-uniffi-russh/src/generated`, `packages/react-native-uniffi-russh/cpp/generated`, `packages/react-native-uniffi-russh/android`, and `packages/react-native-uniffi-russh/ios`
- Modify: `packages/react-native-uniffi-russh/src/api.ts`

- [x] **Step 1: Regenerate UniFFI bindings**

Run:

```bash
pnpm --filter @fressh/react-native-uniffi-russh build:android
```

Expected: generated TypeScript/Kotlin/C++ binding files include `RunCommandOptions`,
`CommandOutput`, `StartCommandStreamOptions`, `CommandStreamEvent`,
`CommandStreamCallback`, and `CommandStreamSessionInterface`.

- [x] **Step 2: Add failing TypeScript wrapper usage**

Modify `packages/react-native-uniffi-russh/src/api.ts` by adding these ideal API
types near the shell types:

```ts
export type CommandOutput = {
	stdout: ArrayBuffer;
	stderr: ArrayBuffer;
	exitStatus: number | null;
	exitSignal: string | null;
};

export type CommandStreamEvent =
	| { type: 'stdout'; bytes: ArrayBuffer }
	| { type: 'stderr'; bytes: ArrayBuffer }
	| { type: 'exitStatus'; exitStatus: number }
	| { type: 'exitSignal'; signalName: string }
	| { type: 'closed' };

export type StartCommandStreamOptions = {
	command: string;
	onEvent: (event: CommandStreamEvent) => void;
	abortSignal?: AbortSignal;
};

export type SshCommandStream = {
	readonly channelId: number;
	readonly createdAtMs: number;
	readonly connectionId: string;
	close: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export const DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES =
	GeneratedRussh.defaultRunCommandMaxOutputBytes();
export const MAX_RUN_COMMAND_MAX_OUTPUT_BYTES =
	GeneratedRussh.maxRunCommandMaxOutputBytes();
```

Extend `SshConnection` in the same file:

```ts
runCommand: (
	opts: { command: string; maxOutputBytes?: number },
	asyncOpts?: { signal?: AbortSignal },
) => Promise<CommandOutput>;
startCommandStream: (
	opts: StartCommandStreamOptions,
) => Promise<SshCommandStream>;
```

Run:

```bash
pnpm --filter @fressh/react-native-uniffi-russh typecheck
```

Expected: FAIL because `wrapConnection` does not implement `runCommand` or
`startCommandStream`.

Compatibility note: the TypeScript wrapper keeps `{ command }` as the ergonomic
call shape by passing `null`/`undefined` for the native `max_output_bytes`
option. The wrapper should expose the generated cap constants and only pass a
native override when `maxOutputBytes` is provided.

- [x] **Step 3: Implement TypeScript wrappers**

Add these helpers in `packages/react-native-uniffi-russh/src/api.ts` after
`wrapShellSession`:

```ts
function toCommandStreamEvent(
	event: GeneratedRussh.CommandStreamEvent,
): CommandStreamEvent {
	if (event instanceof GeneratedRussh.CommandStreamEvent.Stdout) {
		return { type: 'stdout', bytes: event.inner.bytes };
	}
	if (event instanceof GeneratedRussh.CommandStreamEvent.Stderr) {
		return { type: 'stderr', bytes: event.inner.bytes };
	}
	if (event instanceof GeneratedRussh.CommandStreamEvent.ExitStatus) {
		return { type: 'exitStatus', exitStatus: event.inner.exitStatus };
	}
	if (event instanceof GeneratedRussh.CommandStreamEvent.ExitSignal) {
		return { type: 'exitSignal', signalName: event.inner.signalName };
	}
	return { type: 'closed' };
}

function wrapCommandStream(
	stream: GeneratedRussh.CommandStreamSessionInterface,
): SshCommandStream {
	const info = stream.getInfo();
	return {
		channelId: info.channelId,
		createdAtMs: info.createdAtMs,
		connectionId: info.connectionId,
		close: (opts) =>
			stream.close(opts?.signal ? { signal: opts.signal } : undefined),
	};
}
```

Add these properties in `wrapConnection` next to `startShell`:

```ts
runCommand: async ({ command }, asyncOpts) => {
	const result = await conn.runCommand(
		{ command },
		asyncOpts?.signal ? { signal: asyncOpts.signal } : undefined,
	);
	return {
		stdout: result.stdout,
		stderr: result.stderr,
		exitStatus: result.exitStatus ?? null,
		exitSignal: result.exitSignal ?? null,
	};
},
startCommandStream: async ({ command, onEvent, abortSignal }) => {
	const stream = await conn.startCommandStream(
		{
			command,
			onEventCallback: {
				onEvent: (event) => onEvent(toCommandStreamEvent(event)),
			},
		},
		abortSignal ? { signal: abortSignal } : undefined,
	);
	return wrapCommandStream(stream);
},
```

- [x] **Step 4: Run TypeScript checks**

Run:

```bash
pnpm --filter @fressh/react-native-uniffi-russh typecheck
```

Expected: PASS with the public `CommandStreamEvent` union above unchanged.

- [x] **Step 5: Commit bindings and wrapper**

Run:

```bash
git add packages/react-native-uniffi-russh
git commit -m "Expose SSH command API to TypeScript"
```

## Task 3: Add Mobile One-Shot Remote Command Runner

**Files:**

- Create: `apps/mobile/src/lib/remote-command-runner.ts`
- Create: `apps/mobile/test/integration/remote-command-runner.test.ts`

- [x] **Step 1: Write failing one-shot runner tests**

Create `apps/mobile/test/integration/remote-command-runner.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	executeRemoteCommand,
	runRemoteTextCommand,
} from '../../src/lib/remote-command-runner';
import { WORKMUX_APP_COMMAND_UPDATE_MESSAGE } from '../../src/lib/workmux-app-commands';

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function createConnection(result: {
	stdout?: string;
	stderr?: string;
	exitStatus?: number | null;
	exitSignal?: string | null;
	onRun?: (signal: AbortSignal | undefined) => void;
}) {
	const calls: { command: string; signal: AbortSignal | undefined }[] = [];
	return {
		calls,
		connection: {
			runCommand: async (
				opts: { command: string },
				asyncOpts?: { signal?: AbortSignal },
			) => {
				calls.push({ command: opts.command, signal: asyncOpts?.signal });
				result.onRun?.(asyncOpts?.signal);
				return {
					stdout: bytes(result.stdout ?? ''),
					stderr: bytes(result.stderr ?? ''),
					exitStatus: result.exitStatus ?? 0,
					exitSignal: result.exitSignal ?? null,
				};
			},
		},
	};
}

void test('executeRemoteCommand returns decoded stdout on zero exit', async () => {
	const fixture = createConnection({ stdout: 'hello\n', stderr: '', exitStatus: 0 });

	const result = await executeRemoteCommand({
		connection: fixture.connection,
		command: 'mdev tmux app window --session main',
		timeoutMs: 500,
	});

	assert.deepEqual(fixture.calls, [
		{
			command: 'mdev tmux app window --session main',
			signal: fixture.calls[0]?.signal,
		},
	]);
	assert.equal(fixture.calls[0]?.signal instanceof AbortSignal, true);
	assert.deepEqual(result, {
		success: true,
		output: 'hello\n',
		error: undefined,
		stderr: '',
		exitStatus: 0,
		exitSignal: null,
	});
});

void test('runRemoteTextCommand trims stdout and maps old mdev failures', async () => {
	const fixture = createConnection({
		stdout: '',
		stderr: 'Unknown tmux command: app\n',
		exitStatus: 1,
	});

	await assert.rejects(
		runRemoteTextCommand({
			connection: fixture.connection,
			command: 'mdev tmux app window --session main',
			timeoutMs: 500,
		}),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
});

void test('executeRemoteCommand reports exit signals and missing exit status', async () => {
	const signaled = createConnection({
		stdout: '',
		stderr: '',
		exitStatus: null,
		exitSignal: 'TERM',
	});
	assert.deepEqual(
		await executeRemoteCommand({
			connection: signaled.connection,
			command: 'listen',
			timeoutMs: 500,
		}),
		{
			success: false,
			output: '',
			error: 'Remote command exited with signal TERM.',
			stderr: '',
			exitStatus: null,
			exitSignal: 'TERM',
		},
	);

	const missing = createConnection({ stdout: '', stderr: '', exitStatus: null });
	const missingResult = await executeRemoteCommand({
		connection: missing.connection,
		command: 'listen',
		timeoutMs: 500,
	});
	assert.equal(missingResult.success, false);
	assert.equal(missingResult.error, 'Remote command exited without status.');
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- remote-command-runner.test.ts
```

Expected: FAIL because `remote-command-runner` does not exist.

- [x] **Step 3: Implement the one-shot runner**

Create `apps/mobile/src/lib/remote-command-runner.ts`:

```ts
import { formatWorkmuxAppCommandFailureMessage } from './workmux-app-commands';

export const DEFAULT_REMOTE_COMMAND_TIMEOUT_MS = 30_000;

export type RemoteCommandConnection = {
	runCommand: (
		opts: { command: string },
		asyncOpts?: { signal?: AbortSignal },
	) => Promise<{
		stdout: ArrayBuffer;
		stderr: ArrayBuffer;
		exitStatus: number | null;
		exitSignal: string | null;
	}>;
};

export type RemoteCommandResult = {
	success: boolean;
	output: string;
	error?: string;
	stderr: string;
	exitStatus: number | null;
	exitSignal: string | null;
};

const decoder = new TextDecoder();

function decodeUtf8(bytes: ArrayBuffer): string {
	return decoder.decode(bytes);
}

function timeoutError() {
	return new Error('Remote command timed out');
}

async function withRemoteCommandTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	onTimeout: () => void,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					onTimeout();
					reject(timeoutError());
				}, timeoutMs);
				const maybeNodeTimer = timeoutId as ReturnType<typeof setTimeout> & {
					unref?: () => void;
				};
				maybeNodeTimer.unref?.();
			}),
		]);
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

function commandFailureMessage(input: {
	stderr: string;
	output: string;
	exitStatus: number | null;
	exitSignal: string | null;
}) {
	if (input.exitSignal) {
		return `Remote command exited with signal ${input.exitSignal}.`;
	}
	const raw = input.stderr.trim() || input.output.trim();
	if (raw) return formatWorkmuxAppCommandFailureMessage(raw);
	if (input.exitStatus === null) return 'Remote command exited without status.';
	return `Remote command exited with status ${input.exitStatus}.`;
}

export async function executeRemoteCommand({
	connection,
	command,
	timeoutMs = DEFAULT_REMOTE_COMMAND_TIMEOUT_MS,
}: {
	connection: RemoteCommandConnection;
	command: string;
	timeoutMs?: number;
}): Promise<RemoteCommandResult> {
	const abortController = new AbortController();
	try {
		const result = await withRemoteCommandTimeout(
			connection.runCommand(
				{ command },
				{
					signal: abortController.signal,
				},
			),
			timeoutMs,
			() => abortController.abort(timeoutError()),
		);
		const output = decodeUtf8(result.stdout);
		const stderr = decodeUtf8(result.stderr);
		if (result.exitStatus === 0 && !result.exitSignal) {
			return {
				success: true,
				output,
				error: undefined,
				stderr,
				exitStatus: result.exitStatus,
				exitSignal: result.exitSignal,
			};
		}
		return {
			success: false,
			output,
			error: commandFailureMessage({
				stderr,
				output,
				exitStatus: result.exitStatus,
				exitSignal: result.exitSignal,
			}),
			stderr,
			exitStatus: result.exitStatus,
			exitSignal: result.exitSignal,
		};
	} catch (error) {
		return {
			success: false,
			output: '',
			error: error instanceof Error ? error.message : String(error),
			stderr: '',
			exitStatus: null,
			exitSignal: null,
		};
	}
}

export async function runRemoteTextCommand(input: {
	connection: RemoteCommandConnection;
	command: string;
	timeoutMs?: number;
}): Promise<string> {
	const result = await executeRemoteCommand(input);
	if (!result.success) {
		throw new Error(result.error || 'Remote command failed.');
	}
	return result.output.trim();
}
```

- [x] **Step 4: Run one-shot runner tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- remote-command-runner.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit the one-shot runner**

Run:

```bash
git add apps/mobile/src/lib/remote-command-runner.ts apps/mobile/test/integration/remote-command-runner.test.ts
git commit -m "Add mobile remote command runner"
```

## Task 4: Add Streaming JSONL Runner And Migrate Notification Listener

**Files:**

- Create: `apps/mobile/src/lib/remote-jsonl-listener.ts`
- Create: `apps/mobile/test/integration/remote-jsonl-listener.test.ts`
- Modify: `apps/mobile/src/lib/AgentNotificationBridgeManager.tsx`
- Delete or narrow: `apps/mobile/src/lib/ssh-jsonl-listener.ts`
- Delete or replace: `apps/mobile/test/integration/ssh-jsonl-listener.test.ts`

- [x] **Step 1: Write failing streaming listener tests**

Create `apps/mobile/test/integration/remote-jsonl-listener.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { startRemoteJsonlListener } from '../../src/lib/remote-jsonl-listener';

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

type Event =
	| { type: 'stdout'; bytes: ArrayBuffer }
	| { type: 'stderr'; bytes: ArrayBuffer }
	| { type: 'exitStatus'; exitStatus: number }
	| { type: 'exitSignal'; signalName: string }
	| { type: 'closed' };

function createConnection() {
	let onEvent: ((event: Event) => void) | null = null;
	let closed = 0;
	const starts: { command: string; signal: AbortSignal | undefined }[] = [];
	return {
		starts,
		get closed() {
			return closed;
		},
		emit(event: Event) {
			onEvent?.(event);
		},
		connection: {
			startCommandStream: async (
				opts: { command: string; onEvent: (event: Event) => void },
				asyncOpts?: { signal?: AbortSignal },
			) => {
				starts.push({ command: opts.command, signal: asyncOpts?.signal });
				onEvent = opts.onEvent;
				return {
					close: async () => {
						closed += 1;
					},
				};
			},
		},
	};
}

void test('startRemoteJsonlListener starts a streaming command and splits stdout lines', async () => {
	const fixture = createConnection();
	const lines: string[] = [];
	const stderr: string[] = [];

	const handle = await startRemoteJsonlListener({
		connection: fixture.connection,
		command: 'mdev tmux notifications listen --session main',
		onLine: (line) => lines.push(line),
		onStderr: (line) => stderr.push(line),
		onExit: () => {},
	});

	assert.deepEqual(fixture.starts, [
		{
			command: 'mdev tmux notifications listen --session main',
			signal: fixture.starts[0]?.signal,
		},
	]);
	assert.equal(fixture.starts[0]?.signal instanceof AbortSignal, true);

	fixture.emit({ type: 'stdout', bytes: bytes('{"a":1}\\n{"b"') });
	fixture.emit({ type: 'stdout', bytes: bytes(':2}\\r\\n') });
	fixture.emit({ type: 'stderr', bytes: bytes('warn\\n') });

	assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
	assert.deepEqual(stderr, ['warn']);

	await handle.stop();
	assert.equal(fixture.closed, 1);
});

void test('startRemoteJsonlListener reports stream closure once', async () => {
	const fixture = createConnection();
	const exits: unknown[] = [];

	const handle = await startRemoteJsonlListener({
		connection: fixture.connection,
		command: 'listen',
		onLine: () => {},
		onExit: (error) => exits.push(error),
	});

	fixture.emit({ type: 'closed' });
	fixture.emit({ type: 'closed' });

	assert.deepEqual(exits, [undefined]);
	await handle.stop();
	assert.equal(fixture.closed, 0);
});
```

- [x] **Step 2: Run streaming listener test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- remote-jsonl-listener.test.ts
```

Expected: FAIL because `remote-jsonl-listener` does not exist.

- [x] **Step 3: Implement streaming listener**

Create `apps/mobile/src/lib/remote-jsonl-listener.ts`:

```ts
import { DEFAULT_REMOTE_COMMAND_TIMEOUT_MS } from './remote-command-runner';

export type RemoteJsonlStreamConnection = {
	startCommandStream: (
		opts: {
			command: string;
			onEvent: (event: RemoteJsonlCommandStreamEvent) => void;
		},
		asyncOpts?: { signal?: AbortSignal },
	) => Promise<{ close: (opts?: { signal?: AbortSignal }) => Promise<void> }>;
};

export type RemoteJsonlCommandStreamEvent =
	| { type: 'stdout'; bytes: ArrayBuffer }
	| { type: 'stderr'; bytes: ArrayBuffer }
	| { type: 'exitStatus'; exitStatus: number }
	| { type: 'exitSignal'; signalName: string }
	| { type: 'closed' };

export type RemoteJsonlListenerHandle = {
	stop: () => Promise<void>;
};

const decoder = new TextDecoder();

function listenerTimeoutError() {
	return new Error('Remote JSONL listener operation timed out');
}

async function withListenerTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	onTimeout: () => void,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					onTimeout();
					reject(listenerTimeoutError());
				}, timeoutMs);
				const maybeNodeTimer = timeoutId as ReturnType<typeof setTimeout> & {
					unref?: () => void;
				};
				maybeNodeTimer.unref?.();
			}),
		]);
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

function emitLines({
	chunk,
	buffer,
	onLine,
}: {
	chunk: string;
	buffer: { current: string };
	onLine: (line: string) => void;
}) {
	buffer.current += chunk;
	const lines = buffer.current.split(/\r?\n/);
	buffer.current = lines.pop() ?? '';
	for (const line of lines) {
		if (!line.trim()) continue;
		onLine(line);
	}
}

export async function startRemoteJsonlListener(input: {
	connection: RemoteJsonlStreamConnection;
	command: string;
	operationTimeoutMs?: number;
	onLine: (line: string) => void;
	onStderr?: (line: string) => void;
	onExit: (error?: unknown) => void;
}): Promise<RemoteJsonlListenerHandle> {
	const operationTimeoutMs =
		input.operationTimeoutMs ?? DEFAULT_REMOTE_COMMAND_TIMEOUT_MS;
	let stopped = false;
	let stream: Awaited<
		ReturnType<RemoteJsonlStreamConnection['startCommandStream']>
	> | null = null;
	const stdoutBuffer = { current: '' };
	const stderrBuffer = { current: '' };

	const reportExit = (error?: unknown) => {
		if (stopped) return;
		stopped = true;
		input.onExit(error);
	};

	const startAbortController = new AbortController();
	stream = await withListenerTimeout(
		input.connection.startCommandStream(
			{
				command: input.command,
				onEvent: (event) => {
					if (stopped) return;
					if (event.type === 'stdout') {
						emitLines({
							chunk: decoder.decode(event.bytes, { stream: true }),
							buffer: stdoutBuffer,
							onLine: input.onLine,
						});
						return;
					}
					if (event.type === 'stderr') {
						emitLines({
							chunk: decoder.decode(event.bytes, { stream: true }),
							buffer: stderrBuffer,
							onLine: input.onStderr ?? (() => {}),
						});
						return;
					}
					if (event.type === 'exitStatus' && event.exitStatus !== 0) {
						reportExit(new Error(`Remote stream exited with status ${event.exitStatus}.`));
						return;
					}
					if (event.type === 'exitSignal') {
						reportExit(new Error(`Remote stream exited with signal ${event.signalName}.`));
						return;
					}
					if (event.type === 'closed') reportExit();
				},
			},
			{ signal: startAbortController.signal },
		),
		operationTimeoutMs,
		() => startAbortController.abort(listenerTimeoutError()),
	);

	return {
		stop: async () => {
			if (stopped) return;
			stopped = true;
			if (!stream) return;
			const closeAbortController = new AbortController();
			await withListenerTimeout(
				stream.close({ signal: closeAbortController.signal }),
				operationTimeoutMs,
				() => closeAbortController.abort(listenerTimeoutError()),
			).catch((error) => {
				console.warn('failed to close remote JSONL listener', error);
			});
		},
	};
}
```

- [x] **Step 4: Migrate `AgentNotificationBridgeManager` to the streaming runner**

In `apps/mobile/src/lib/AgentNotificationBridgeManager.tsx`, replace:

```ts
import {
	type SshJsonlListenerHandle,
	startSshJsonlListener,
} from './ssh-jsonl-listener';
```

with:

```ts
import {
	type RemoteJsonlListenerHandle,
	startRemoteJsonlListener,
} from './remote-jsonl-listener';
```

Replace:

```ts
const listenerRef = React.useRef<SshJsonlListenerHandle | null>(null);
```

with:

```ts
const listenerRef = React.useRef<RemoteJsonlListenerHandle | null>(null);
```

Replace the listener startup call:

```ts
const listener = await startSshJsonlListener({
	connection: activeTarget.connection,
	command,
	onLine: (line) => {
```

with:

```ts
const listener = await startRemoteJsonlListener({
	connection: activeTarget.connection,
	command,
	onStderr: (line) => {
		logger.warn('agent notification listener stderr', { line });
	},
	onLine: (line) => {
```

Delete `apps/mobile/src/lib/ssh-jsonl-listener.ts` after no imports remain.
Delete `apps/mobile/test/integration/ssh-jsonl-listener.test.ts`; the new
`remote-jsonl-listener.test.ts` replaces it.

- [x] **Step 5: Run notification listener tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- remote-jsonl-listener.test.ts agent-notification-events.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit streaming listener migration**

Run:

```bash
git add \
  apps/mobile/src/lib/remote-jsonl-listener.ts \
  apps/mobile/src/lib/AgentNotificationBridgeManager.tsx \
  apps/mobile/test/integration/remote-jsonl-listener.test.ts
git add -u apps/mobile/src/lib/ssh-jsonl-listener.ts apps/mobile/test/integration/ssh-jsonl-listener.test.ts
git commit -m "Move notification listener to SSH command stream"
```

## Task 5: Route Workmux One-Shot Commands Through Exec Runner

**Files:**

- Create: `apps/mobile/src/lib/host-command-router.ts`
- Create: `apps/mobile/test/integration/host-command-router.test.ts`
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [x] **Step 1: Write failing host command router tests**

Create `apps/mobile/test/integration/host-command-router.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { runHostCommandWithBoundary } from '../../src/lib/host-command-router';

void test('runHostCommandWithBoundary sends Workmux app commands to remote exec', async () => {
	const calls: string[] = [];
	const output = await runHostCommandWithBoundary({
		connection: { id: 'conn' },
		command: "mdev tmux app window --session 'main'",
		timeoutMs: 10_000,
		executeRemoteTextCommand: async (_connection, command, timeoutMs) => {
			calls.push(`remote:${command}:${timeoutMs}`);
			return '{"windowId":"@12"}';
		},
		executeSideChannelCommand: async () => {
			throw new Error('side channel should not run');
		},
	});

	assert.equal(output, '{"windowId":"@12"}');
	assert.deepEqual(calls, [
		"remote:mdev tmux app window --session 'main':10000",
	]);
});

void test('runHostCommandWithBoundary preserves side channel for non-Workmux commands', async () => {
	const calls: string[] = [];
	const output = await runHostCommandWithBoundary({
		connection: { id: 'conn' },
		command: 'git remote get-url origin',
		timeoutMs: 20_000,
		executeRemoteTextCommand: async () => {
			throw new Error('remote exec should not run');
		},
		executeSideChannelCommand: async (_connection, command, timeoutMs) => {
			calls.push(`side:${command}:${timeoutMs}`);
			return { success: true, output: 'git@github.com:mulyoved/fressh.git\n' };
		},
	});

	assert.equal(output, 'git@github.com:mulyoved/fressh.git');
	assert.deepEqual(calls, ['side:git remote get-url origin:20000']);
});

void test('runHostCommandWithBoundary throws side-channel failures', async () => {
	await assert.rejects(
		runHostCommandWithBoundary({
			connection: { id: 'conn' },
			command: 'git status',
			timeoutMs: 10_000,
			executeRemoteTextCommand: async () => '',
			executeSideChannelCommand: async () => ({
				success: false,
				output: '',
				error: 'Remote command failed.',
			}),
		}),
		/Remote command failed/,
	);
});
```

- [x] **Step 2: Run router test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- host-command-router.test.ts
```

Expected: FAIL because `host-command-router` does not exist.

- [x] **Step 3: Implement the host command router**

Create `apps/mobile/src/lib/host-command-router.ts`:

```ts
import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from './host-browser-actions';
import { isWorkmuxAppCommand } from './workmux-app-commands';

export type HostCommandSideChannelResult = {
	success: boolean;
	output: string;
	error?: string;
};

export async function runHostCommandWithBoundary<TConnection>({
	connection,
	command,
	timeoutMs,
	executeRemoteTextCommand,
	executeSideChannelCommand,
}: {
	connection: TConnection | null;
	command: string;
	timeoutMs: number;
	executeRemoteTextCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<string>;
	executeSideChannelCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<HostCommandSideChannelResult>;
}) {
	if (!connection) {
		throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
	}

	if (isWorkmuxAppCommand(command)) {
		return executeRemoteTextCommand(connection, command, timeoutMs);
	}

	const result = await executeSideChannelCommand(connection, command, timeoutMs);
	if (!result.success) {
		throw new Error(result.error || result.output || 'Remote command failed.');
	}
	return result.output.trim();
}
```

- [x] **Step 4: Wire browser actions to the router**

In `apps/mobile/src/lib/shell-modals.tsx`, import:

```ts
import { runHostCommandWithBoundary } from './host-command-router';
import { runRemoteTextCommand } from './remote-command-runner';
```

In `BrowserActionsControllerDeps<TConnection>`, keep `executeSideChannelCommand`
and add:

```ts
executeRemoteTextCommand: (
	connection: TConnection,
	command: string,
	timeoutMs: number,
) => Promise<string>;
```

In `useBrowserActionsController`, destructure `executeRemoteTextCommand`.

Replace the body of `runHostBrowserCommand` with:

```ts
return runHostCommandWithBoundary({
	connection,
	command,
	timeoutMs,
	executeRemoteTextCommand,
	executeSideChannelCommand,
});
```

In `apps/mobile/src/app/shell/detail.tsx`, pass this dependency into
`useBrowserActionsController`:

```ts
executeRemoteTextCommand: (connection, command, timeoutMs) =>
	runRemoteTextCommand({ connection, command, timeoutMs }),
```

- [x] **Step 5: Run router and Workmux feature tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- host-command-router.test.ts agent-notification-visibility.test.ts keyboard-actions.test.ts workmux-app-commands.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit one-shot Workmux routing**

Run:

```bash
git add \
  apps/mobile/src/lib/host-command-router.ts \
  apps/mobile/src/lib/shell-modals.tsx \
  apps/mobile/src/app/shell/detail.tsx \
  apps/mobile/test/integration/host-command-router.test.ts
git commit -m "Route Workmux commands through SSH exec"
```

## Task 6: Add Command Boundary Regression Guards

**Files:**

- Create: `apps/mobile/test/integration/workmux-command-boundary.test.ts`

- [x] **Step 1: Write static guard tests**

Create `apps/mobile/test/integration/workmux-command-boundary.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function collectSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			files.push(...collectSourceFiles(path));
			continue;
		}
		if (/\.(ts|tsx)$/.test(path)) files.push(path);
	}
	return files;
}

void test('mobile app command code does not call direct tmux helpers', () => {
	const root = 'apps/mobile/src';
	const forbidden = [
		/\btmux\s+display-message\b/,
		/\btmux\s+send-keys\b/,
		/\btmux\s+copy-mode\b/,
		/\binvoke-rc\.bash\b/,
	];
	const offenders: string[] = [];

	for (const file of collectSourceFiles(root)) {
		const source = readFileSync(file, 'utf8');
		for (const pattern of forbidden) {
			if (pattern.test(source)) offenders.push(`${file}: ${pattern}`);
		}
	}

	assert.deepEqual(offenders, []);
});
```

- [x] **Step 2: Run static guard test**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- workmux-command-boundary.test.ts
```

Expected: PASS with no direct app-command matches.

- [x] **Step 3: Commit regression guard**

Run:

```bash
git add apps/mobile/test/integration/workmux-command-boundary.test.ts
git commit -m "Guard Workmux command boundary"
```

## Task 7: Verification And Android Manual Test Install

**Files:**

- No new source files expected.

- [ ] **Step 1: Run focused mobile integration tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- remote-command-runner.test.ts remote-jsonl-listener.test.ts host-command-router.test.ts workmux-command-boundary.test.ts agent-notification-events.test.ts agent-notification-visibility.test.ts keyboard-actions.test.ts workmux-app-commands.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run native checks**

Run:

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test
```

Expected: PASS.

- [ ] **Step 3: Run package type checks**

Run:

```bash
pnpm --filter @fressh/react-native-uniffi-russh typecheck
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 4: Run repo lint check**

Run:

```bash
pnpm exec turbo lint:check
```

Expected: PASS.

- [ ] **Step 5: Build preview APK**

Run:

```bash
cd apps/mobile
ANDROID_HOME=/home/muly/Android/Sdk ANDROID_SDK_ROOT=/home/muly/Android/Sdk PATH=/home/muly/Android/Sdk/platform-tools:$PATH EAS_SKIP_AUTO_FINGERPRINT=1 pnpm exec eas build --local --profile preview --platform android
```

Expected: local preview APK is created under `apps/mobile/build-*.apk`.

- [ ] **Step 6: Install preview APK on the adb device**

Run:

```bash
adb connect 100.113.210.6:35651
adb -s 100.113.210.6:35651 install -r apps/mobile/build-*.apk
adb -s 100.113.210.6:35651 shell am start -n com.finalapp.vibe2/.MainActivity
```

Expected: install succeeds and app launches.

- [ ] **Step 7: Verify logs for the fixed behavior**

Run:

```bash
PID=$(adb -s 100.113.210.6:35651 shell pidof -s com.finalapp.vibe2 | tr -d '\r')
adb -s 100.113.210.6:35651 logcat -c
sleep 20
adb -s 100.113.210.6:35651 logcat -d -v threadtime --pid="$PID" > /tmp/fressh-command-transport.log
rg -n -i "FATAL EXCEPTION|AndroidRuntime|TypeError|ReferenceError|SyntaxError|ANR|native crash" /tmp/fressh-command-transport.log
rg -n -i "ignored malformed agent notification line|heartbeat stale|listener restart scheduled|exec mdev tmux notifications listen|invoke-rc|tmux display-message|tmux send-keys|tmux copy-mode" /tmp/fressh-command-transport.log
rg -n -i "heartbeat|AgentNotificationBridge|mdev tmux notifications" /tmp/fressh-command-transport.log
```

Expected:

- first `rg` has no matches,
- second `rg` has no matches for malformed prompt/control lines or direct tmux helpers,
- third `rg` shows clean bridge activity and no stale restart loop.

- [ ] **Step 8: Final commit if verification required generated or wiring fixes**

Run:

```bash
git status --short
git add -A
git commit -m "Verify noninteractive Workmux command transport"
```

Expected: either a clean worktree or a commit containing only verification-driven
source, generated, or config fixes.

## Self-Review Notes

- Spec coverage:
  - Native one-shot exec: Task 1 and Task 2.
  - Native streaming exec: Task 1 and Task 2.
  - Mobile remote command runner: Task 3.
  - Notification listener streaming migration: Task 4.
  - Workmux one-shot command migration: Task 5.
  - Direct tmux and `invoke-rc.bash` guard: Task 6.
  - Android manual log verification: Task 7.
- UX/error handling coverage:
  - Update-required message mapping is covered in Task 3.
  - Stderr and exit status preservation are covered in Task 3 and Task 4.
  - Notification bridge degradation remains in existing bridge logic and is exercised by Task 4.
- Data/control flow coverage:
  - `mdev tmux app ...` command builders stay in `workmux-app-commands.ts`.
  - Transport choice moves to `host-command-router.ts` and `remote-command-runner.ts`.
  - JSONL stream transport moves to `remote-jsonl-listener.ts`.
