#!/usr/bin/env node

import { openSync, closeSync, writeFileSync } from "fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "fs/promises";
import path from "path";
import process from "process";
import { spawn } from "child_process";
import { parseArgs } from "util";
import { fileURLToPath } from "url";

import { getSubprocessLogStatus } from "./subprocess-log-status.mjs";
import {
  collectJsonFindingTitlesFromValue,
  extractJsonFindingTitles,
  extractPriorityReviewFindings,
} from "./review-finding-normalizer.mjs";

const DEFAULT_STALL_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TAIL_LINES = 40;
const DEFAULT_SESSION_BIND_GRACE_MS = 30_000;
const EXIT_LOG_SETTLE_MS = 250;
const EXIT_LOG_SETTLE_POLL_MS = 25;
const TERMINATION_GRACE_MS = 5_000;
const TERMINATION_POLL_MS = 100;
const MANAGED_REVIEW_METADATA_SUFFIX = ".meta.json";
const MAX_SESSION_HEADER_LINES = 80;
const CLEAN_REVIEW_PATTERNS = [
  /i did not find an introduced bug/i,
  /i did not find a discrete regression/i,
  /i didn['’]t find an obvious defect/i,
  /overall_correctness"\s*:\s*"patch is correct"/i,
  /give a clean verdict/i,
  /\b(?:i\s+)?did(?:\s+not|n['’]t)\s+(?:find|spot|identify)\s+(?:any\s+)?[^.\n]*(?:bugs?|defects?|issues?|regressions?)\b/i,
  /\bno\s+[^.\n]*(?:findings?|bugs?|defects?|issues?|regressions?)[^.\n]*(?:were\s+)?(?:found|identified|discovered)\b/i,
];
const INCORRECT_REVIEW_PATTERNS = [
  /full review comments:/i,
  /review comment:/i,
  /overall_correctness"\s*:\s*"patch is incorrect"/i,
];

function writeToStream(stream, contents) {
  const fd = stream?.fd;

  if (typeof fd === "number") {
    writeFileSync(fd, contents, "utf8");
    return;
  }

  stream.write(contents);
}

function printUsage() {
  writeToStream(
    process.stdout,
    [
      "Usage:",
      "  node .agents/skills/code-review/shared/scripts/managed-review-process.mjs start --cmd <command> --workdir <dir> --log <path> --pid-file <path> --exit-file <path>",
      "  node .agents/skills/code-review/shared/scripts/managed-review-process.mjs wait --log <path> --pid-file <path> --exit-file <path> [--parser codex-review] [--stall-ms <ms>] [--poll-ms <ms>] [--tail <lines>]",
      "",
    ].join("\n")
  );
}

function ensurePositiveInteger(value, label, defaultValue = null) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getManagedReviewMetadataPath(pidFilePath) {
  return `${pidFilePath}${MANAGED_REVIEW_METADATA_SUFFIX}`;
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readSettledOptionalText(
  filePath,
  settleMs = EXIT_LOG_SETTLE_MS,
  pollMs = EXIT_LOG_SETTLE_POLL_MS
) {
  let latestContents = await readOptionalText(filePath);
  const deadline = Date.now() + settleMs;

  while (Date.now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(deadline - Date.now(), 0)));
    latestContents = await readOptionalText(filePath);
  }

  return latestContents;
}

async function readPidFile(pidFilePath) {
  const contents = await readOptionalText(pidFilePath);
  const pid = Number.parseInt(String(contents ?? "").trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

async function readExitCode(exitFilePath) {
  const contents = await readOptionalText(exitFilePath);
  if (contents === null) {
    return null;
  }

  const trimmed = contents.trim();
  if (trimmed === "") {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readOptionalJson(filePath) {
  const contents = await readOptionalText(filePath);
  if (!contents) {
    return null;
  }

  return JSON.parse(contents);
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") {
      return true;
    }

    return false;
  }
}

function isProcessGroupAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") {
      return true;
    }

    return false;
  }
}

function signalProcessTarget(pid, signal) {
  try {
    process.kill(-pid, signal);
    return;
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }

  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

async function terminateProcess(pid) {
  if (!isPidAlive(pid) && !isProcessGroupAlive(pid)) {
    return false;
  }

  signalProcessTarget(pid, "SIGTERM");

  const deadline = Date.now() + TERMINATION_GRACE_MS;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid) && !isProcessGroupAlive(pid)) {
      return true;
    }
    await sleep(TERMINATION_POLL_MS);
  }

  signalProcessTarget(pid, "SIGKILL");

  return true;
}

