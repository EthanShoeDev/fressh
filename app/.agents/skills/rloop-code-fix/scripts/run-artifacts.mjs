#!/usr/bin/env node

import { access, copyFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import process from "process";
import { parseArgs } from "util";
import { pathToFileURL } from "url";

export const RUN_ROOT_SEGMENTS = ["docs", "tool-output", "rloop-code-fix"];
export const TRACKED_REVIEW_CONTEXT_DIR_SEGMENTS = ["docs", "run"];
export const EVENTS_FILE_NAME = "events.jsonl";
export const EVENT_LOG_VERSION = 3;
export const EXTERNAL_REVIEW_BATCH_SIZE = 5;
const REVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

const VERIFICATION_STATUSES = new Set([
  "pass",
  "pass_no_applicable_tests",
  "fail",
]);

const PHASE_LABELS = {
  setup: "Setup",
  external_review: "External Review",
  main_agent_triage: "Main-Agent Triage",
  main_agent_fix: "Main-Agent Fix",
  main_agent_verify: "Main-Agent Verify",
  deep_review: "Deep Review Checkpoint",
  user_decision: "User Decision",
  final_summary: "Final Summary",
};

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === null || entry === undefined) {
        return false;
      }

      if (Array.isArray(entry) && entry.length === 0) {
        return false;
      }

      return true;
    })
  );
}

export function normalizeRepoRelativePath(targetPath) {
  return targetPath.split(path.sep).join("/");
}

function isAttemptVersionedArtifact(destination) {
  return (
    destination.startsWith("verification/") ||
    /^rounds\/\d+\/main-agent-(fix|verify)\.md$/.test(destination)
  );
}

export function toRepoRelativePath(targetPath, repoRoot = process.cwd()) {
  return normalizeRepoRelativePath(path.relative(repoRoot, targetPath));
}

export function validateReviewId(reviewId) {
  const normalizedReviewId = String(reviewId ?? "").trim();

  if (!normalizedReviewId) {
    throw new Error("reviewId is required");
  }

  if (!REVIEW_ID_PATTERN.test(normalizedReviewId)) {
    throw new Error(
      `reviewId must contain only letters, digits, and hyphens: ${reviewId}`
    );
  }

  return normalizedReviewId;
}

export function resolveRunDir(reviewId, repoRoot = process.cwd()) {
  const normalizedReviewId = validateReviewId(reviewId);

  return path.join(repoRoot, ...RUN_ROOT_SEGMENTS, normalizedReviewId);
}

export function resolveRunRoot(repoRoot = process.cwd()) {
  return path.join(repoRoot, ...RUN_ROOT_SEGMENTS);
}

export function getTrackedReviewContextFileName(reviewId) {
  return `rloop-code-fix-${validateReviewId(reviewId)}.md`;
}

export function resolveTrackedReviewContextDir(repoRoot = process.cwd()) {
  return path.join(repoRoot, ...TRACKED_REVIEW_CONTEXT_DIR_SEGMENTS);
}

export function resolveTrackedReviewContextPath(reviewId, repoRoot = process.cwd()) {
  return path.join(
    resolveTrackedReviewContextDir(repoRoot),
    getTrackedReviewContextFileName(reviewId)
  );
}

export function validateRunDir(runDir, repoRoot = process.cwd()) {
  if (!runDir) {
    throw new Error("runDir is required");
  }

  const absoluteRepoRoot = path.resolve(repoRoot);
  const absoluteRunRoot = resolveRunRoot(absoluteRepoRoot);
  const absoluteRunDir = path.isAbsolute(runDir)
    ? path.resolve(runDir)
    : path.resolve(absoluteRepoRoot, runDir);
  const relativeToRunRoot = path.relative(absoluteRunRoot, absoluteRunDir);

  if (
    !relativeToRunRoot ||
    relativeToRunRoot.startsWith("..") ||
    path.isAbsolute(relativeToRunRoot) ||
    relativeToRunRoot.split(path.sep).length !== 1
  ) {
    throw new Error(
      `runDir must be a direct child of ${toRepoRelativePath(absoluteRunRoot, absoluteRepoRoot)}: ${runDir}`
    );
  }

  return absoluteRunDir;
}

export async function requireExistingRunDir(runDir, repoRoot = process.cwd()) {
  const absoluteRunDir = validateRunDir(runDir, repoRoot);

  if (!(await fileExists(absoluteRunDir))) {
    throw new Error(`Run directory not found: ${toRepoRelativePath(absoluteRunDir, repoRoot)}`);
  }

  return absoluteRunDir;
}

