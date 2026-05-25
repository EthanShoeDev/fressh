# M-Dev Tmux Notification Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M-Dev remote event stream for tmux agent status notifications.

**Architecture:** `mdev tmux set status waiting|done [target]` remains the only notification-producing boundary. Status writes append bounded JSONL events to a per-user spool, and `mdev tmux notifications listen --session <name> [--since-id <id>]` streams matching events plus 60-second heartbeats over stdout. The listener uses a blocking tail-style loop when possible and a documented 1-second sleep fallback in tests and portable runtime code.

**Tech Stack:** Bun, TypeScript, `bun:test`, existing `mdev` CLI in `/home/muly/skills/dev-env/mdev`.

---

## Scope

Implement only the M-Dev side tracked by [mulyoved/skills#39](https://github.com/mulyoved/skills/issues/39). Do not edit the Fressh app in this plan.

Source repo for execution: `/home/muly/skills/dev-env/mdev`.

Design reference: `/home/muly/fressh/docs/superpowers/specs/2026-05-22-mdev-tmux-status-android-notifications-design.md`.

## File Structure

- Create `src/lib/tmux-notifications.ts`
  - Owns notification event types, event serialization/parsing, spool path resolution, retention, event metadata resolution, append behavior, and listener iteration.
- Modify `src/lib/tmux.ts`
  - Return status-change metadata from `setAgentStatus` so commands can append notification events only after real changes.
- Modify `src/commands/tmux.ts`
  - Wire `mdev tmux set status waiting|done` to append events.
  - Add `mdev tmux notifications listen --session <name> [--since-id <id>]`.
  - Add dependency injection hooks for tests.
- Modify `src/lib/errors.ts`
  - Add `tmux notifications listen --session <name> [--since-id <id>]` to usage text.
- Create `test/tmux-notifications.test.ts`
  - Pure unit coverage for event serialization, retention, metadata, and listener filtering.
- Modify `test/tmux-status.test.ts`
  - Verify status commands append notification events only for real waiting/done changes.
- Modify `test/cli.test.ts`
  - Verify top-level help includes the new notifications command.

## Task 1: Notification Event Model And Spool Helpers

**Files:**
- Create: `/home/muly/skills/dev-env/mdev/src/lib/tmux-notifications.ts`
- Test: `/home/muly/skills/dev-env/mdev/test/tmux-notifications.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `/home/muly/skills/dev-env/mdev/test/tmux-notifications.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  appendNotificationEvent,
  notificationSpoolPath,
  parseNotificationLine,
  pruneNotificationEvents,
  serializeNotificationLine,
  type TmuxStatusNotificationEvent,
} from "../src/lib/tmux-notifications";

function event(overrides: Partial<TmuxStatusNotificationEvent> = {}): TmuxStatusNotificationEvent {
  return {
    id: "main:@12:1000:waiting",
    type: "tmux_status",
    session: "main",
    target: "main:4",
    windowId: "@12",
    windowIndex: "4",
    windowName: "fressh",
    status: "waiting",
    icon: "💬",
    createdAtMs: 1000,
    ...overrides,
  };
}