function hasTerminalIncorrectVerdict(contents) {
  const text = String(contents ?? "");
  const verdictMatches = text.matchAll(/patch should not be considered([^\n.]*)/gi);

  for (const match of verdictMatches) {
    const trailingClause = match[1] ?? "";
    if (!/\byet\b/i.test(trailingClause)) {
      return true;
    }
  }

  return false;
}

function hasExplicitCleanReviewSignal(contents) {
  const text = String(contents ?? "");
  return CLEAN_REVIEW_PATTERNS.some((pattern) => pattern.test(text));
}

function hasExplicitIncorrectReviewSignal(contents) {
  const text = String(contents ?? "");
  return (
    INCORRECT_REVIEW_PATTERNS.some((pattern) => pattern.test(text)) ||
    hasTerminalIncorrectVerdict(text)
  );
}

export function parseStructuredReviewOutput(reviewOutput) {
  if (!reviewOutput || typeof reviewOutput !== "object") {
    return null;
  }

  const rawFindings = Array.isArray(reviewOutput.findings)
    ? reviewOutput.findings
    : [];
  const findings = new Set(collectJsonFindingTitlesFromValue(rawFindings));

  const overallCorrectness =
    typeof reviewOutput.overall_correctness === "string"
      ? reviewOutput.overall_correctness
      : "";
  const summary =
    typeof reviewOutput.overall_explanation === "string"
      ? reviewOutput.overall_explanation.trim() || null
      : null;

  if (
    rawFindings.length > 0 ||
    /patch is incorrect/i.test(overallCorrectness) ||
    hasExplicitIncorrectReviewSignal(summary)
  ) {
    return {
      state: "issues_found",
      findings: [...findings],
      summary,
    };
  }

  if (
    findings.size === 0 &&
    (/patch is correct/i.test(overallCorrectness) ||
      hasExplicitCleanReviewSignal(summary))
  ) {
    return {
      state: "clean",
      findings: [],
      summary,
    };
  }

  return {
    state: "unknown",
    findings: [...findings],
    summary,
  };
}

export function extractReviewSessionIdFromLog(contents) {
  const lines = String(contents ?? "").split(/\r?\n/);
  const limit = Math.min(lines.length, MAX_SESSION_HEADER_LINES);

  for (let index = 0; index < limit; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const match = line.match(/^session id:\s+([^\s]+)$/i);
    if (match) {
      return match[1] ?? null;
    }
  }

  return null;
}

function extractFirstParagraph(contents) {
  return (
    String(contents ?? "")
      .split(/\n\s*\n/)
      .map((entry) => entry.trim())
      .find(Boolean) ?? null
  );
}

function extractLastCodexParagraph(contents) {
  const sections = extractCodexBlocks(contents);

  if (sections.length === 0) {
    return null;
  }

  const lastSection = sections.at(-1) ?? null;
  if (!lastSection) {
    return null;
  }

  const paragraph = lastSection
    .split(/\n\s*\n/)
    .map((entry) => entry.trim())
    .find(Boolean);

  return paragraph ?? null;
}

function extractCodexBlocks(contents) {
  const lines = String(contents ?? "").split(/\r?\n/);
  const blocks = [];
  let currentBlock = null;

  for (const line of lines) {
    if (line === "codex") {
      if (currentBlock && currentBlock.join("\n").trim()) {
        blocks.push(currentBlock.join("\n").trim());
      }
      currentBlock = [];
      continue;
    }

    if (line === "exec" && currentBlock) {
      if (currentBlock.join("\n").trim()) {
        blocks.push(currentBlock.join("\n").trim());
      }
      currentBlock = null;
      continue;
    }

    if (currentBlock) {
      currentBlock.push(line);
    }
  }

  if (currentBlock && currentBlock.join("\n").trim()) {
    blocks.push(currentBlock.join("\n").trim());
  }

  return blocks;
}