export function resolveNestedRunPath(runDir, relativePath) {
  const absoluteRunDir = path.resolve(runDir);
  const resolvedPath = path.resolve(absoluteRunDir, relativePath);

  if (
    resolvedPath !== absoluteRunDir &&
    !resolvedPath.startsWith(`${absoluteRunDir}${path.sep}`)
  ) {
    throw new Error(`Destination must stay inside the run directory: ${relativePath}`);
  }

  return resolvedPath;
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveArtifactDestination(runDir, destination) {
  const absoluteDestination = resolveNestedRunPath(runDir, destination);

  if (!(await fileExists(absoluteDestination))) {
    return absoluteDestination;
  }

  const normalizedDestination = normalizeRepoRelativePath(destination);
  if (!isAttemptVersionedArtifact(normalizedDestination)) {
    throw new Error(`Artifact destination already exists: ${destination}`);
  }

  const { dir, name, ext } = path.parse(absoluteDestination);
  for (let attemptNumber = 2; ; attemptNumber += 1) {
    const candidate = path.join(dir, `${name}-attempt-${attemptNumber}${ext}`);
    if (!(await fileExists(candidate))) {
      return candidate;
    }
  }
}

export function formatDuration(durationMs) {
  const normalizedDurationMs = Number(durationMs);

  if (!Number.isFinite(normalizedDurationMs) || normalizedDurationMs < 0) {
    return null;
  }

  if (normalizedDurationMs < 1000) {
    return `${Math.round(normalizedDurationMs)}ms`;
  }

  const totalSeconds = Math.floor(normalizedDurationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

export function resolveDurationDetails({
  startedAt,
  endedAt,
  durationMs,
  fallbackEndedAt,
}) {
  const resolvedStartedAt = startedAt ?? null;
  const resolvedEndedAt = endedAt ?? fallbackEndedAt ?? null;
  let resolvedDurationMs =
    durationMs === undefined || durationMs === null ? null : Number(durationMs);

  if (
    resolvedDurationMs === null &&
    resolvedStartedAt &&
    resolvedEndedAt
  ) {
    const computedDurationMs =
      new Date(resolvedEndedAt).getTime() - new Date(resolvedStartedAt).getTime();

    if (Number.isFinite(computedDurationMs) && computedDurationMs >= 0) {
      resolvedDurationMs = computedDurationMs;
    }
  }

  if (!Number.isFinite(resolvedDurationMs)) {
    resolvedDurationMs = null;
  }

  return {
    startedAt: resolvedStartedAt,
    endedAt: resolvedEndedAt,
    durationMs: resolvedDurationMs,
    durationText:
      resolvedDurationMs === null ? null : formatDuration(resolvedDurationMs),
  };
}

function parseTextItems(contents) {
  const trimmedContents = contents.trim();
  if (!trimmedContents) {
    return [];
  }

  const lines = trimmedContents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLines = lines
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);

  if (bulletLines.length > 0) {
    return bulletLines;
  }

  const collapsed = trimmedContents.replace(/\s*\n\s*/g, " ").trim();
  return collapsed ? [collapsed] : [];
}

async function loadItems({ values = [], filePath }) {
  const directValues = values.map((value) => value.trim()).filter(Boolean);

  if (!filePath) {
    return [...new Set(directValues)];
  }

  const contents = await readFile(filePath, "utf8");
  return [...new Set([...directValues, ...parseTextItems(contents)])];
}

async function loadText({ value, filePath }) {
  const directValue = String(value ?? "").trim();

  if (!filePath) {
    return directValue || null;
  }

  const contents = (await readFile(filePath, "utf8")).trim();
  return contents || directValue || null;
}

function derivePhaseFromTitle(title) {
  const normalizedTitle = String(title ?? "").toLowerCase();

  if (normalizedTitle.includes("setup")) {
    return "setup";
  }

  if (normalizedTitle.includes("deep review")) {
    return "deep_review";
  }

  if (
    normalizedTitle.includes("external review") ||
    normalizedTitle.includes("codex review")
  ) {
    return "external_review";
  }

  if (normalizedTitle.includes("triage")) {
    return "main_agent_triage";
  }

  if (normalizedTitle.includes("fix")) {
    return "main_agent_fix";
  }

  if (normalizedTitle.includes("verify")) {
    return "main_agent_verify";
  }

  if (normalizedTitle.includes("decision")) {
    return "user_decision";
  }

  if (normalizedTitle.includes("final summary")) {
    return "final_summary";
  }

  return null;
}

function deriveRoundFromTitle(title) {
  const match = String(title ?? "").match(/\bRound\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function parseEventLog(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function loadRunState(runDir, repoRoot = process.cwd()) {
  const absoluteRunDir = await requireExistingRunDir(runDir, repoRoot);
  const eventsPath = path.join(absoluteRunDir, EVENTS_FILE_NAME);

  if (!(await fileExists(eventsPath))) {
    throw new Error(`Event log not found: ${toRepoRelativePath(eventsPath, repoRoot)}`);
  }

  const events = parseEventLog(await readFile(eventsPath, "utf8"));
  const metadataEvent = events.find((event) => event.type === "run_initialized");

  if (!metadataEvent) {
    throw new Error(`Run metadata missing in ${toRepoRelativePath(eventsPath, repoRoot)}`);
  }

  return {
    absoluteRunDir,
    eventsPath,
    metadata: metadataEvent,
    steps: events.filter((event) => event.type === "step"),
  };
}

function getPhaseLabel(phase) {
  return PHASE_LABELS[phase] ?? phase ?? "Step";
}

function getStepLabel(step) {
  const title = String(step.title ?? "").trim();
  if (!title) {
    return getPhaseLabel(step.phase);
  }

  if (step.round !== null && step.round !== undefined) {
    return title.replace(new RegExp(`^Round\\s+${step.round}\\s*/\\s*`, "i"), "").trim();
  }

  return title;
}

function getStepAnchorLabel(step) {
  if (step.round !== null && step.round !== undefined) {
    return `Round ${step.round} / ${getStepLabel(step)}`;
  }

  return getStepLabel(step);
}

function getTimestampValue(value) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getStepStart(step) {
  return step.startedAt ?? step.endedAt ?? step.timestamp ?? null;
}

function getStepEnd(step) {
  return step.endedAt ?? step.timestamp ?? step.startedAt ?? null;
}

function getRangeDuration(startedAt, endedAt) {
  const startValue = getTimestampValue(startedAt);
  const endValue = getTimestampValue(endedAt);

  if (startValue === null || endValue === null || endValue < startValue) {
    return null;
  }

  return endValue - startValue;
}

function sumStepDurations(steps) {
  let totalDurationMs = 0;
  let hasDuration = false;

  for (const step of steps) {
    if (!Number.isFinite(step.durationMs) || step.durationMs < 0) {
      continue;
    }

    totalDurationMs += step.durationMs;
    hasDuration = true;
  }

  return hasDuration ? totalDurationMs : null;
}

function getRunEndedAt(steps) {
  const timestamps = steps
    .map((step) => getStepEnd(step))
    .map((value) => getTimestampValue(value))
    .filter((value) => value !== null);

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function groupRoundSteps(steps) {
  const roundMap = new Map();

  for (const step of steps) {
    if (step.round === null || step.round === undefined) {
      continue;
    }

    const roundSteps = roundMap.get(step.round) ?? [];
    roundSteps.push(step);
    roundMap.set(step.round, roundSteps);
  }

  return [...roundMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([round, roundSteps]) => ({ round, steps: roundSteps }));
}

function getLatestRoundNumber(steps) {
  return steps.reduce((latestRound, step) => {
    if (!Number.isFinite(step.round) || step.round < 1) {
      return latestRound;
    }

    return Math.max(latestRound, step.round);
  }, 0);
}

function getBatchWindow(round) {
  const normalizedRound = Number.isFinite(round) && round > 0 ? round : 1;
  const batchIndex = Math.floor((normalizedRound - 1) / EXTERNAL_REVIEW_BATCH_SIZE);
  const start = batchIndex * EXTERNAL_REVIEW_BATCH_SIZE + 1;
  const end = start + EXTERNAL_REVIEW_BATCH_SIZE - 1;

  return {
    start,
    end,
    label: `${start}-${end}`,
  };
}

function countItems(steps, key) {
  return steps.reduce((total, step) => total + (step[key]?.length ?? 0), 0);
}

function countItemsForPhases(steps, key, phases) {
  const allowedPhases = new Set(phases);

  return steps.reduce((total, step) => {
    if (!allowedPhases.has(step.phase)) {
      return total;
    }

    return total + (step[key]?.length ?? 0);
  }, 0);
}

function findLatestVerificationStep(steps) {
  return [...steps]
    .reverse()
    .find(
      (step) =>
        step.phase === "main_agent_verify" && step.verificationStatus
    );
}

function findLatestStepForPhase(steps, phase) {
  return [...steps].reverse().find((step) => step.phase === phase);
}

function findLatestStepIndexForPhase(steps, phase) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].phase === phase) {
      return index;
    }
  }

  return -1;
}

function findLatestExternalReviewStep(steps) {
  return findLatestStepForPhase(steps, "external_review");
}

function findLatestFinalSummaryStep(steps) {
  return findLatestStepForPhase(steps, "final_summary");
}

function findLatestVerificationIndex(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.phase === "main_agent_verify" && step.verificationStatus) {
      return index;
    }
  }

  return -1;
}