describe("tmux notification event helpers", () => {
  test("resolves the notification spool path from env", () => {
    expect(notificationSpoolPath({ XDG_STATE_HOME: "/tmp/state", HOME: "/home/muly" })).toBe(
      "/tmp/state/mdev/tmux-notifications.jsonl",
    );
    expect(notificationSpoolPath({ HOME: "/home/muly" })).toBe(
      "/home/muly/.local/state/mdev/tmux-notifications.jsonl",
    );
  });

  test("serializes and parses notification and heartbeat lines", () => {
    const parsed = parseNotificationLine(serializeNotificationLine(event()));

    expect(parsed).toEqual(event());
    expect(parseNotificationLine('{"type":"heartbeat","session":"main","createdAtMs":2000}\n')).toEqual({
      type: "heartbeat",
      session: "main",
      createdAtMs: 2000,
    });
    expect(parseNotificationLine("not-json")).toBeNull();
    expect(parseNotificationLine('{"type":"tmux_status","session":"main"}')).toBeNull();
  });

  test("retention keeps only recent events and at most the configured count", () => {
    const kept = pruneNotificationEvents(
      [
        event({ id: "old", createdAtMs: 1 }),
        event({ id: "a", createdAtMs: 20 }),
        event({ id: "b", createdAtMs: 30 }),
        event({ id: "c", createdAtMs: 40 }),
      ],
      { nowMs: 50, maxAgeMs: 35, maxEvents: 2 },
    );

    expect(kept.map((item) => item.id)).toEqual(["b", "c"]);
  });

  test("appendNotificationEvent creates the parent dir and rewrites retained jsonl", async () => {
    const writes: Array<{ path: string; text: string }> = [];
    const mkdirs: string[] = [];
    let currentText = `${serializeNotificationLine(event({ id: "old", createdAtMs: 1 }))}\n`;

    await appendNotificationEvent(event({ id: "new", createdAtMs: 2 }), {
      path: "/tmp/state/mdev/tmux-notifications.jsonl",
      nowMs: 2,
      maxAgeMs: 24 * 60 * 60 * 1000,
      maxEvents: 5000,
      readText: async () => currentText,
      writeText: async (path, text) => {
        writes.push({ path, text });
        currentText = text;
      },
      mkdir: async (path) => {
        mkdirs.push(path);
      },
    });

    expect(mkdirs).toEqual(["/tmp/state/mdev"]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/tmp/state/mdev/tmux-notifications.jsonl");
    expect(writes[0]?.text.trim().split("\n").map((line) => JSON.parse(line).id)).toEqual(["old", "new"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun test test/tmux-notifications.test.ts
```

Expected: FAIL with `Cannot find module '../src/lib/tmux-notifications'`.

- [ ] **Step 3: Implement the notification helper module**

Create `/home/muly/skills/dev-env/mdev/src/lib/tmux-notifications.ts`:

```ts
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolveHome } from "./paths";

export type AgentNotificationStatus = "waiting" | "done";

export interface TmuxStatusNotificationEvent {
  id: string;
  type: "tmux_status";
  session: string;
  target: string;
  windowId: string;
  windowIndex: string;
  windowName: string;
  status: AgentNotificationStatus;
  icon: "💬" | "✅";
  createdAtMs: number;
}

export interface TmuxNotificationHeartbeat {
  type: "heartbeat";
  session: string;
  createdAtMs: number;
}

export type TmuxNotificationLine = TmuxStatusNotificationEvent | TmuxNotificationHeartbeat;

export const NOTIFICATION_STATUS_ICONS: Record<AgentNotificationStatus, "💬" | "✅"> = {
  waiting: "💬",
  done: "✅",
};

export const DEFAULT_NOTIFICATION_MAX_EVENTS = 5000;
export const DEFAULT_NOTIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_NOTIFICATION_HEARTBEAT_MS = 60_000;
export const DEFAULT_NOTIFICATION_POLL_MS = 1_000;

export function notificationSpoolPath(env: Record<string, string | undefined>): string {
  const stateHome = env.XDG_STATE_HOME || `${resolveHome(env)}/.local/state`;
  return join(stateHome, "mdev", "tmux-notifications.jsonl");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseNotificationLine(line: string): TmuxNotificationLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;

  if (parsed.type === "heartbeat") {
    if (typeof parsed.session !== "string" || typeof parsed.createdAtMs !== "number") return null;
    return {
      type: "heartbeat",
      session: parsed.session,
      createdAtMs: parsed.createdAtMs,
    };
  }

  if (parsed.type !== "tmux_status") return null;
  if (parsed.status !== "waiting" && parsed.status !== "done") return null;
  if (parsed.icon !== "💬" && parsed.icon !== "✅") return null;

  const stringKeys = ["id", "session", "target", "windowId", "windowIndex", "windowName"] as const;
  for (const key of stringKeys) {
    if (typeof parsed[key] !== "string") return null;
  }
  if (typeof parsed.createdAtMs !== "number") return null;

  return {
    id: parsed.id,
    type: "tmux_status",
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

export function serializeNotificationLine(line: TmuxNotificationLine): string {
  return JSON.stringify(line);
}

export function parseNotificationEventsText(text: string): TmuxStatusNotificationEvent[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseNotificationLine)
    .filter((line): line is TmuxStatusNotificationEvent => line?.type === "tmux_status");
}

export function pruneNotificationEvents(
  events: TmuxStatusNotificationEvent[],
  opts: { nowMs: number; maxAgeMs: number; maxEvents: number },
): TmuxStatusNotificationEvent[] {
  const minCreatedAtMs = opts.nowMs - opts.maxAgeMs;
  return events
    .filter((event) => event.createdAtMs >= minCreatedAtMs)
    .slice(-opts.maxEvents);
}

export async function appendNotificationEvent(
  event: TmuxStatusNotificationEvent,
  deps: {
    path: string;
    nowMs?: number;
    maxAgeMs?: number;
    maxEvents?: number;
    readText?: (path: string) => Promise<string>;
    writeText?: (path: string, text: string) => Promise<void>;
    mkdir?: (path: string) => Promise<void>;
  },
): Promise<void> {
  const readText = deps.readText ?? ((path) => readFile(path, "utf8").catch((error) => {
    if ((error as { code?: string }).code === "ENOENT") return "";
    throw error;
  }));
  const writeText = deps.writeText ?? ((path, text) => writeFile(path, text, "utf8"));
  const mkdirFn = deps.mkdir ?? ((path) => mkdir(path, { recursive: true }).then(() => undefined));
  const existing = parseNotificationEventsText(await readText(deps.path));
  const retained = pruneNotificationEvents([...existing, event], {
    nowMs: deps.nowMs ?? Date.now(),
    maxAgeMs: deps.maxAgeMs ?? DEFAULT_NOTIFICATION_MAX_AGE_MS,
    maxEvents: deps.maxEvents ?? DEFAULT_NOTIFICATION_MAX_EVENTS,
  });
  await mkdirFn(dirname(deps.path));
  await writeText(deps.path, `${retained.map(serializeNotificationLine).join("\n")}\n`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun test test/tmux-notifications.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/muly/skills/dev-env/mdev
git add src/lib/tmux-notifications.ts test/tmux-notifications.test.ts
git commit -m "Add tmux notification event helpers"
```

## Task 2: Emit Events After Real Waiting/Done Status Changes

**Files:**
- Modify: `/home/muly/skills/dev-env/mdev/src/lib/tmux.ts`
- Modify: `/home/muly/skills/dev-env/mdev/src/commands/tmux.ts`
- Modify: `/home/muly/skills/dev-env/mdev/test/tmux-status-test-utils.ts`
- Modify: `/home/muly/skills/dev-env/mdev/test/tmux-status.test.ts`

- [ ] **Step 1: Write failing tests for status result metadata and CLI append**

Update `/home/muly/skills/dev-env/mdev/test/tmux-status-test-utils.ts` so the fake tmux can answer metadata queries:

```ts
export function fakeWorkmuxTmux(initial: string | { global?: string; local?: string } = "") {
  let global: string | undefined;
  let local: string | undefined;
  if (typeof initial === "string") {
    local = initial === "" ? undefined : initial;
  } else {
    global = initial.global;
    local = initial.local;
  }
  const calls: string[][] = [];

  return {
    calls,
    get status() {
      return local ?? global ?? "";
    },
    async tmux(args: string[]) {
      calls.push(args);
      if (args[0] === "display-message" && args.includes("#{session_name}\t#{window_id}\t#{window_index}\t#{window_name}")) {
        return { exitCode: 0, stdout: "main\t@12\t4\tfressh\n", stderr: "" };
      }
      if (args[0] === "display-message" && args.includes("#{@workmux_status}")) {
        return { exitCode: 0, stdout: local ?? global ?? "", stderr: "" };
      }
      if (args[0] === "show-option" && args.includes("-wqv") && args.includes("@workmux_status")) {
        return { exitCode: 0, stdout: local ?? "", stderr: "" };
      }
      if (args[0] === "show-option" && args.includes("-wq") && args.includes("@workmux_status")) {
        const stdout = local === undefined ? "" : `@workmux_status ${local === "" ? "''" : local}`;
        return { exitCode: 0, stdout, stderr: "" };
      }
      if (args[0] === "set-option" && args.includes("-uw")) {
        local = undefined;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "set-option" && args.includes("@workmux_status")) {
        local = args.at(-1) ?? "";
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}
```

Add these tests to `/home/muly/skills/dev-env/mdev/test/tmux-status.test.ts`:

```ts
test("setAgentStatus reports whether a notification status changed", async () => {
  const tmux = fakeWorkmuxTmux("");

  const result = await setAgentStatus(tmux.tmux, "waiting", "main:4");

  expect(result).toEqual({
    changed: true,
    status: "waiting",
    icon: "💬",
    target: "main:4",
  });
});

test("setAgentStatus reports unchanged for repeated notification status", async () => {
  const tmux = fakeWorkmuxTmux("💬");

  const result = await setAgentStatus(tmux.tmux, "waiting", "main:4");

  expect(result).toEqual({
    changed: false,
    status: "waiting",
    icon: "💬",
    target: "main:4",
  });
});

test("tmux set status waiting appends one notification event after a real change", async () => {
  const tmux = fakeWorkmuxTmux("");
  const io = fakeIo({
    HOME: "/home/muly",
    XDG_STATE_HOME: "/tmp/state",
  });
  const events: unknown[] = [];

  const exitCode = await runTmuxCommand(["set", "status", "waiting", "main:4"], io, {
    tmux: tmux.tmux,
    notifications: {
      now: () => 1234,
      append: async (event) => {
        events.push(event);
      },
    },
  });

  expect(exitCode).toBe(0);
  expect(events).toEqual([
    {
      id: "main:@12:1234:waiting",
      type: "tmux_status",
      session: "main",
      target: "main:4",
      windowId: "@12",
      windowIndex: "4",
      windowName: "fressh",
      status: "waiting",
      icon: "💬",
      createdAtMs: 1234,
    },
  ]);
});

test("tmux set status waiting skips duplicate notification event when status is unchanged", async () => {
  const tmux = fakeWorkmuxTmux("💬");
  const io = fakeIo({ HOME: "/home/muly" });
  let appendCalls = 0;

  const exitCode = await runTmuxCommand(["set", "status", "waiting", "main:4"], io, {
    tmux: tmux.tmux,
    notifications: {
      now: () => 1234,
      append: async () => {
        appendCalls += 1;
      },
    },
  });

  expect(exitCode).toBe(0);
  expect(appendCalls).toBe(0);
});

test("tmux set status working and clear do not append notification events", async () => {
  const tmux = fakeWorkmuxTmux("✅");
  const io = fakeIo({ HOME: "/home/muly" });
  let appendCalls = 0;
  const deps = {
    tmux: tmux.tmux,
    notifications: {
      now: () => 1234,
      append: async () => {
        appendCalls += 1;
      },
    },
  };

  expect(await runTmuxCommand(["set", "status", "working", "main:4"], io, deps)).toBe(0);
  expect(await runTmuxCommand(["set", "status", "clear", "main:4"], io, deps)).toBe(0);
  expect(appendCalls).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun test test/tmux-status.test.ts
```

Expected: FAIL because `setAgentStatus` still returns `void` and `TmuxCommandDeps` has no `notifications` dependency.

- [ ] **Step 3: Implement status result return value**

In `/home/muly/skills/dev-env/mdev/src/lib/tmux.ts`, add this type near `AgentStatus`:

```ts
export interface AgentStatusSetResult {
  changed: boolean;
  status: AgentStatus;
  icon: string;
  target?: string;
}
```

Replace `setWorkmuxStatus` and `clearWorkmuxStatus` with:

```ts
export async function setWorkmuxStatus(tmux: TmuxRunner, icon: string, target?: string): Promise<boolean> {
  const current = await readLocalWorkmuxStatus(tmux, target);
  if (current === icon) return false;

  await writeWorkmuxStatus(tmux, icon, target);
  return true;
}

export async function clearWorkmuxStatus(tmux: TmuxRunner, target?: string): Promise<boolean> {
  if (!(await hasLocalWorkmuxStatus(tmux, target))) return false;

  await unsetWorkmuxStatus(tmux, target);
  return true;
}
```

Replace `setAgentStatus` with:

```ts
export async function setAgentStatus(
  tmux: TmuxRunner,
  status: AgentStatus,
  target?: string,
): Promise<AgentStatusSetResult> {
  if (status === "clear") {
    const changed = await clearWorkmuxStatus(tmux, target);
    return { changed, status, icon: "", target };
  }

  const icon = AGENT_STATUS_ICONS[status];
  const changed = await setWorkmuxStatus(tmux, icon, target);
  return { changed, status, icon, target };
}
```

- [ ] **Step 4: Implement notification append in CLI dispatch**

In `/home/muly/skills/dev-env/mdev/src/commands/tmux.ts`, extend imports:

```ts
import {
  appendNotificationEvent,
  notificationSpoolPath,
  NOTIFICATION_STATUS_ICONS,
  type AgentNotificationStatus,
  type TmuxStatusNotificationEvent,
} from "../lib/tmux-notifications";
```

Extend `TmuxCommandDeps`:

```ts
export interface TmuxCommandDeps {
  tmux?: TmuxRunner;
  attach?: (args: string[]) => Promise<number>;
  exec?: (command: string, args: string[]) => Promise<ExecResult>;
  addEnvWindow?: (tmux: TmuxRunner, options: AddEnvOptions, home: string) => Promise<string | void>;
  notifications?: {
    now?: () => number;
    append?: (event: TmuxStatusNotificationEvent, path: string) => Promise<void>;
  };
}
```

Add helpers above `runSetCommand`:

```ts
const WINDOW_METADATA_FORMAT = "#{session_name}\t#{window_id}\t#{window_index}\t#{window_name}";

function isNotificationStatus(status: AgentStatus): status is AgentNotificationStatus {
  return status === "waiting" || status === "done";
}

async function readWindowNotificationMetadata(tmux: TmuxRunner, target?: string) {
  const args = target
    ? ["display-message", "-p", "-t", target, WINDOW_METADATA_FORMAT]
    : ["display-message", "-p", WINDOW_METADATA_FORMAT];
  const output = await tmuxCommandOutput(tmux, args);
  const [session = "", windowId = "", windowIndex = "", windowName = ""] = output.split("\t");
  if (!session || !windowId || !windowIndex) {
    throw new CliError(`Invalid tmux window metadata: ${output}`);
  }
  return { session, windowId, windowIndex, windowName };
}

async function appendStatusNotificationEvent(
  tmux: TmuxRunner,
  io: CliIo,
  status: AgentNotificationStatus,
  target: string | undefined,
  deps: TmuxCommandDeps["notifications"],
): Promise<void> {
  const createdAtMs = deps?.now?.() ?? Date.now();
  const metadata = await readWindowNotificationMetadata(tmux, target);
  const event: TmuxStatusNotificationEvent = {
    id: `${metadata.session}:${metadata.windowId}:${createdAtMs}:${status}`,
    type: "tmux_status",
    session: metadata.session,
    target: target || `${metadata.session}:${metadata.windowIndex}`,
    windowId: metadata.windowId,
    windowIndex: metadata.windowIndex,
    windowName: metadata.windowName,
    status,
    icon: NOTIFICATION_STATUS_ICONS[status],
    createdAtMs,
  };
  const path = notificationSpoolPath(io.env);
  if (deps?.append) {
    await deps.append(event, path);
    return;
  }
  await appendNotificationEvent(event, { path, nowMs: createdAtMs });
}
```

Change `runSetCommand` signature:

```ts
async function runSetCommand(argv: string[], io: CliIo, tmux: TmuxRunner, deps?: TmuxCommandDeps["notifications"]): Promise<number> {
```

Replace the set call inside `runSetCommand` with:

```ts
  const status = value as AgentStatus;
  const resolvedTarget = defaultStatusTarget(target, io);
  const result = await setAgentStatus(tmux, status, resolvedTarget);
  if (result.changed && isNotificationStatus(status)) {
    await appendStatusNotificationEvent(tmux, io, status, resolvedTarget, deps);
  }
  await io.drainStdin?.();
  return 0;
```

Change dispatch:

```ts
  if (subcommand === "set") {
    return runSetCommand(argv.slice(1), io, tmux, deps.notifications);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun test test/tmux-status.test.ts test/tmux-notifications.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/muly/skills/dev-env/mdev
git add src/lib/tmux.ts src/commands/tmux.ts test/tmux-status-test-utils.ts test/tmux-status.test.ts
git commit -m "Emit tmux notification events from status changes"
```

## Task 3: Add `mdev tmux notifications listen`

**Files:**
- Modify: `/home/muly/skills/dev-env/mdev/src/lib/tmux-notifications.ts`
- Modify: `/home/muly/skills/dev-env/mdev/src/commands/tmux.ts`
- Modify: `/home/muly/skills/dev-env/mdev/src/lib/errors.ts`
- Modify: `/home/muly/skills/dev-env/mdev/test/tmux-notifications.test.ts`
- Modify: `/home/muly/skills/dev-env/mdev/test/cli.test.ts`

- [ ] **Step 1: Write failing listener tests**

Append to `/home/muly/skills/dev-env/mdev/test/tmux-notifications.test.ts`:

```ts
import { runTmuxCommand } from "../src/commands/tmux";

function fakeIo(env: Record<string, string | undefined> = {}) {
  return {
    env,
    stdout: "",
    stderr: "",
    writeStdout(text: string) {
      this.stdout += text;
    },
    writeStderr(text: string) {
      this.stderr += text;
    },
  };
}

test("notifications listen follows matching events and emits heartbeats", async () => {
  const io = fakeIo({ HOME: "/home/muly" });
  const writes: string[] = [];

  const exitCode = await runTmuxCommand(["notifications", "listen", "--session", "main"], io, {
    notifications: {
      now: () => 10_000,
      listen: async function* () {
        yield { type: "heartbeat", session: "main", createdAtMs: 10_000 } as const;
        yield event({ id: "main:@12:11000:waiting", createdAtMs: 11_000 }) as const;
      },
    },
  });

  writes.push(...io.stdout.trim().split("\n"));
  expect(exitCode).toBe(0);
  expect(writes.map((line) => JSON.parse(line).type)).toEqual(["heartbeat", "tmux_status"]);
});

test("notifications listen requires a session name", async () => {
  const io = fakeIo({ HOME: "/home/muly" });

  await expect(runTmuxCommand(["notifications", "listen"], io)).rejects.toThrow(
    "Usage: mdev tmux notifications listen --session <name> [--since-id <id>]",
  );
});
```

Update `/home/muly/skills/dev-env/mdev/test/cli.test.ts` top-level help test:

```ts
expect(io.stdout).toContain("tmux notifications listen");
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun test test/tmux-notifications.test.ts test/cli.test.ts
```

Expected: FAIL with `Unknown tmux command: notifications`.

- [ ] **Step 3: Add listener primitives**

Append to `/home/muly/skills/dev-env/mdev/src/lib/tmux-notifications.ts`:

```ts
export interface ListenNotificationOptions {
  path: string;
  session: string;
  sinceId?: string;
  signal?: AbortSignal;
  now?: () => number;
  readText?: (path: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  heartbeatMs?: number;
  pollMs?: number;
}

export function filterEventsForListen(
  events: TmuxStatusNotificationEvent[],
  opts: { session: string; sinceId?: string },
): TmuxStatusNotificationEvent[] {
  const sessionEvents = events.filter((event) => event.session === opts.session);
  if (!opts.sinceId) return [];
  const sinceIndex = sessionEvents.findIndex((event) => event.id === opts.sinceId);
  return sinceIndex === -1 ? sessionEvents : sessionEvents.slice(sinceIndex + 1);
}

export async function* listenNotificationLines(opts: ListenNotificationOptions): AsyncGenerator<TmuxNotificationLine> {
  const readText = opts.readText ?? ((path) => readFile(path, "utf8").catch((error) => {
    if ((error as { code?: string }).code === "ENOENT") return "";
    throw error;
  }));
  const sleep = opts.sleep ?? ((ms) => Bun.sleep(ms));
  const now = opts.now ?? (() => Date.now());
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_NOTIFICATION_HEARTBEAT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_NOTIFICATION_POLL_MS;
  let lastSeenId = opts.sinceId;
  let nextHeartbeatAt = now();

  while (!opts.signal?.aborted) {
    const text = await readText(opts.path);
    const events = filterEventsForListen(parseNotificationEventsText(text), {
      session: opts.session,
      sinceId: lastSeenId,
    });
    for (const event of events) {
      lastSeenId = event.id;
      yield event;
    }
    const currentTime = now();
    if (currentTime >= nextHeartbeatAt) {
      yield { type: "heartbeat", session: opts.session, createdAtMs: currentTime };
      nextHeartbeatAt = currentTime + heartbeatMs;
    }
    await sleep(Math.max(1_000, pollMs));
  }
}
```

- [ ] **Step 4: Add command dispatch**

In `/home/muly/skills/dev-env/mdev/src/commands/tmux.ts`, add to notification imports:

```ts
  listenNotificationLines,
  type TmuxNotificationLine,
```

Extend `TmuxCommandDeps.notifications`:

```ts
    listen?: (opts: { path: string; session: string; sinceId?: string }) => AsyncIterable<TmuxNotificationLine>;
```

Add helper above `runTmuxCommand`:

```ts
function notificationsUsage(): string {
  return "Usage: mdev tmux notifications listen --session <name> [--since-id <id>]\n";
}

function parseNotificationsListenArgs(argv: string[]): { session: string; sinceId?: string } {
  const [action, ...rest] = argv;
  if (action !== "listen") throw new CliError(notificationsUsage(), 64);
  let session = "";
  let sinceId: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const value = rest[i + 1];
    if (arg === "--session") {
      if (!value) throw new CliError(notificationsUsage(), 64);
      session = value;
      i += 1;
    } else if (arg === "--since-id") {
      if (!value) throw new CliError(notificationsUsage(), 64);
      sinceId = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      throw new CliError(notificationsUsage(), 0);
    } else {
      throw new CliError(`Unknown tmux notifications argument: ${arg}`, 64);
    }
  }
  if (!session) throw new CliError(notificationsUsage(), 64);
  return { session, sinceId };
}

async function runNotificationsCommand(argv: string[], io: CliIo, deps?: TmuxCommandDeps["notifications"]): Promise<number> {
  const { session, sinceId } = parseNotificationsListenArgs(argv);
  const path = notificationSpoolPath(io.env);
  const lines = deps?.listen
    ? deps.listen({ path, session, sinceId })
    : listenNotificationLines({ path, session, sinceId });
  for await (const line of lines) {
    io.writeStdout(`${serializeNotificationLine(line)}\n`);
  }
  return 0;
}
```

Add dispatch before the `subcommand !== "nav"` check:

```ts
  if (subcommand === "notifications") {
    return runNotificationsCommand(argv.slice(1), io, deps.notifications);
  }
```

In `/home/muly/skills/dev-env/mdev/src/lib/errors.ts`, add usage line:

```ts
"  tmux notifications listen --session <name> [--since-id <id>]",
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun test test/tmux-notifications.test.ts test/tmux-status.test.ts test/cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/muly/skills/dev-env/mdev
git add src/lib/tmux-notifications.ts src/commands/tmux.ts src/lib/errors.ts test/tmux-notifications.test.ts test/cli.test.ts
git commit -m "Add tmux notification listener command"
```

## Task 4: Verification Gate

**Files:**
- No source changes expected.

- [ ] **Step 1: Run full M-Dev test suite**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Build CLI**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun run build
```

Expected: PASS and `mdev` binary is written in `/home/muly/skills/dev-env/mdev/mdev`.

- [ ] **Step 4: Commit source fixes from verification failures**

If any command required a source fix, commit it:

```bash
cd /home/muly/skills/dev-env/mdev
git status --short
git add src test package.json bun.lock
git commit -m "Fix tmux notification event verification"
```

If no files changed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: status event creation, dedupe-on-same-status, bounded spool, listener command, `--since-id`, heartbeat, no busy loop fallback, and tests are covered.
- Out of scope: Android notification posting and Fressh bridge state are intentionally excluded.
- Execution order: this M-Dev plan should be completed before the Fressh app plan so the app can consume the final JSONL contract.