export function parseCodexReviewLog(contents) {
  const latestCodexBlock = extractCodexBlocks(contents).at(-1) ?? "";
  const findings = extractPriorityReviewFindings(latestCodexBlock);
  const summary = extractLastCodexParagraph(contents);

  if (findings.length > 0 || hasExplicitIncorrectReviewSignal(latestCodexBlock)) {
    return {
      state: "issues_found",
      findings,
      summary,
    };
  }

  if (hasExplicitCleanReviewSignal(latestCodexBlock)) {
    return {
      state: "clean",
      findings: [],
      summary,
    };
  }

  return {
    state: "unknown",
    findings: [],
    summary,
  };
}

export function parseCodexReviewText(contents) {
  const normalizedContents = String(contents ?? "");
  const findings = extractPriorityReviewFindings(normalizedContents);
  const summary = extractFirstParagraph(normalizedContents);

  if (findings.length > 0 || hasExplicitIncorrectReviewSignal(normalizedContents)) {
    return {
      state: "issues_found",
      findings,
      summary,
    };
  }

  if (hasExplicitCleanReviewSignal(normalizedContents)) {
    return {
      state: "clean",
      findings: [],
      summary,
    };
  }

  return {
    state: "unknown",
    findings: [],
    summary,
  };
}

function formatSessionPathDate(dateLike) {
  const value = new Date(dateLike);
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return [year, month, day];
}

function getCodexSessionsRoot() {
  const homeDir = process.env.HOME;
  return homeDir ? path.join(homeDir, ".codex", "sessions") : null;
}

async function listSessionCandidateFiles(startedAt) {
  const sessionsRoot = getCodexSessionsRoot();
  if (!sessionsRoot) {
    return [];
  }

  const startedDate = new Date(startedAt);
  const neighborDates = [
    startedDate,
    new Date(startedDate.getTime() - 24 * 60 * 60 * 1000),
    new Date(startedDate.getTime() + 24 * 60 * 60 * 1000),
    new Date(),
  ];
  const candidateDirs = [
    ...new Set(
      neighborDates.map((entry) =>
        path.join(sessionsRoot, ...formatSessionPathDate(entry))
      )
    ),
  ];
  const candidateFiles = [];

  for (const directoryPath of candidateDirs) {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(".jsonl")
      ) {
        candidateFiles.push(path.join(directoryPath, entry.name));
      }
    }
  }

  return candidateFiles;
}

async function findSessionLogPathByFileName(rootDir, sessionId) {
  const pendingDirs = [rootDir];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pendingDirs.push(entryPath);
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        entry.name.includes(sessionId)
      ) {
        return entryPath;
      }
    }
  }

  return null;
}

async function readSessionMeta(filePath) {
  const contents = await readOptionalText(filePath);
  const firstLine = String(contents ?? "")
    .split(/\r?\n/)
    .find((entry) => entry.trim().length > 0);

  if (!firstLine) {
    return null;
  }

  let parsedLine;
  try {
    parsedLine = JSON.parse(firstLine);
  } catch {
    return null;
  }

  if (parsedLine?.type !== "session_meta" || !parsedLine?.payload) {
    return null;
  }

  return parsedLine.payload;
}

async function resolveSessionLogPathById(sessionId, startedAt) {
  const sessionsRoot = getCodexSessionsRoot();
  if (!sessionsRoot || !sessionId) {
    return null;
  }

  const candidateFiles = await listSessionCandidateFiles(startedAt);
  for (const candidatePath of candidateFiles) {
    if (path.basename(candidatePath).includes(sessionId)) {
      return candidatePath;
    }
  }

  const exactPath = await findSessionLogPathByFileName(sessionsRoot, sessionId);
  if (exactPath) {
    return exactPath;
  }

  for (const candidatePath of candidateFiles) {
    const meta = await readSessionMeta(candidatePath);
    if (meta?.id === sessionId) {
      return candidatePath;
    }
  }

  return null;
}