function findLatestCompletedFinalSummaryIndex(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.phase === "final_summary" && step.status === "completed") {
      return index;
    }
  }

  return -1;
}

function collectWorkflowViolations(steps) {
  const violations = [];
  const pendingVerifyByRound = new Map();
  let sawCleanExternalReview = false;

  for (const step of steps) {
    if (step.phase === "external_review" && step.status === "clean") {
      sawCleanExternalReview = true;
    }

    if (step.phase === "main_agent_fix" && Number.isFinite(step.round)) {
      pendingVerifyByRound.set(step.round, step);
      continue;
    }

    if (step.phase === "main_agent_verify" && Number.isFinite(step.round)) {
      pendingVerifyByRound.delete(step.round);
      continue;
    }

    if (
      step.phase === "external_review" ||
      step.phase === "deep_review" ||
      step.phase === "user_decision" ||
      step.phase === "final_summary"
    ) {
      for (const [round, fixStep] of pendingVerifyByRound.entries()) {
        violations.push({
          kind: "missing_round_verify",
          round,
          stepTitle: step.title ?? getPhaseLabel(step.phase),
          message: `Round ${round} advanced to ${step.title ?? getPhaseLabel(step.phase)} without a persisted main-agent verify after the latest fix (${fixStep.title ?? "Main-Agent Fix"}).`,
        });
        pendingVerifyByRound.delete(round);
      }
    }

    if (step.phase === "deep_review" && !sawCleanExternalReview) {
      violations.push({
        kind: "deep_review_before_clean_external_review",
        message:
          "A deep review step was recorded before the first clean external review. Deep review can only run after external review returns clean.",
      });
    }
  }

  const latestExternalReviewStep = findLatestExternalReviewStep(steps);
  const latestExternalReviewIndex = findLatestStepIndexForPhase(steps, "external_review");
  const latestCompletedFinalSummaryIndex = findLatestCompletedFinalSummaryIndex(steps);

  if (latestCompletedFinalSummaryIndex >= 0) {
    if (!latestExternalReviewStep || latestExternalReviewStep.status !== "clean") {
      violations.push({
        kind: "completed_closeout_without_clean_review",
        message:
          "A completed final closeout was recorded before the latest external review reached a clean result.",
      });
    } else if (latestCompletedFinalSummaryIndex < latestExternalReviewIndex) {
      violations.push({
        kind: "completed_closeout_before_latest_clean_review",
        message:
          "A completed final closeout was recorded before the latest clean external review event.",
      });
    }
  }

  return violations;
}

function hasPostVerificationWork(steps, latestVerificationIndex) {
  if (latestVerificationIndex < 0) {
    return false;
  }

  return steps.slice(latestVerificationIndex + 1).some((step) => {
    return step.phase === "main_agent_fix";
  });
}

function hasUnverifiedFixWork(steps, latestVerificationIndex) {
  if (latestVerificationIndex < 0) {
    return steps.some((step) => step.phase === "main_agent_fix");
  }

  return hasPostVerificationWork(steps, latestVerificationIndex);
}

function stepHasRecordedFindings(step) {
  return (
    (step.findings?.length ?? 0) > 0 ||
    (step.fixedNow?.length ?? 0) > 0 ||
    (step.deferred?.length ?? 0) > 0 ||
    (step.separateIssues?.length ?? 0) > 0 ||
    (step.falsePositives?.length ?? 0) > 0
  );
}

