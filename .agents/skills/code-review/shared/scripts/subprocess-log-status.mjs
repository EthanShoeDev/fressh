#!/usr/bin/env node

import { writeFileSync } from "fs";
import { open } from "fs/promises";
import path from "path";
import process from "process";
import { parseArgs } from "util";
import { fileURLToPath } from "url";

function writeToStream(stream, contents) {
  const fd = stream?.fd;

  if (typeof fd !== "number") {
    throw new Error("stream file descriptor is unavailable");
  }

  writeFileSync(fd, contents, "utf8");
}

function parseOptionalInteger(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsedValue = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  return parsedValue;
}

function parseTailLineCount(value) {
  if (value === undefined || value === null || value === "") {
    return 40;
  }

  const parsedValue = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error("tail must be a positive integer");
  }

  return parsedValue;
}

export function tailTextLines(contents, tailLineCount = 40) {
  const normalizedTailLineCount = parseTailLineCount(tailLineCount);
  const lines = String(contents).split(/\r?\n/);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.slice(-normalizedTailLineCount).join("\n");
}

const TAIL_READ_CHUNK_BYTES = 16 * 1024;

async function readTailTextFromFile(logPath, tailLineCount) {
  const normalizedTailLineCount = parseTailLineCount(tailLineCount);
  const fileHandle = await open(logPath, "r");

  try {
    const stats = await fileHandle.stat();

    if (stats.size === 0) {
      return {
        sizeBytes: 0,
        updatedAt: stats.mtime.toISOString(),
        mtimeMs: stats.mtimeMs,
        tail: "",
      };
    }

    let position = stats.size;
    let newlineCount = 0;
    const chunks = [];

    while (position > 0 && newlineCount <= normalizedTailLineCount) {
      const chunkSize = Math.min(TAIL_READ_CHUNK_BYTES, position);
      position -= chunkSize;

      const buffer = Buffer.alloc(chunkSize);
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        chunkSize,
        position
      );
      const chunkText = buffer.toString("utf8", 0, bytesRead);

      chunks.unshift(chunkText);
      newlineCount += chunkText.split("\n").length - 1;
    }

    return {
      sizeBytes: stats.size,
      updatedAt: stats.mtime.toISOString(),
      mtimeMs: stats.mtimeMs,
      tail: tailTextLines(chunks.join(""), normalizedTailLineCount),
    };
  } finally {
    await fileHandle.close();
  }
}

export function deriveProgressState({
  exists,
  sizeBytes,
  updatedAt,
  baselineSizeBytes = null,
  baselineUpdatedAt = null,
}) {
  if (!exists) {
    return "missing";
  }

  const hasSizeBaseline = baselineSizeBytes !== null;
  const hasUpdatedAtBaseline =
    baselineUpdatedAt !== null && baselineUpdatedAt !== "";

  if (!hasSizeBaseline && !hasUpdatedAtBaseline) {
    return "unknown";
  }

  const sizeChanged = hasSizeBaseline ? baselineSizeBytes !== sizeBytes : false;
  const updatedAtChanged = hasUpdatedAtBaseline
    ? baselineUpdatedAt !== updatedAt
    : false;

  if (sizeChanged || updatedAtChanged) {
    return "progressed";
  }

  return "idle";
}

export async function getSubprocessLogStatus({
  logPath,
  tail = 40,
  now = new Date(),
  baselineSizeBytes = null,
  baselineUpdatedAt = null,
}) {
  if (!logPath) {
    throw new Error("logPath is required");
  }

  const normalizedTail = parseTailLineCount(tail);
  const normalizedBaselineSizeBytes = parseOptionalInteger(
    baselineSizeBytes,
    "baseline-size"
  );
  const nowMs =
    now instanceof Date ? now.getTime() : new Date(now).getTime();

  try {
    const { sizeBytes, updatedAt, mtimeMs, tail: tailText } =
      await readTailTextFromFile(logPath, normalizedTail);
    const secondsSinceUpdate = Number.isFinite(nowMs)
      ? Math.max(0, Math.floor((nowMs - mtimeMs) / 1000))
      : null;
    const progressState = deriveProgressState({
      exists: true,
      sizeBytes,
      updatedAt,
      baselineSizeBytes: normalizedBaselineSizeBytes,
      baselineUpdatedAt,
    });

    return {
      exists: true,
      sizeBytes,
      updatedAt,
      secondsSinceUpdate,
      tail: tailText,
      changedSinceBaseline:
        progressState === "unknown" ? null : progressState === "progressed",
      progressState,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        sizeBytes: 0,
        updatedAt: null,
        secondsSinceUpdate: null,
        tail: "",
        changedSinceBaseline: null,
        progressState: "missing",
      };
    }

    throw error;
  }
}

function printUsage() {
  writeToStream(
    process.stdout,
    [
      "Usage:",
      "  node .agents/skills/code-review/shared/scripts/subprocess-log-status.mjs --log <path> [--tail <lines>] [--baseline-size <bytes>] [--baseline-updated-at <iso>]",
      "",
      "Examples:",
      "  node .agents/skills/code-review/shared/scripts/subprocess-log-status.mjs --log /tmp/code-review-abc123.md",
      "  node .agents/skills/code-review/shared/scripts/subprocess-log-status.mjs --log /tmp/code-review-abc123.md --tail 20 --baseline-size 4096 --baseline-updated-at 2026-03-10T00:05:00.000Z",
      "",
    ].join("\n")
  );
}

export function parseCliOptions(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      log: { type: "string" },
      tail: { type: "string" },
      "baseline-size": { type: "string" },
      "baseline-updated-at": { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    return { help: true };
  }

  if (!values.log) {
    throw new Error("--log is required");
  }

  return {
    help: false,
    logPath: values.log,
    tail: parseTailLineCount(values.tail),
    baselineSizeBytes: parseOptionalInteger(
      values["baseline-size"],
      "baseline-size"
    ),
    baselineUpdatedAt: values["baseline-updated-at"] ?? null,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliOptions(argv);

  if (options.help) {
    printUsage();
    return;
  }

  const status = await getSubprocessLogStatus(options);
  writeToStream(process.stdout, `${JSON.stringify(status)}\n`);
}

const invokedAsScript =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  await main().catch(async (error) => {
    writeToStream(process.stderr, `${error.message}\n`);
    process.exit(1);
  });
}