async function parseCodexReviewSessionLog(sessionLogPath) {
  const contents = await readOptionalText(sessionLogPath);
  if (!contents) {
    return {
      state: "unknown",
      findings: [],
      summary: null,
      sessionLogPath,
      sessionId: null,
    };
  }

  let sessionId = null;
  let finalAnswerText = null;
  let structuredReviewResult = null;

  const extractResponseItemText = (contentParts) =>
    Array.isArray(contentParts)
      ? contentParts
          .map((part) => part?.text ?? part?.input_text ?? part?.output_text ?? "")
          .join("")
          .trim()
      : "";

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event?.type === "session_meta" && event?.payload?.id) {
      sessionId = event.payload.id;
      continue;
    }

    if (!event?.payload) {
      continue;
    }

    if (
      event.type === "response_item" &&
      event.payload.type === "message" &&
      event.payload.role === "assistant" &&
      event.payload.phase === "final_answer"
    ) {
      const message = extractResponseItemText(event.payload.content);
      if (message) {
        finalAnswerText = message;
      }
      continue;
    }

    if (event?.type !== "event_msg") {
      continue;
    }

    if (
      event.payload.type === "agent_message" &&
      event.payload.phase === "final_answer" &&
      typeof event.payload.message === "string"
    ) {
      finalAnswerText = event.payload.message;
      continue;
    }

    if (
      event.payload.type === "task_complete" &&
      !finalAnswerText &&
      typeof event.payload.last_agent_message === "string"
    ) {
      finalAnswerText = event.payload.last_agent_message;
      continue;
    }

    if (event.payload.type === "exited_review_mode") {
      structuredReviewResult = parseStructuredReviewOutput(
        event.payload.review_output
      );
    }
  }

  if (
    structuredReviewResult?.state === "issues_found" ||
    structuredReviewResult?.state === "clean"
  ) {
    return {
      ...structuredReviewResult,
      sessionLogPath,
      sessionId,
    };
  }

  if (!finalAnswerText) {
    return {
      state: structuredReviewResult?.state ?? "unknown",
      findings: structuredReviewResult?.findings ?? [],
      summary: structuredReviewResult?.summary ?? null,
      sessionLogPath,
      sessionId,
    };
  }

  return {
    ...parseCodexReviewText(finalAnswerText),
    sessionLogPath,
    sessionId,
  };
}

async function parseReviewSession({
  parserName,
  sessionLogPath = null,
}) {
  if (!parserName) {
    return {
      state: "unknown",
      findings: [],
      summary: null,
      sessionLogPath: null,
      sessionId: null,
    };
  }

  if (parserName === "codex-review") {
    if (sessionLogPath) {
      return parseCodexReviewSessionLog(sessionLogPath);
    }

    return {
      state: "unknown",
      findings: [],
      summary: null,
      sessionLogPath: null,
      sessionId: null,
    };
  }

  throw new Error(`Unsupported parser: ${parserName}`);
}