function stepHasActionableFindings(step) {
  return (
    (step.findings?.length ?? 0) > 0 ||
    (step.fixedNow?.length ?? 0) > 0 ||
    (step.deferred?.length ?? 0) > 0 ||
    (step.separateIssues?.length ?? 0) > 0
  );
}

function hasDeepReviewCheckpointAfterCleanReview(steps) {
  let sawCleanExternalReview = false;

  for (const step of steps) {
    if (step.phase === "external_review" && step.status === "clean") {
      sawCleanExternalReview = true;
    }

    if (step.phase === "deep_review" && sawCleanExternalReview) {
      return true;
    }
  }

  return false;
}

function hasPostCleanExternalReviewWork(steps, latestExternalReviewIndex) {
  if (latestExternalReviewIndex < 0) {
    return false;
  }

  return steps.slice(latestExternalReviewIndex + 1).some((step) => {
    if (step.phase === "final_summary") {
      return false;
    }

    if (
      step.phase === "main_agent_triage" ||
      step.phase === "main_agent_fix" ||
      step.phase === "main_agent_verify"
    ) {
      return true;
    }

    if (step.phase === "deep_review") {
      return stepHasActionableFindings(step);
    }

    return false;
  });
}

function normalizeIssueKey(item) {
  const normalizedItem = String(item ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  return normalizedItem || null;
}

function updateDispositionLedger(dispositionLedger, items, disposition, step) {
  for (const item of items ?? []) {
    const normalizedItem = normalizeIssueKey(item);

    if (!normalizedItem) {
      continue;
    }

    if (disposition === "resolved") {
      dispositionLedger.delete(normalizedItem);
      continue;
    }

    dispositionLedger.set(normalizedItem, {
      disposition,
      item,
      round: step.round ?? null,
      label: getStepAnchorLabel(step),
    });
  }
}

function collectLatestDispositionRecords(steps, disposition) {
  const dispositionLedger = new Map();

  for (const step of steps) {
    updateDispositionLedger(dispositionLedger, step.deferred, "deferred", step);
    updateDispositionLedger(
      dispositionLedger,
      step.separateIssues,
      "separate_issue",
      step
    );
    updateDispositionLedger(
      dispositionLedger,
      step.falsePositives,
      "false_positive",
      step
    );
    if (step.phase === "main_agent_fix") {
      updateDispositionLedger(dispositionLedger, step.fixedNow, "resolved", step);
    }
  }

  return [...dispositionLedger.values()].filter(
    (record) => record.disposition === disposition
  );
}

export function deriveSuggestedFinalStatus(steps) {
  const latestStep = steps[steps.length - 1] ?? null;
  const latestVerificationStep = findLatestVerificationStep(steps);
  const latestVerificationIndex = findLatestVerificationIndex(steps);
  const latestExternalReviewStep = findLatestExternalReviewStep(steps);
  const latestExternalReviewIndex = findLatestStepIndexForPhase(
    steps,
    "external_review"
  );
  const latestFinalSummaryStep = findLatestFinalSummaryStep(steps);
  const deferredFollowUps = collectLatestDispositionRecords(steps, "deferred");
  const separateIssueFollowUps = collectLatestDispositionRecords(
    steps,
    "separate_issue"
  );
  const hasFollowUps =
    deferredFollowUps.length > 0 || separateIssueFollowUps.length > 0;
  const hasRequiredDeepReviewCheckpoint =
    hasDeepReviewCheckpointAfterCleanReview(steps);
  const workflowViolations = collectWorkflowViolations(steps);

  if (
    latestVerificationStep?.verificationStatus === "fail" ||
    ["failed", "blocked"].includes(latestStep?.status ?? "") ||
    workflowViolations.length > 0
  ) {
    return "blocked";
  }

  if (
    latestStep?.phase === "final_summary" &&
    latestStep?.status === "stopped"
  ) {
    return "stopped";
  }

  if (
    latestStep?.status === "needs_user_decision" ||
    latestStep?.status === "stalled" ||
    latestExternalReviewStep?.status === "stalled"
  ) {
    return "needs_user_decision";
  }

  if (!latestExternalReviewStep || latestExternalReviewStep.status !== "clean") {
    return "in_progress";
  }

  if (hasPostCleanExternalReviewWork(steps, latestExternalReviewIndex)) {
    return "in_progress";
  }

  if (
    !latestFinalSummaryStep ||
    latestStep?.phase !== "final_summary" ||
    latestStep?.status !== "completed"
  ) {
    return "in_progress";
  }

  if (!hasRequiredDeepReviewCheckpoint) {
    return "in_progress";
  }

  if (
    latestVerificationStep &&
    !["pass", "pass_no_applicable_tests"].includes(
      latestVerificationStep.verificationStatus
    )
  ) {
    return "in_progress";
  }

  if (!hasUnverifiedFixWork(steps, latestVerificationIndex)) {
    return hasFollowUps ? "ready_with_follow_ups" : "ready";
  }

  return "in_progress";
}

function stripPriorityPrefix(item) {
  return String(item ?? "").replace(/^\[[^\]]+\]\s*/, "").trim();
}

function buildSuggestedIssueTitle(item) {
  const strippedItem = stripPriorityPrefix(item)
    .replace(/^create github issue:\s*/i, "")
    .replace(/^follow-up:\s*/i, "")
    .trim();

  return strippedItem
    ? `Follow-up from rloop-code-fix: ${strippedItem}`
    : "Follow-up from rloop-code-fix";
}