export async function startManagedReview({
  command,
  workdir,
  logPath,
  pidFilePath,
  exitFilePath,
}) {
  if (!command) {
    throw new Error("command is required");
  }

  if (!workdir) {
    throw new Error("workdir is required");
  }

  if (!logPath || !pidFilePath || !exitFilePath) {
    throw new Error("logPath, pidFilePath, and exitFilePath are required");
  }

  const resolvedWorkdir = path.resolve(workdir);
  const resolvedLogPath = path.resolve(logPath);
  const resolvedPidFilePath = path.resolve(pidFilePath);
  const resolvedExitFilePath = path.resolve(exitFilePath);
  const startedAt = new Date().toISOString();

  await mkdir(path.dirname(resolvedLogPath), { recursive: true });
  await mkdir(path.dirname(resolvedPidFilePath), { recursive: true });
  await mkdir(path.dirname(resolvedExitFilePath), { recursive: true });
  await writeFile(resolvedLogPath, "", "utf8");
  await rm(resolvedExitFilePath, { force: true });
  await writeFile(
    getManagedReviewMetadataPath(resolvedPidFilePath),
    JSON.stringify(
      {
        startedAt,
        workdir: resolvedWorkdir,
        sessionLogPath: null,
        sessionId: null,
        sessionIdObservedAt: null,
      },
      null,
      2
    ),
    "utf8"
  );

  const logFd = openSync(resolvedLogPath, "a");
  const wrappedCommand = [
    "set -o pipefail",
    `${command}`,
    "status=$?",
    `printf '%s\\n' \"$status\" > ${shellQuote(resolvedExitFilePath)}`,
    'exit "$status"',
  ].join("\n");

  const child = spawn("bash", ["-lc", wrappedCommand], {
    cwd: resolvedWorkdir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();
  closeSync(logFd);

  await writeFile(resolvedPidFilePath, `${child.pid}\n`, "utf8");

  return {
    pid: child.pid,
    logPath: resolvedLogPath,
    pidFilePath: resolvedPidFilePath,
    exitFilePath: resolvedExitFilePath,
    startedAt,
    sessionLogPath: null,
    sessionId: null,
  };
}

export async function waitForManagedReview({
  logPath,
  pidFilePath,
  exitFilePath,
  parserName = null,
  stallMs = DEFAULT_STALL_MS,
  pollMs = DEFAULT_POLL_MS,
  tail = DEFAULT_TAIL_LINES,
  sessionBindGraceMs = DEFAULT_SESSION_BIND_GRACE_MS,
}) {
  if (!logPath || !pidFilePath || !exitFilePath) {
    throw new Error("logPath, pidFilePath, and exitFilePath are required");
  }

  const resolvedLogPath = path.resolve(logPath);
  const resolvedPidFilePath = path.resolve(pidFilePath);
  const resolvedExitFilePath = path.resolve(exitFilePath);
  const metadataPath = getManagedReviewMetadataPath(resolvedPidFilePath);
  let reviewMetadata = await readOptionalJson(metadataPath);
  const pid = await readPidFile(resolvedPidFilePath);

  if (pid === null) {
    throw new Error(`pid file did not contain a valid pid: ${resolvedPidFilePath}`);
  }

  let lastProgressAt = Date.now();
  let baselineSizeBytes = null;
  let baselineUpdatedAt = null;
  let sessionBaselineSizeBytes = null;
  let sessionBaselineUpdatedAt = null;

  for (;;) {
    const logStatus = await getSubprocessLogStatus({
      logPath: resolvedLogPath,
      tail,
      baselineSizeBytes,
      baselineUpdatedAt,
    });
    const fullLog = await readOptionalText(resolvedLogPath);
    const exitCode = await readExitCode(resolvedExitFilePath);
    const pidAlive = isPidAlive(pid);
    const rawReview =
      parserName === "codex-review"
        ? parseCodexReviewLog(fullLog ?? "")
        : {
            state: "unknown",
            findings: [],
            summary: null,
          };

    let sessionId = reviewMetadata?.sessionId ?? null;
    if (!sessionId && parserName === "codex-review") {
      sessionId = extractReviewSessionIdFromLog(fullLog ?? "");
      if (sessionId) {
        reviewMetadata = {
          ...(reviewMetadata ?? {}),
          startedAt: reviewMetadata?.startedAt ?? null,
          workdir: reviewMetadata?.workdir ?? process.cwd(),
          sessionId,
          sessionIdObservedAt:
            reviewMetadata?.sessionIdObservedAt ?? new Date().toISOString(),
          sessionLogPath: reviewMetadata?.sessionLogPath ?? null,
        };
        await writeFile(metadataPath, JSON.stringify(reviewMetadata, null, 2), "utf8");
      }
    }

    if (sessionId && !reviewMetadata?.sessionIdObservedAt) {
      reviewMetadata = {
        ...(reviewMetadata ?? {}),
        startedAt: reviewMetadata?.startedAt ?? null,
        workdir: reviewMetadata?.workdir ?? process.cwd(),
        sessionId,
        sessionIdObservedAt: new Date().toISOString(),
        sessionLogPath: reviewMetadata?.sessionLogPath ?? null,
      };
      await writeFile(metadataPath, JSON.stringify(reviewMetadata, null, 2), "utf8");
    }

    let sessionLogPath = reviewMetadata?.sessionLogPath ?? null;
    if (
      parserName === "codex-review" &&
      sessionId &&
      !sessionLogPath
    ) {
      sessionLogPath = await resolveSessionLogPathById(
        sessionId,
        reviewMetadata?.startedAt ?? null
      );

      if (sessionLogPath) {
        reviewMetadata = {
          ...(reviewMetadata ?? {}),
          startedAt: reviewMetadata?.startedAt ?? null,
          workdir: reviewMetadata?.workdir ?? process.cwd(),
          sessionId,
          sessionIdObservedAt: reviewMetadata?.sessionIdObservedAt ?? null,
          sessionLogPath,
        };
        await writeFile(metadataPath, JSON.stringify(reviewMetadata, null, 2), "utf8");
      }
    }

    const sessionReview = await parseReviewSession({
      parserName,
      sessionLogPath,
    });
    const sessionLogStatus = sessionLogPath
      ? await getSubprocessLogStatus({
          logPath: sessionLogPath,
          tail: 1,
          baselineSizeBytes: sessionBaselineSizeBytes,
          baselineUpdatedAt: sessionBaselineUpdatedAt,
        })
      : null;

    if (logStatus.progressState === "unknown" || logStatus.progressState === "progressed") {
      lastProgressAt = Date.now();
    }

    if (
      sessionLogStatus &&
      (sessionLogStatus.progressState === "unknown" ||
        sessionLogStatus.progressState === "progressed")
    ) {
      lastProgressAt = Date.now();
    }

    if (
      sessionReview.state === "issues_found" ||
      sessionReview.state === "clean"
    ) {
      if (pidAlive) {
        await terminateProcess(pid);
      }

      return {
        state: sessionReview.state,
        exitCode,
        pid,
        pidAlive: false,
        terminated: pidAlive,
        logPath: resolvedLogPath,
        secondsSinceUpdate: logStatus.secondsSinceUpdate,
        updatedAt: logStatus.updatedAt,
        logSize: logStatus.sizeBytes,
        tail: logStatus.tail,
        findings: sessionReview.findings,
        summary: sessionReview.summary,
        sessionLogPath: sessionLogPath ?? null,
        sessionId: sessionReview.sessionId ?? sessionId ?? null,
      };
    }

    const sessionRootAvailable = Boolean(getCodexSessionsRoot());
    const rawReviewIsTerminal =
      rawReview.state === "issues_found" || rawReview.state === "clean";
    const rawReviewCanTerminateWhileAlive =
      rawReview.state === "clean" ||
      (rawReview.state === "issues_found" && rawReview.findings.length > 0);
    const sessionIdObservedAtMs = reviewMetadata?.sessionIdObservedAt
      ? Date.parse(reviewMetadata.sessionIdObservedAt)
      : Number.NaN;
    const sessionBindWaitExpired =
      sessionId &&
      !sessionLogPath &&
      Number.isFinite(sessionIdObservedAtMs) &&
      Date.now() - sessionIdObservedAtMs >= sessionBindGraceMs;
    const canUseRawReviewWhileAlive =
      pidAlive &&
      rawReviewIsTerminal &&
      rawReviewCanTerminateWhileAlive &&
      parserName === "codex-review" &&
      (!sessionId ||
        (!sessionLogPath && (!sessionRootAvailable || sessionBindWaitExpired)));

    if (canUseRawReviewWhileAlive) {
      await terminateProcess(pid);

      return {
        state: rawReview.state,
        exitCode,
        pid,
        pidAlive: false,
        terminated: true,
        logPath: resolvedLogPath,
        secondsSinceUpdate: logStatus.secondsSinceUpdate,
        updatedAt: logStatus.updatedAt,
        logSize: logStatus.sizeBytes,
        tail: logStatus.tail,
        findings: rawReview.findings,
        summary: rawReview.summary,
        sessionLogPath: sessionLogPath ?? null,
        sessionId: sessionReview.sessionId ?? sessionId ?? null,
      };
    }

    if (exitCode !== null || !pidAlive) {
      const settledLog = await readSettledOptionalText(resolvedLogPath);
      const settledRawReview =
        parserName === "codex-review"
          ? parseCodexReviewLog(settledLog ?? "")
          : rawReview;

      if (
        settledRawReview.state === "issues_found" ||
        settledRawReview.state === "clean"
      ) {
        return {
          state: settledRawReview.state,
          exitCode,
          pid,
          pidAlive: false,
          terminated: false,
          logPath: resolvedLogPath,
          secondsSinceUpdate: logStatus.secondsSinceUpdate,
          updatedAt: logStatus.updatedAt,
          logSize: logStatus.sizeBytes,
          tail: logStatus.tail,
          findings: settledRawReview.findings,
          summary: settledRawReview.summary,
          sessionLogPath: sessionLogPath ?? null,
          sessionId: sessionReview.sessionId ?? sessionId ?? null,
        };
      }

      const fallbackState =
        parserName === null && exitCode === 0 ? "completed" : "blocked";

      return {
        state: fallbackState,
        exitCode,
        pid,
        pidAlive: false,
        terminated: false,
        logPath: resolvedLogPath,
        secondsSinceUpdate: logStatus.secondsSinceUpdate,
        updatedAt: logStatus.updatedAt,
        logSize: logStatus.sizeBytes,
        tail: logStatus.tail,
        findings: sessionReview.findings,
        summary: sessionReview.summary,
        sessionLogPath: sessionLogPath ?? null,
        sessionId: sessionReview.sessionId ?? sessionId ?? null,
      };
    }

    const idleMs = Date.now() - lastProgressAt;
    if (idleMs >= stallMs) {
      await terminateProcess(pid);

      return {
        state: "stalled",
        exitCode,
        pid,
        pidAlive: false,
        terminated: true,
        logPath: resolvedLogPath,
        secondsSinceUpdate: logStatus.secondsSinceUpdate,
        updatedAt: logStatus.updatedAt,
        logSize: logStatus.sizeBytes,
        tail: logStatus.tail,
        findings: sessionReview.findings,
        summary: sessionReview.summary,
        sessionLogPath: sessionLogPath ?? null,
        sessionId: sessionReview.sessionId ?? sessionId ?? null,
      };
    }

    baselineSizeBytes = logStatus.sizeBytes;
    baselineUpdatedAt = logStatus.updatedAt;
    sessionBaselineSizeBytes = sessionLogStatus?.sizeBytes ?? null;
    sessionBaselineUpdatedAt = sessionLogStatus?.updatedAt ?? null;
    await sleep(pollMs);
  }
}

function parseCliOptions(argv = process.argv.slice(2)) {
  const [command] = argv;
  if (!command || command === "--help" || command === "-h") {
    return { help: true };
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    strict: true,
    allowPositionals: false,
    options: {
      cmd: { type: "string" },
      workdir: { type: "string" },
      log: { type: "string" },
      "pid-file": { type: "string" },
      "exit-file": { type: "string" },
      parser: { type: "string" },
      "stall-ms": { type: "string" },
      "poll-ms": { type: "string" },
      tail: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    return { help: true };
  }

  return {
    help: false,
    command,
    start: {
      command: values.cmd ?? null,
      workdir: values.workdir ?? process.cwd(),
      logPath: values.log ?? null,
      pidFilePath: values["pid-file"] ?? null,
      exitFilePath: values["exit-file"] ?? null,
    },
    wait: {
      logPath: values.log ?? null,
      pidFilePath: values["pid-file"] ?? null,
      exitFilePath: values["exit-file"] ?? null,
      parserName: values.parser ?? null,
      stallMs: ensurePositiveInteger(values["stall-ms"], "stall-ms", DEFAULT_STALL_MS),
      pollMs: ensurePositiveInteger(values["poll-ms"], "poll-ms", DEFAULT_POLL_MS),
      tail: ensurePositiveInteger(values.tail, "tail", DEFAULT_TAIL_LINES),
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliOptions(argv);

  if (options.help) {
    printUsage();
    return;
  }

  let result;
  if (options.command === "start") {
    result = await startManagedReview(options.start);
  } else if (options.command === "wait") {
    result = await waitForManagedReview(options.wait);
  } else {
    throw new Error(`Unknown command: ${options.command}`);
  }

  writeToStream(process.stdout, `${JSON.stringify(result)}\n`);
}

const invokedAsScript =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