function renderBulletList(items, emptyText = "None") {
  if (!items || items.length === 0) {
    return `- ${emptyText}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function renderStepSection(step) {
  const lines = [`### ${getStepLabel(step)}`, ""];

  lines.push(`- Status: \`${step.status ?? "unknown"}\``);

  if (step.purpose) {
    lines.push(`- Purpose: ${step.purpose}`);
  }

  if (step.result) {
    lines.push(`- Result: ${step.result}`);
  }

  if (step.followUp) {
    lines.push(`- Follow-up: ${step.followUp}`);
  }

  if (step.startedAt) {
    lines.push(`- Started At: \`${step.startedAt}\``);
  }

  if (step.endedAt) {
    lines.push(`- Ended At: \`${step.endedAt}\``);
  }

  if (step.durationText) {
    lines.push(`- Duration: \`${step.durationText}\``);
  }

  if (step.command) {
    lines.push(`- Command: \`${step.command}\``);
  }

  if (step.action) {
    lines.push(`- Action: ${step.action}`);
  }

  if (step.artifactPath) {
    lines.push(`- Saved artifact: \`${step.artifactPath}\``);
  }

  if (step.sessionId) {
    lines.push(`- Session ID: \`${step.sessionId}\``);
  }

  if (step.verificationStatus) {
    lines.push(`- Verification Status: \`${step.verificationStatus}\``);
  }

  if (step.question) {
    lines.push(`- Question: ${step.question}`);
  }

  if (step.answer) {
    lines.push(`- Answer: ${step.answer}`);
  }

  lines.push(
    "",
    "#### Findings",
    renderBulletList(step.findings),
    "",
    "#### Fixed Now",
    renderBulletList(step.fixedNow),
    "",
    "#### Deferred in Current PR",
    renderBulletList(step.deferred),
    "",
    "#### Suggested Separate Issues",
    renderBulletList(step.separateIssues),
    "",
    "#### Rejected False Positives",
    renderBulletList(step.falsePositives),
    "",
    "#### Notes",
    renderBulletList(step.notes),
    ""
  );

  if (step.details) {
    lines.push("#### Details", step.details, "");
  }

  return lines.join("\n");
}

function buildRoundSummary(steps) {
  const startedAt = steps
    .map((step) => getStepStart(step))
    .find(Boolean);
  const endedAt = [...steps]
    .reverse()
    .map((step) => getStepEnd(step))
    .find(Boolean);
  const totalDuration = formatDuration(getRangeDuration(startedAt, endedAt));
  const latestVerifyStep = [...steps]
    .reverse()
    .find((step) => step.phase === "main_agent_verify");

  const durationsByPhase = Object.fromEntries(
    ["external_review", "main_agent_triage", "main_agent_fix", "main_agent_verify"].map(
      (phase) => {
        const phaseSteps = steps.filter((step) => step.phase === phase);
        const totalPhaseDuration = sumStepDurations(phaseSteps);
        return [phase, totalPhaseDuration === null ? "n/a" : formatDuration(totalPhaseDuration)];
      }
    )
  );

  return {
    totalDuration: totalDuration ?? "n/a",
    reviewDuration: durationsByPhase.external_review,
    triageDuration: durationsByPhase.main_agent_triage,
    fixDuration: durationsByPhase.main_agent_fix,
    verifyDuration: durationsByPhase.main_agent_verify,
    findingsCount: countItems(steps, "findings"),
    fixedCount: countItemsForPhases(steps, "fixedNow", ["main_agent_fix"]),
    deferredCount: countItems(steps, "deferred"),
    separateIssueCount: countItems(steps, "separateIssues"),
    falsePositiveCount: countItems(steps, "falsePositives"),
    verificationStatus: latestVerifyStep?.verificationStatus ?? "not_run",
    outcome: steps[steps.length - 1]?.result ?? steps[steps.length - 1]?.status ?? "No result recorded.",
  };
}

function renderRoundReportTable(roundGroups) {
  const lines = [
    "| Round | Total | Review | Triage | Fix | Verify | Findings | Fixed | Deferred | Separate | Rejected | Verification | Outcome |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const group of roundGroups) {
    const summary = buildRoundSummary(group.steps);
    lines.push(
      `| ${group.round} | ${summary.totalDuration} | ${summary.reviewDuration} | ${summary.triageDuration} | ${summary.fixDuration} | ${summary.verifyDuration} | ${summary.findingsCount} | ${summary.fixedCount} | ${summary.deferredCount} | ${summary.separateIssueCount} | ${summary.falsePositiveCount} | ${summary.verificationStatus} | ${summary.outcome.replace(/\|/g, "\\|")} |`
    );
  }

  return lines.join("\n");
}

function renderDeepReviewTable(steps) {
  if (steps.length === 0) {
    return "- Not run.";
  }

  const lines = [
    "| Step | Duration | Findings | Fixed Now | Result |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const step of steps) {
    lines.push(
      `| ${getStepLabel(step)} | ${step.durationText ?? "n/a"} | ${step.findings?.length ?? 0} | ${step.fixedNow?.length ?? 0} | ${(step.result ?? step.status ?? "No result recorded.").replace(/\|/g, "\\|")} |`
    );
  }

  return lines.join("\n");
}

export function renderTrackedReviewContextReport(metadata, steps) {
  const latestExternalReviewStep = findLatestExternalReviewStep(steps);
  const latestVerificationStep = findLatestVerificationStep(steps);
  const latestRound = latestExternalReviewStep?.round ?? getLatestRoundNumber(steps);
  const batchWindow = getBatchWindow(latestRound || 1);
  const deferredFollowUps = collectLatestDispositionRecords(steps, "deferred");
  const separateIssueFollowUps = collectLatestDispositionRecords(
    steps,
    "separate_issue"
  );
  const falsePositiveFollowUps = collectLatestDispositionRecords(
    steps,
    "false_positive"
  );
  const deepReviewSteps = steps.filter((step) => step.phase === "deep_review");
  const deepReviewRan = hasDeepReviewCheckpointAfterCleanReview(steps);
  const roundGroups = groupRoundSteps(steps);
  const suggestedFinalStatus = deriveSuggestedFinalStatus(steps);
  const endedAt = getRunEndedAt(steps) ?? metadata.startedAt;
  const totalDuration =
    formatDuration(getRangeDuration(metadata.startedAt, endedAt)) ?? "n/a";
  const workflowViolations = collectWorkflowViolations(steps);
  const userDecisionSteps = steps.filter((step) => step.phase === "user_decision");
  const trackedReviewContextPath = normalizeRepoRelativePath(
    path.join(
      ...TRACKED_REVIEW_CONTEXT_DIR_SEGMENTS,
      getTrackedReviewContextFileName(metadata.reviewId)
    )
  );
  const allArtifacts = steps
    .map((step) => step.artifactPath)
    .filter(Boolean);
  const draftIssueLines =
    separateIssueFollowUps.length === 0
      ? ["- None"]
      : separateIssueFollowUps.flatMap((record, index) => {
          const title = buildSuggestedIssueTitle(record.item);
          const sourceLabel =
            record.round === null ? record.label : `Round ${record.round}`;

          return [
            `### Draft ${index + 1}: ${title}`,
            `- Suggested title: \`${title}\``,
            "- Suggested body:",
            "```md",
            `Follow-up from rloop-code-fix run ${metadata.reviewId}.`,
            "",
            `Source: ${sourceLabel}`,
            `Original finding: ${record.item}`,
            "",
            "Why separate:",
            "- Real issue, but intentionally moved out of the current PR scope.",
            "",
            "Evidence:",
            `- ${trackedReviewContextPath}`,
            `- ${normalizeRepoRelativePath(path.join(metadata.runDirRelative, EVENTS_FILE_NAME))}`,
            "```",
            "",
          ];
        });
  const renderDecisionLines =
    userDecisionSteps.length === 0
      ? ["- None"]
      : userDecisionSteps.map((step) => {
          const parts = [];

          if (step.question) {
            parts.push(`Q: ${step.question}`);
          }
          if (step.answer) {
            parts.push(`A: ${step.answer}`);
          }
          if (step.result) {
            parts.push(step.result);
          }

          const label =
            step.timestamp || step.endedAt || step.startedAt
              ? `\`${step.timestamp ?? step.endedAt ?? step.startedAt}\``
              : getStepLabel(step);

          return `- ${label} ${parts.join(" | ")}`.trim();
        });

  const timelineSections = [];
  let currentSection = null;

  for (const step of steps) {
    const nextSection =
      step.phase === "setup"
        ? "## Setup"
        : step.phase === "deep_review"
          ? "## Deep Review Checkpoint"
          : step.phase === "user_decision"
            ? "## User Decisions"
            : step.phase === "final_summary"
              ? "## Final Closeout"
              : step.round !== null && step.round !== undefined
                ? `## Round ${step.round}`
                : "## Ungrouped Steps";

    if (nextSection !== currentSection) {
      timelineSections.push(nextSection, "");
      currentSection = nextSection;
    }

    timelineSections.push(renderStepSection(step));
  }

  return [
    "# rloop-code-fix Process Report",
    "",
    `- Review ID: \`${metadata.reviewId}\``,
    `- Run directory: \`${metadata.runDirRelative}\``,
    `- Event log: \`${normalizeRepoRelativePath(path.join(metadata.runDirRelative, EVENTS_FILE_NAME))}\``,
    `- Tracked report path: \`${trackedReviewContextPath}\``,
    "",
    "This is the canonical repo-tracked process report for later `codex review --uncommitted` rounds.",
    "Use it for prior findings, decisions, answers, and current state. Raw transcripts and logs stay under `docs/tool-output/...`.",
    "",
    "## Current State",
    `- Suggested final status: \`${suggestedFinalStatus}\``,
    `- Started at: \`${metadata.startedAt}\``,
    `- Ended at: \`${endedAt}\``,
    `- Total duration: \`${totalDuration}\``,
    `- Rounds run: \`${roundGroups.length}\``,
    `- Current external review round: \`${latestRound || 0}\``,
    `- Current batch window: \`${batchWindow.label}\``,
    `- Latest external review status: \`${latestExternalReviewStep?.status ?? "not_run"}\``,
    `- Clean external review achieved: \`${latestExternalReviewStep?.status === "clean" ? "yes" : "no"}\``,
    `- Deep review checkpoint: \`${deepReviewRan ? "ran" : "not_run"}\``,
    `- Latest verification status: \`${latestVerificationStep?.verificationStatus ?? "not_run"}\``,
    latestVerificationStep?.result
      ? `- Latest verification result: ${latestVerificationStep.result}`
      : "- Latest verification result: None recorded",
    "",
    "## Workflow Violations",
    renderBulletList(workflowViolations.map((violation) => violation.message)),
    "",
    "## Latest External Review Findings",
    renderBulletList(latestExternalReviewStep?.findings),
    "",
    "## Deferred in Current PR",
    renderBulletList(
      deferredFollowUps.map(
        (item) => `${item.round === null ? item.label : `Round ${item.round}`}: ${item.item}`
      )
    ),
    "",
    "## Suggested Separate Issues",
    renderBulletList(
      separateIssueFollowUps.map(
        (item) => `${item.round === null ? item.label : `Round ${item.round}`}: ${item.item}`
      )
    ),
    "",
    "## Known Rejected Findings",
    renderBulletList(
      falsePositiveFollowUps.map(
        (item) => `${item.round === null ? item.label : `Round ${item.round}`}: ${item.item}`
      )
    ),
    "",
    "## User Decisions",
    ...renderDecisionLines,
    "",
    "## Round Report",
    roundGroups.length > 0 ? renderRoundReportTable(roundGroups) : "- No rounds recorded yet.",
    "",
    "## Deep Review Summary",
    renderDeepReviewTable(deepReviewSteps),
    "",
    "## Full Timeline",
    "",
    ...(timelineSections.length > 0 ? timelineSections : ["- No steps recorded yet."]),
    "",
    "## Draft GitHub Issues",
    ...draftIssueLines,
    "",
    "## Artifact Index",
    `- events log: \`${normalizeRepoRelativePath(path.join(metadata.runDirRelative, EVENTS_FILE_NAME))}\``,
    `- tracked process report: \`${trackedReviewContextPath}\``,
    "- saved artifacts:",
    ...(allArtifacts.length > 0 ? allArtifacts.map((artifact) => `  - \`${artifact}\``) : ["  - None"]),
    "",
  ].join("\n");
}

async function writeGeneratedReports({ absoluteRunDir, repoRoot, metadata, steps }) {
  const trackedReviewContextPath = resolveTrackedReviewContextPath(
    metadata.reviewId,
    repoRoot
  );
  await mkdir(path.dirname(trackedReviewContextPath), { recursive: true });
  await writeFile(
    trackedReviewContextPath,
    renderTrackedReviewContextReport(metadata, steps),
    "utf8"
  );

  return {
    reportPath: toRepoRelativePath(trackedReviewContextPath, repoRoot),
    trackedReviewContextPath: toRepoRelativePath(trackedReviewContextPath, repoRoot),
  };
}

export async function initRunArtifacts({
  reviewId,
  repoRoot = process.cwd(),
  startedAt = new Date().toISOString(),
}) {
  const normalizedReviewId = validateReviewId(reviewId);
  const runDir = resolveRunDir(reviewId, repoRoot);
  const trackedReviewContextPath = resolveTrackedReviewContextPath(
    reviewId,
    repoRoot
  );

  if (await fileExists(runDir)) {
    throw new Error(
      `Run directory already exists: ${toRepoRelativePath(runDir, repoRoot)}. Use a new review ID.`
    );
  }

  if (await fileExists(trackedReviewContextPath)) {
    throw new Error(
      `Tracked review context already exists: ${toRepoRelativePath(trackedReviewContextPath, repoRoot)}. Use a new review ID.`
    );
  }

  await mkdir(path.join(runDir, "rounds"), { recursive: true });
  await mkdir(path.join(runDir, "deep-review"), { recursive: true });
  await mkdir(path.join(runDir, "verification"), { recursive: true });

  const runDirRelative = toRepoRelativePath(runDir, repoRoot);
  const metadata = compactObject({
    version: EVENT_LOG_VERSION,
    type: "run_initialized",
    reviewId: normalizedReviewId,
    runDirRelative,
    startedAt,
    timestamp: startedAt,
  });
  const eventsPath = path.join(runDir, EVENTS_FILE_NAME);

  await writeFile(eventsPath, `${JSON.stringify(metadata)}\n`, "utf8");
  const reportPaths = await writeGeneratedReports({
    absoluteRunDir: runDir,
    repoRoot,
    metadata,
    steps: [],
  });

  return {
    runDir,
    runDirRelative,
    eventsPath: toRepoRelativePath(eventsPath, repoRoot),
    ...reportPaths,
  };
}

export async function recordRunArtifact({
  runDir,
  repoRoot = process.cwd(),
  source,
  destination,
  artifactPath,
  title,
  phase,
  round,
  status,
  purpose,
  result,
  followUp,
  startedAt,
  endedAt,
  durationMs,
  command,
  action,
  sessionId,
  findings = [],
  findingsFile,
  fixNow = [],
  fixesFile,
  deferred = [],
  deferredFile,
  separateIssues = [],
  separateIssuesFile,
  falsePositives = [],
  falsePositivesFile,
  notes = [],
  notesFile,
  details,
  detailsFile,
  question,
  answer,
  verificationStatus,
  timestamp = new Date().toISOString(),
}) {
  const { absoluteRunDir, eventsPath, metadata, steps } = await loadRunState(runDir, repoRoot);
  let resolvedArtifactPath = artifactPath ?? null;

  if (source) {
    if (!destination) {
      throw new Error("destination is required when source is provided");
    }

    const absoluteSource = path.isAbsolute(source) ? source : path.join(repoRoot, source);
    const absoluteDestination = await resolveArtifactDestination(absoluteRunDir, destination);
    await mkdir(path.dirname(absoluteDestination), { recursive: true });
    await copyFile(absoluteSource, absoluteDestination);
    resolvedArtifactPath = toRepoRelativePath(absoluteDestination, repoRoot);
  } else if (artifactPath) {
    resolvedArtifactPath = path.isAbsolute(artifactPath)
      ? toRepoRelativePath(artifactPath, repoRoot)
      : normalizeRepoRelativePath(artifactPath);
  }

  if (verificationStatus && !VERIFICATION_STATUSES.has(verificationStatus)) {
    throw new Error(
      `verificationStatus must be one of: ${[...VERIFICATION_STATUSES].join(", ")}`
    );
  }

  const resolvedPhase = phase ?? derivePhaseFromTitle(title);
  const resolvedRound =
    round === undefined || round === null || round === ""
      ? deriveRoundFromTitle(title)
      : Number(round);
  const duration = resolveDurationDetails({
    startedAt,
    endedAt,
    durationMs,
    fallbackEndedAt: timestamp,
  });

  const event = compactObject({
    version: EVENT_LOG_VERSION,
    type: "step",
    timestamp,
    title,
    phase: resolvedPhase,
    round: Number.isFinite(resolvedRound) ? resolvedRound : null,
    status,
    purpose,
    result,
    followUp,
    startedAt: duration.startedAt,
    endedAt: duration.endedAt,
    durationMs: duration.durationMs,
    durationText: duration.durationText,
    command,
    action,
    artifactPath: resolvedArtifactPath,
    sessionId,
    verificationStatus,
    findings: await loadItems({
      values: findings,
      filePath: findingsFile
        ? path.isAbsolute(findingsFile)
          ? findingsFile
          : path.join(repoRoot, findingsFile)
        : undefined,
    }),
    fixedNow: await loadItems({
      values: fixNow,
      filePath: fixesFile
        ? path.isAbsolute(fixesFile)
          ? fixesFile
          : path.join(repoRoot, fixesFile)
        : undefined,
    }),
    deferred: await loadItems({
      values: deferred,
      filePath: deferredFile
        ? path.isAbsolute(deferredFile)
          ? deferredFile
          : path.join(repoRoot, deferredFile)
        : undefined,
    }),
    separateIssues: await loadItems({
      values: separateIssues,
      filePath: separateIssuesFile
        ? path.isAbsolute(separateIssuesFile)
          ? separateIssuesFile
          : path.join(repoRoot, separateIssuesFile)
        : undefined,
    }),
    falsePositives: await loadItems({
      values: falsePositives,
      filePath: falsePositivesFile
        ? path.isAbsolute(falsePositivesFile)
          ? falsePositivesFile
          : path.join(repoRoot, falsePositivesFile)
        : undefined,
    }),
    notes: await loadItems({
      values: notes,
      filePath: notesFile
        ? path.isAbsolute(notesFile)
          ? notesFile
          : path.join(repoRoot, notesFile)
        : undefined,
    }),
    details: await loadText({
      value: details,
      filePath: detailsFile
        ? path.isAbsolute(detailsFile)
          ? detailsFile
          : path.join(repoRoot, detailsFile)
        : undefined,
    }),
    question,
    answer,
  });

  await writeFile(eventsPath, `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    flag: "a",
  });

  const reportPaths = await writeGeneratedReports({
    absoluteRunDir,
    repoRoot,
    metadata,
    steps: [...steps, event],
  });

  return {
    artifactPath: resolvedArtifactPath,
    eventsPath: toRepoRelativePath(eventsPath, repoRoot),
    ...reportPaths,
  };
}

export async function summarizeRunArtifacts({
  runDir,
  repoRoot = process.cwd(),
}) {
  const { absoluteRunDir, metadata, steps } = await loadRunState(runDir, repoRoot);
  return writeGeneratedReports({
    absoluteRunDir,
    repoRoot,
    metadata,
    steps,
  });
}

export function parseCliArgs(argv) {
  const [command, ...rest] = argv;

  if (!command) {
    throw new Error("command is required");
  }

  const options = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      "review-id": { type: "string" },
      "repo-root": { type: "string" },
      "run-dir": { type: "string" },
      source: { type: "string" },
      dest: { type: "string" },
      artifact: { type: "string" },
      title: { type: "string" },
      phase: { type: "string" },
      round: { type: "string" },
      status: { type: "string" },
      purpose: { type: "string" },
      result: { type: "string" },
      "follow-up": { type: "string" },
      "started-at": { type: "string" },
      "ended-at": { type: "string" },
      "duration-ms": { type: "string" },
      command: { type: "string" },
      action: { type: "string" },
      "session-id": { type: "string" },
      finding: { type: "string", multiple: true },
      "findings-file": { type: "string" },
      "fix-now": { type: "string", multiple: true },
      "fixes-file": { type: "string" },
      defer: { type: "string", multiple: true },
      "deferred-file": { type: "string" },
      "separate-issue": { type: "string", multiple: true },
      "separate-issues-file": { type: "string" },
      "false-positive": { type: "string", multiple: true },
      "false-positives-file": { type: "string" },
      note: { type: "string", multiple: true },
      "notes-file": { type: "string" },
      details: { type: "string" },
      "details-file": { type: "string" },
      question: { type: "string" },
      answer: { type: "string" },
      "verification-status": { type: "string" },
      timestamp: { type: "string" },
    },
  });

  return { command, values: options.values };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, values } = parseCliArgs(argv);
  const repoRoot = values["repo-root"] ?? process.cwd();

  if (command === "init") {
    const result = await initRunArtifacts({
      reviewId: values["review-id"],
      repoRoot,
      startedAt: values["started-at"],
    });
    process.stdout.write(`${result.runDirRelative}\n`);
    return;
  }

  if (command === "record") {
    const result = await recordRunArtifact({
      runDir: values["run-dir"],
      repoRoot,
      source: values.source,
      destination: values.dest,
      artifactPath: values.artifact,
      title: values.title,
      phase: values.phase,
      round: values.round,
      status: values.status,
      purpose: values.purpose,
      result: values.result,
      followUp: values["follow-up"],
      startedAt: values["started-at"],
      endedAt: values["ended-at"],
      durationMs: values["duration-ms"],
      command: values.command,
      action: values.action,
      sessionId: values["session-id"],
      findings: values.finding ?? [],
      findingsFile: values["findings-file"],
      fixNow: values["fix-now"] ?? [],
      fixesFile: values["fixes-file"],
      deferred: values.defer ?? [],
      deferredFile: values["deferred-file"],
      separateIssues: values["separate-issue"] ?? [],
      separateIssuesFile: values["separate-issues-file"],
      falsePositives: values["false-positive"] ?? [],
      falsePositivesFile: values["false-positives-file"],
      notes: values.note ?? [],
      notesFile: values["notes-file"],
      details: values.details,
      detailsFile: values["details-file"],
      question: values.question,
      answer: values.answer,
      verificationStatus: values["verification-status"],
      timestamp: values.timestamp,
    });

    process.stdout.write(`${result.artifactPath ?? result.reportPath}\n`);
    return;
  }

  if (command === "summarize") {
    const result = await summarizeRunArtifacts({
      runDir: values["run-dir"],
      repoRoot,
    });
    process.stdout.write(`${result.reportPath}\n`);
    return;
  }

  throw new Error(`Unsupported command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
