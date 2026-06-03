#!/usr/bin/env node

import { access, copyFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import process from "process";
import { parseArgs } from "util";
import { pathToFileURL } from "url";

import { resolveInitialReviewPolicy } from "./review-scope.mjs";

export const RUN_ROOT_SEGMENTS = ["docs", "tool-output", "code-review"];
export const TRACKED_REVIEW_CONTEXT_DIR_SEGMENTS = ["docs", "run"];
export const EVENTS_FILE_NAME = "events.jsonl";
export const FINDING_MEMORY_FILE_NAME = "finding-memory.jsonl";
export const EVENT_LOG_VERSION = 5;
export const EXTERNAL_REVIEW_BATCH_SIZE = 5;
const REVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

const VERIFICATION_STATUSES = new Set([
  "pass",
  "pass_no_applicable_tests",
  "fail",
]);
const SAME_PROVIDER_RERUN_ELIGIBLE_STATUSES = new Set([
  "clean",
  "issues_found",
]);

const PHASE_LABELS = {
  setup: "Setup",
  external_review: "External Review",
  main_agent_triage: "Main-Agent Triage",
  main_agent_fix: "Main-Agent Fix",
  main_agent_verify: "Main-Agent Verify",
  inner_receive_review: "Inner Receive Review",
  inner_plan: "Inner Plan",
  inner_execute: "Inner Execute",
  inner_request_review: "Inner Request Review",
  deep_review: "Deep Review Checkpoint",
  user_decision: "User Decision",
  final_summary: "Final Summary",
};

function normalizeExternalReviewProvider(provider) {
  const normalizedProvider = String(provider ?? "codex").trim().toLowerCase();
  return "codex";
}

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
  return `code-review-${validateReviewId(reviewId)}.md`;
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

  if (normalizedTitle.includes("receive review")) {
    return "inner_receive_review";
  }

  if (normalizedTitle.includes("request review")) {
    return "inner_request_review";
  }

  if (normalizedTitle.includes("inner plan")) {
    return "inner_plan";
  }

  if (normalizedTitle.includes("inner execute")) {
    return "inner_execute";
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

export async function loadRunState(runDir, repoRoot = process.cwd()) {
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

export function getStepAnchorLabel(step) {
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

function isExternalReviewStepForProvider(step, provider = null) {
  if (step.phase !== "external_review") {
    return false;
  }

  if (!provider) {
    return true;
  }

  return normalizeExternalReviewProvider(step.provider) === provider;
}

function findLatestExternalReviewStep(steps, provider = null) {
  return [...steps]
    .reverse()
    .find((step) => isExternalReviewStepForProvider(step, provider));
}

function findLatestExternalReviewIndex(steps, provider = null) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (isExternalReviewStepForProvider(steps[index], provider)) {
      return index;
    }
  }

  return -1;
}

function hasRecordedInnerPhase(steps, round, phase) {
  return steps.some((step) => step.round === round && step.phase === phase);
}

function hasRequiredInnerLoopForRound(steps, round) {
  return (
    hasRecordedInnerPhase(steps, round, "inner_receive_review") &&
    hasRecordedInnerPhase(steps, round, "inner_request_review")
  );
}

function findUnresolvedIssuesFoundRoundBefore(steps, nextRound) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (
      step.phase === "external_review" &&
      step.status === "issues_found" &&
      Number.isFinite(step.round) &&
      step.round < nextRound &&
      !hasRequiredInnerLoopForRound(steps, step.round)
    ) {
      return step;
    }
  }

  return null;
}

function findLatestIssuesFoundStepForRound(steps, round) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (
      step.phase === "external_review" &&
      step.status === "issues_found" &&
      step.round === round
    ) {
      return step;
    }
  }

  return null;
}

function findExistingExternalReviewAttempt(steps, round, provider) {
  const normalizedProvider = normalizeExternalReviewProvider(provider);
  return steps.find(
    (step) =>
      step.phase === "external_review" &&
      step.round === round &&
      normalizeExternalReviewProvider(step.provider) === normalizedProvider
  );
}

export function findLatestLifecycleBoundary(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (
      step.phase === "final_summary" &&
      ["needs_user_decision", "stopped", "blocked", "completed"].includes(
        step.status
      )
    ) {
      return { index, step };
    }
  }

  return null;
}

export function hasLaterUserDecision(steps, boundaryIndex) {
  if (!Number.isFinite(boundaryIndex) || boundaryIndex < 0) {
    return false;
  }

  return steps.slice(boundaryIndex + 1).some(
    (step) => step.phase === "user_decision" && step.status === "completed"
  );
}

export function assertRunAllowsExternalReview(steps) {
  const boundary = findLatestLifecycleBoundary(steps);
  if (!boundary) {
    return;
  }

  if (hasLaterUserDecision(steps, boundary.index)) {
    return;
  }

  const boundaryLabel = getStepAnchorLabel(boundary.step);
  throw new Error(
    `Cannot start external review while the run is paused after ${boundaryLabel} (${boundary.step.status}). Record a completed user_decision before resuming.`
  );
}

function validateEventProgression(steps, event) {
  const lifecycleBoundary = findLatestLifecycleBoundary(steps);
  if (
    lifecycleBoundary &&
    !hasLaterUserDecision(steps, lifecycleBoundary.index) &&
    !(event.phase === "user_decision" && event.status === "completed")
  ) {
    throw new Error(
      `Cannot record new work while the run is paused after ${getStepAnchorLabel(lifecycleBoundary.step)} (${lifecycleBoundary.step.status}). Record a completed user_decision before resuming.`
    );
  }

  if (
    event.phase === "external_review" &&
    Number.isFinite(event.round) &&
    event.round > 1
  ) {
    const unresolvedRound = findUnresolvedIssuesFoundRoundBefore(steps, event.round);
    if (unresolvedRound) {
      throw new Error(
        `Cannot advance to Round ${event.round} external review before recording inner_receive_review and inner_request_review for Round ${unresolvedRound.round}.`
      );
    }
  }

  if (
    event.phase === "external_review" &&
    event.status === "started" &&
    Number.isFinite(event.round)
  ) {
    const existingAttempt = findExistingExternalReviewAttempt(
      steps,
      event.round,
      event.provider
    );
    if (existingAttempt) {
      throw new Error(
        `Round ${event.round} ${normalizeExternalReviewProvider(event.provider)} external review already has a recorded attempt (${existingAttempt.status}).`
      );
    }
  }

  if (event.phase === "inner_execute" && (event.fixedNow?.length ?? 0) === 0) {
    throw new Error("Cannot record inner_execute without at least one fixNow item.");
  }

  if (["main_agent_fix", "inner_execute"].includes(event.phase)) {
    const targetRound = Number.isFinite(event.round)
      ? event.round
      : findLatestExternalReviewStep(steps)?.round ?? null;
    if (Number.isFinite(targetRound)) {
      const latestIssuesFoundStep = findLatestIssuesFoundStepForRound(steps, targetRound);
      if (
        latestIssuesFoundStep &&
        !hasRecordedInnerPhase(steps, targetRound, "inner_receive_review")
      ) {
        throw new Error(
          `Cannot record ${event.phase} for Round ${targetRound} before inner_receive_review is persisted for that issues_found round.`
        );
      }
    }
  }

  if (event.phase === "final_summary" && event.status === "completed") {
    const latestCodexExternalReviewStep = findLatestExternalReviewStep(steps, "codex");
    if (!latestCodexExternalReviewStep || latestCodexExternalReviewStep.status !== "clean") {
      throw new Error(
        "Cannot record a completed final_summary before the latest Codex external review is clean."
      );
    }
    if (!hasDeepReviewCheckpointAfterCleanReview(steps)) {
      throw new Error(
        "Cannot record a completed final_summary before the deep review checkpoint has been recorded after a clean Codex review."
      );
    }
  }
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
  let sawCleanCodexExternalReview = false;

  for (const step of steps) {
    if (
      step.phase === "external_review" &&
      normalizeExternalReviewProvider(step.provider) === "codex" &&
      step.status === "clean"
    ) {
      sawCleanCodexExternalReview = true;
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

    if (step.phase === "deep_review" && !sawCleanCodexExternalReview) {
      violations.push({
        kind: "deep_review_before_clean_external_review",
        message:
          "A deep review step was recorded before the first clean Codex external review. Deep review can only run after Codex external review returns clean.",
      });
    }
  }

  const latestCodexExternalReviewStep = findLatestExternalReviewStep(steps, "codex");
  const latestCodexExternalReviewIndex = findLatestExternalReviewIndex(
    steps,
    "codex"
  );
  const latestCompletedFinalSummaryIndex = findLatestCompletedFinalSummaryIndex(steps);

  if (latestCompletedFinalSummaryIndex >= 0) {
    if (
      !latestCodexExternalReviewStep ||
      latestCodexExternalReviewStep.status !== "clean"
    ) {
      violations.push({
        kind: "completed_closeout_without_clean_review",
        message:
          "A completed final closeout was recorded before the latest Codex external review reached a clean result.",
      });
    } else if (latestCompletedFinalSummaryIndex < latestCodexExternalReviewIndex) {
      violations.push({
        kind: "completed_closeout_before_latest_clean_review",
        message:
          "A completed final closeout was recorded before the latest clean Codex external review event.",
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

export function stepHasActionableFindings(step) {
  return (
    (step.findings?.length ?? 0) > 0 ||
    (step.fixedNow?.length ?? 0) > 0 ||
    (step.deferred?.length ?? 0) > 0 ||
    (step.separateIssues?.length ?? 0) > 0
  );
}

export function hasDeepReviewCheckpointAfterCleanReview(steps) {
  let sawCleanCodexExternalReview = false;

  for (const step of steps) {
    if (
      step.phase === "external_review" &&
      normalizeExternalReviewProvider(step.provider) === "codex" &&
      step.status === "clean"
    ) {
      sawCleanCodexExternalReview = true;
    }

    if (step.phase === "deep_review" && sawCleanCodexExternalReview) {
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

function normalizeWhitespace(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function uniqueSorted(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))].sort();
}

function normalizeIssueKey(item) {
  const normalizedItem = normalizeWhitespace(
    String(item ?? "")
      .replace(/^\[(p\d|false positive|deferred|separate issue|follow-up)\]\s*/i, "")
      .replace(/^(create github issue|follow-up):\s*/i, "")
  ).toLowerCase();

  return normalizedItem || null;
}

function classifyFindingClaim(text) {
  const normalized = normalizeIssueKey(text) ?? "";
  if (!normalized) {
    return "general";
  }
  if (/\b(test|coverage|assert|spec)\b/.test(normalized)) {
    return "test_gap";
  }
  if (/\b(null|undefined|empty|boundary|edge[- ]case|optional)\b/.test(normalized)) {
    return "boundary_handling";
  }
  if (/\b(contract|schema|interface|api|caller|consumer|default)\b/.test(normalized)) {
    return "contract_blast_radius";
  }
  if (/\b(retry|timeout|stall|race|async|concurrent|partial[- ]failure)\b/.test(normalized)) {
    return "runtime_correctness";
  }
  if (/\b(auth|tenant|permission|secret|token|path|query|sql|html|xss|ssrf)\b/.test(normalized)) {
    return "security_runtime_safety";
  }
  if (/\b(policy|design|intentional|expected|by design)\b/.test(normalized)) {
    return "design_policy";
  }
  return "general";
}

function extractAffectedFiles(text) {
  const source = String(text ?? "");
  const matches = [];
  const patterns = [
    /`((?:[^`\s)]+\/)+[^`\s)]+)`/g,
    /\(((?:[^()\s]+\/)+[^()\s]+)\)/g,
    /\b((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      matches.push(match[1]);
    }
  }

  return uniqueSorted(matches.map(normalizeRepoRelativePath));
}

function extractAffectedFunctions(text) {
  const source = String(text ?? "");
  const matches = [];
  const patterns = [/`([A-Za-z_$][\w$]*)`/g, /\b([A-Za-z_$][\w$]*)\s*\(/g];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const candidate = match[1];
      if (/^[A-Z0-9_]+$/.test(candidate)) {
        continue;
      }
      matches.push(candidate);
    }
  }

  return uniqueSorted(matches);
}

function normalizeFindingDetails(finding) {
  return {
    normalizedKey: normalizeIssueKey(finding),
    claimClass: classifyFindingClaim(finding),
    affectedFiles: extractAffectedFiles(finding),
    affectedFunctions: extractAffectedFunctions(finding),
  };
}

function hasOverlap(left = [], right = []) {
  if (left.length === 0 || right.length === 0) {
    return false;
  }

  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function buildRepeatMatch(currentFinding, previousFinding) {
  const currentDetails = normalizeFindingDetails(currentFinding);
  const previousDetails = normalizeFindingDetails(previousFinding);
  const exactKeyMatch =
    currentDetails.normalizedKey &&
    currentDetails.normalizedKey === previousDetails.normalizedKey;
  const semanticMatch =
    currentDetails.claimClass === previousDetails.claimClass &&
    (hasOverlap(currentDetails.affectedFiles, previousDetails.affectedFiles) ||
      hasOverlap(
        currentDetails.affectedFunctions,
        previousDetails.affectedFunctions
      ));

  return {
    currentDetails,
    previousDetails,
    exactKeyMatch,
    semanticMatch,
    matched: exactKeyMatch || semanticMatch,
  };
}

function normalizeTriageBucket(triageBucket) {
  const normalized = String(triageBucket ?? "").trim().toLowerCase();
  if (normalized === "accepted_fix") {
    return "accepted_fix";
  }
  if (normalized === "pending_review") {
    return "pending_review";
  }
  if (normalized === "false_positive") {
    return "false_positive";
  }
  if (normalized === "separate_issue") {
    return "separate_issue";
  }
  return "deferred";
}

function createFindingMemoryRecord({
  finding,
  step,
  triageBucket,
  status,
}) {
  const details = normalizeFindingDetails(finding);
  if (!details.normalizedKey) {
    return null;
  }

  return {
    normalizedKey: details.normalizedKey,
    claimClass: details.claimClass,
    affectedFiles: details.affectedFiles,
    affectedFunctions: details.affectedFunctions,
    triageBucket: normalizeTriageBucket(triageBucket),
    reason: normalizeWhitespace(step.result ?? step.followUp ?? ""),
    round: step.round ?? null,
    provider:
      step.provider != null
        ? normalizeExternalReviewProvider(step.provider)
        : null,
    sourceArtifactPath: step.artifactPath ?? null,
    sourceFinding: finding,
    status,
  };
}

function resolveFindingMemoryRecord(recordsByKey, finding) {
  const normalizedKey = normalizeIssueKey(finding);
  if (!normalizedKey || !recordsByKey.has(normalizedKey)) {
    return;
  }

  const existing = recordsByKey.get(normalizedKey);
  recordsByKey.set(normalizedKey, {
    ...existing,
    status: "resolved",
  });
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
      detail: step.result ?? step.notes?.[0] ?? item,
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
    if (step.phase === "main_agent_fix" || step.phase === "inner_execute") {
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
  const latestCodexExternalReviewStep = findLatestExternalReviewStep(steps, "codex");
  const latestCodexExternalReviewIndex = findLatestExternalReviewIndex(
    steps,
    "codex"
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
    (latestStep?.status ?? "") === "blocked" ||
    (latestStep?.status ?? "") === "failed" ||
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

  if (
    !latestCodexExternalReviewStep ||
    latestCodexExternalReviewStep.status !== "clean"
  ) {
    return "in_progress";
  }

  if (hasPostCleanExternalReviewWork(steps, latestCodexExternalReviewIndex)) {
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

function findLatestTriageForRound(steps, round, endIndex = steps.length) {
  for (let index = Math.min(endIndex, steps.length) - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.phase === "main_agent_triage" && step.round === round) {
      return step;
    }
  }

  return null;
}

function findPreviousExternalReviewForProvider(
  steps,
  provider,
  currentRound = Number.POSITIVE_INFINITY,
  eligibleStatuses = null
) {
  const normalizedProvider = normalizeExternalReviewProvider(provider);
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (
      step.phase === "external_review" &&
      normalizeExternalReviewProvider(step.provider) === normalizedProvider &&
      step.status !== "started" &&
      (!eligibleStatuses || eligibleStatuses.has(step.status)) &&
      (step.round ?? 0) < currentRound
    ) {
      return {
        index,
        step,
      };
    }
  }

  return null;
}

export function analyzeSameProviderRerun({
  steps,
  provider,
  currentRound = Number.POSITIVE_INFINITY,
  reviewInputFingerprint = null,
}) {
  const previous = findPreviousExternalReviewForProvider(
    steps,
    provider,
    currentRound,
    SAME_PROVIDER_RERUN_ELIGIBLE_STATUSES
  );
  if (!previous) {
    return {
      sameProviderRerunBlocked: false,
      previousRound: null,
      previousFixNowCount: null,
      hadMainAgentFixSincePreviousRound: false,
      fingerprintChanged: null,
    };
  }

  const previousTriage = findLatestTriageForRound(
    steps,
    previous.step.round,
    steps.length
  );
  const previousFixNowCount = previousTriage?.fixedNow?.length ?? 0;
  const hadMainAgentFixSincePreviousRound = steps
    .slice(previous.index + 1)
    .some((step) => step.phase === "main_agent_fix");
  const fingerprintChanged =
    previous.step.reviewInputFingerprint && reviewInputFingerprint
      ? previous.step.reviewInputFingerprint !== reviewInputFingerprint
      : null;
  const sameProviderRerunBlocked =
    previousFixNowCount === 0 &&
    hadMainAgentFixSincePreviousRound === false &&
    fingerprintChanged === false;

  return {
    sameProviderRerunBlocked,
    previousRound: previous.step.round ?? null,
    previousFixNowCount,
    hadMainAgentFixSincePreviousRound,
    fingerprintChanged,
    previousReviewInputFingerprint: previous.step.reviewInputFingerprint ?? null,
    previousReviewedFiles: previous.step.reviewedFiles ?? [],
  };
}

export function analyzeRepeatedFindings({
  steps,
  provider,
  currentRound = Number.POSITIVE_INFINITY,
  reviewInputFingerprint = null,
  reviewedFiles = [],
  findings = [],
}) {
  const previous = findPreviousExternalReviewForProvider(
    steps,
    provider,
    currentRound
  );
  if (!previous || findings.length === 0) {
    return {
      repeatClassification: "none",
      repeatOverlap: null,
      repeatedFindingKeys: [],
    };
  }

  const fingerprintChanged =
    previous.step.reviewInputFingerprint && reviewInputFingerprint
      ? previous.step.reviewInputFingerprint !== reviewInputFingerprint
      : null;
  const normalizedReviewedFiles = uniqueSorted(reviewedFiles);
  const repeatedFindingKeys = [];
  let matchedCount = 0;

  for (const finding of findings) {
    const match = (previous.step.findings ?? [])
      .map((previousFinding) => buildRepeatMatch(finding, previousFinding))
      .find((candidate) => candidate.matched);
    if (!match) {
      continue;
    }

    const touchesChangedFiles =
      fingerprintChanged === true &&
      hasOverlap(match.currentDetails.affectedFiles, normalizedReviewedFiles);
    if (touchesChangedFiles) {
      continue;
    }

    matchedCount += 1;
    if (match.currentDetails.normalizedKey) {
      repeatedFindingKeys.push(match.currentDetails.normalizedKey);
    }
  }

  if (matchedCount === 0) {
    return {
      repeatClassification: "none",
      repeatOverlap: {
        matchedCount: 0,
        totalCurrentFindings: findings.length,
        ratio: 0,
      },
      repeatedFindingKeys: [],
    };
  }

  return {
    repeatClassification: "repetitive",
    repeatOverlap: {
      matchedCount,
      totalCurrentFindings: findings.length,
      ratio: matchedCount / Math.max(findings.length, 1),
    },
    repeatedFindingKeys: uniqueSorted(repeatedFindingKeys),
  };
}

export function buildFindingMemoryRecords(steps) {
  const recordsByKey = new Map();

  for (const step of steps) {
    if (
      step.phase === "main_agent_triage" ||
      step.phase === "deep_review" ||
      step.phase === "inner_receive_review"
    ) {
      const triageBuckets = [
        { key: "deferred", triageBucket: "deferred" },
        { key: "falsePositives", triageBucket: "false_positive" },
        { key: "separateIssues", triageBucket: "separate_issue" },
      ];

      for (const bucket of triageBuckets) {
        for (const finding of step[bucket.key] ?? []) {
          const record = createFindingMemoryRecord({
            finding,
            step,
            triageBucket: bucket.triageBucket,
            status: "active",
          });
          if (!record) {
            continue;
          }

          recordsByKey.set(record.normalizedKey, record);
        }
      }
    }

    if (step.phase === "inner_receive_review") {
      for (const finding of step.findings ?? []) {
        const record = createFindingMemoryRecord({
          finding,
          step,
          triageBucket: "accepted_fix",
          status: "active",
        });
        if (!record) {
          continue;
        }

        recordsByKey.set(record.normalizedKey, record);
      }
    }

    if (step.phase === "inner_request_review") {
      for (const finding of step.findings ?? []) {
        const record = createFindingMemoryRecord({
          finding,
          step,
          triageBucket: "pending_review",
          status: "active",
        });
        if (!record) {
          continue;
        }

        recordsByKey.set(record.normalizedKey, record);
      }
    }

    if (step.phase === "main_agent_fix" || step.phase === "inner_execute") {
      for (const finding of step.fixedNow ?? []) {
        resolveFindingMemoryRecord(recordsByKey, finding);
      }
    }
  }

  return [...recordsByKey.values()].sort((left, right) => {
    if ((left.round ?? 0) !== (right.round ?? 0)) {
      return (left.round ?? 0) - (right.round ?? 0);
    }
    return left.normalizedKey.localeCompare(right.normalizedKey);
  });
}

export function isInnerAdapterPhase(phase) {
  return [
    "inner_receive_review",
    "inner_plan",
    "inner_execute",
    "inner_request_review",
  ].includes(phase);
}

function parseInnerReviewCounts(step) {
  const explicit = [step.criticalCount, step.importantCount, step.minorCount].map((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });
  if (explicit.every((value) => value !== null)) {
    return explicit;
  }

  const match = String(step.result ?? "").match(/(\d+)\s+critical,\s*(\d+)\s+important,\s*(\d+)\s+minor/i);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function summarizeInnerAdapterFlow(steps) {
  const innerSteps = steps.filter((step) => isInnerAdapterPhase(step.phase));
  if (innerSteps.length === 0) {
    return null;
  }

  const fragments = [];
  if (innerSteps.some((step) => step.phase === "inner_receive_review")) {
    fragments.push("receive");
  }
  if (innerSteps.some((step) => step.phase === "inner_plan")) {
    fragments.push("plan");
  }
  if (innerSteps.some((step) => step.phase === "inner_execute")) {
    const executeStep = innerSteps.find((step) => step.phase === "inner_execute");
    fragments.push(executeStep?.strategy === "direct-fix" ? "direct-fix" : "execute");
  }
  const requestStep = [...innerSteps].reverse().find((step) => step.phase === "inner_request_review");
  if (requestStep) {
    const counts = parseInnerReviewCounts(requestStep);
    fragments.push(counts ? `request(${counts.join("/")})` : "request");
  }

  return fragments.length > 0 ? `adapter: ${fragments.join(" -> ")}` : null;
}

export function buildPriorReviewedContext(steps) {
  const records = buildFindingMemoryRecords(steps).filter(
    (record) =>
      record.status !== "resolved" &&
      (record.triageBucket === "deferred" ||
        record.triageBucket === "false_positive")
  );

  return {
    records,
  };
}

function buildRoundSummary(steps) {
  const innerAdapterOutcome = summarizeInnerAdapterFlow(steps);
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
    ["external_review", "main_agent_triage", "main_agent_fix", "inner_execute", "main_agent_verify"].map(
      (phase) => {
        const phaseSteps = steps.filter((step) => step.phase === phase);
        const totalPhaseDuration = sumStepDurations(phaseSteps);
        return [phase, totalPhaseDuration === null ? "n/a" : formatDuration(totalPhaseDuration)];
      }
    )
  );
  const totalFixDuration = sumStepDurations(
    steps.filter((step) => step.phase === "main_agent_fix" || step.phase === "inner_execute")
  );

  return {
    totalDuration: totalDuration ?? "n/a",
    reviewDuration: durationsByPhase.external_review,
    triageDuration: durationsByPhase.main_agent_triage,
    mainAgentFixDuration: durationsByPhase.main_agent_fix,
    innerExecuteDuration: durationsByPhase.inner_execute,
    fixDuration: totalFixDuration === null ? "n/a" : formatDuration(totalFixDuration),
    verifyDuration: durationsByPhase.main_agent_verify,
    findingsCount: countItems(steps, "findings"),
    fixedCount: countItemsForPhases(steps, "fixedNow", [
      "main_agent_fix",
      "inner_execute",
    ]),
    deferredCount: countItems(steps, "deferred"),
    separateIssueCount: countItems(steps, "separateIssues"),
    falsePositiveCount: countItems(steps, "falsePositives"),
    verificationStatus: latestVerifyStep?.verificationStatus ?? "not_run",
    outcome:
      innerAdapterOutcome ??
      steps[steps.length - 1]?.result ??
      steps[steps.length - 1]?.status ??
      "No result recorded.",
  };
}

function formatHeaderStatus(status) {
  const normalizedStatus = String(status ?? "in_progress").trim();
  const mapping = {
    ready: "✅ ready",
    ready_with_follow_ups: "✅ ready with follow-ups",
    needs_user_decision: "⚠️ needs decision",
    blocked: "⛔ blocked",
    stopped: "⏸ stopped",
    in_progress: "🔄 in progress",
  };

  return mapping[normalizedStatus] ?? `🔄 ${normalizedStatus}`;
}

function formatVerdictStatus(status) {
  const normalizedStatus = String(status ?? "not_run").trim();
  const mapping = {
    clean: "✅ clean",
    issues_found: "⚠️ issues found",
    blocked: "⛔ blocked",
    failed: "⛔ failed",
    stalled: "⚠️ stalled",
    started: "🔄 started",
    completed: "✅ completed",
    not_run: "➖ not run",
  };

  return mapping[normalizedStatus] ?? `➖ ${normalizedStatus}`;
}

function formatVerifyStatus(status) {
  const normalizedStatus = String(status ?? "not_run").trim();
  const mapping = {
    pass: "✅ pass",
    pass_no_applicable_tests: "➖ n/a",
    fail: "⛔ fail",
    not_run: "➖ not run",
  };

  return mapping[normalizedStatus] ?? `➖ ${normalizedStatus}`;
}

function formatDeepReviewStatus(ran) {
  return ran ? "✅ ran" : "➖ not run";
}

function escapeTableCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim();
}

function sentenceCaseOption(value) {
  const trimmedValue = String(value ?? "").trim();
  if (!trimmedValue) {
    return trimmedValue;
  }

  return trimmedValue.charAt(0).toUpperCase() + trimmedValue.slice(1);
}

function parseMarkdownHeadingSection(details, heading) {
  const normalizedDetails = String(details ?? "").trim();
  if (!normalizedDetails) {
    return null;
  }

  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalizedDetails.match(
    new RegExp(`^## ${escapedHeading}\\n([\\s\\S]*?)(?=^##\\s|\\Z)`, "m")
  );

  return match?.[1]?.trim() ?? null;
}

function parseMarkdownListItems(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, "").trim())
    .filter(Boolean);
}

function buildOptionEffect(option) {
  const normalizedOption = String(option ?? "").trim().toLowerCase();

  if (!normalizedOption) {
    return "";
  }

  if (normalizedOption.startsWith("continue")) {
    return "Continue the loop with another review batch.";
  }

  if (normalizedOption.includes("test matrix")) {
    return "Pause review and expand coverage before resuming.";
  }

  if (normalizedOption.includes("clarify requirements")) {
    return "Pause code changes and lock requirements or invariants first.";
  }

  if (normalizedOption.includes("design/reset")) {
    return "Pause the loop and reset the unstable subsystem design.";
  }

  if (normalizedOption.includes("stop as-is")) {
    return "Close this run and keep the current report as evidence.";
  }

  return sentenceCaseOption(option);
}

function parseDecisionOptions(details) {
  const recommended = parseMarkdownHeadingSection(details, "Recommended Next Step");
  const alternatives = parseMarkdownListItems(
    parseMarkdownHeadingSection(details, "Alternative Next Steps")
  );
  const combined = [recommended, ...alternatives]
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);

  return [...new Set(combined)].map((choice) => ({
    choice,
    effect: buildOptionEffect(choice),
  }));
}

function summarizeDecisionText(latestFinalSummaryStep, suggestedFinalStatus) {
  const resultText = String(latestFinalSummaryStep?.result ?? "").trim();
  const recommendedNextStep = parseMarkdownHeadingSection(
    latestFinalSummaryStep?.details,
    "Recommended Next Step"
  );

  if (suggestedFinalStatus === "ready" || suggestedFinalStatus === "ready_with_follow_ups") {
    return resultText || "✅ Ready to merge.";
  }

  if (suggestedFinalStatus === "needs_user_decision") {
    const recommendedText = recommendedNextStep
      ? ` Recommended next step: ${recommendedNextStep}.`
      : "";
    return `${resultText || "⚠️ A user decision is required before the loop can continue."}${recommendedText}`;
  }

  if (suggestedFinalStatus === "blocked") {
    return resultText || "⛔ The run is blocked and needs intervention.";
  }

  if (suggestedFinalStatus === "stopped") {
    return resultText || "⏸ The run stopped before final closeout.";
  }

  return resultText || "🔄 The run is still in progress.";
}

function limitTableRows(rows, maxRows, overflowLabel = "Earlier rounds") {
  if (rows.length <= maxRows) {
    return rows;
  }

  return [
    ...rows.slice(0, maxRows),
    {
      round: overflowLabel,
      item: `${rows.length - maxRows} more items`,
      detail: "See events.jsonl",
    },
  ];
}

function collectLatestFixedRecords(steps) {
  const fixedLedger = new Map();

  for (const step of steps) {
    if (step.phase !== "main_agent_fix" && step.phase !== "inner_execute") {
      continue;
    }

    for (const item of step.fixedNow ?? []) {
      const normalizedItem = normalizeIssueKey(item);
      if (!normalizedItem) {
        continue;
      }

      fixedLedger.set(normalizedItem, {
        item,
        round: step.round ?? null,
        detail: step.result ?? "Fixed in this round.",
      });
    }
  }

  return [...fixedLedger.values()].sort((left, right) => {
    const leftRound = left.round ?? Number.POSITIVE_INFINITY;
    const rightRound = right.round ?? Number.POSITIVE_INFINITY;
    if (leftRound !== rightRound) {
      return leftRound - rightRound;
    }

    return left.item.localeCompare(right.item);
  });
}

function formatRepeatOverlap(overlap) {
  if (!overlap || !Number.isFinite(overlap.matchedCount)) {
    return "n/a";
  }

  const ratioPercent = Number.isFinite(overlap.ratio)
    ? `${Math.round(overlap.ratio * 100)}%`
    : "n/a";
  return `${overlap.matchedCount}/${overlap.totalCurrentFindings} (${ratioPercent})`;
}

function classifyLatestExternalReview(step, steps) {
  if (!step) {
    return {
      summaryLines: ["- None"],
      buckets: {
        freshActionable: [],
        repeatedRejected: [],
        designPolicy: [],
        providerFailure: [],
      },
    };
  }

  const priorReviewed = buildPriorReviewedContext(steps).records;
  const rejectedKeys = new Set(
    priorReviewed
      .filter((record) => record.triageBucket === "false_positive")
      .map((record) => record.normalizedKey)
  );
  const deferredKeys = new Set(
    priorReviewed
      .filter((record) => record.triageBucket === "deferred")
      .map((record) => record.normalizedKey)
  );
  const buckets = {
    freshActionable: [],
    repeatedRejected: [],
    designPolicy: [],
    providerFailure: [],
  };

  if (step.failureClassification || step.failureSubtype) {
    buckets.providerFailure.push(
      step.failureSubtype ?? step.failureClassification ?? "provider_error"
    );
  }

  for (const finding of step.findings ?? []) {
    const normalizedKey = normalizeIssueKey(finding);
    if (normalizedKey && rejectedKeys.has(normalizedKey)) {
      buckets.repeatedRejected.push(finding);
      continue;
    }
    if (
      step.repeatClassification === "repetitive" &&
      normalizedKey &&
      (step.repeatedFindingKeys ?? []).includes(normalizedKey)
    ) {
      buckets.designPolicy.push(finding);
      continue;
    }
    if (normalizedKey && deferredKeys.has(normalizedKey)) {
      buckets.designPolicy.push(finding);
      continue;
    }
    buckets.freshActionable.push(finding);
  }

  return {
    buckets,
  };
}

function collectCurrentBlockers(
  steps,
  workflowViolations,
  latestExternalReviewStep = null,
  latestExternalReviewClassification = null
) {
  const latestRound = getLatestRoundNumber(steps);
  const latestBatchWindow = getBatchWindow(latestRound || 1);
  const blockers = [];
  const seenBlockers = new Set();

  function pushBlocker(blocker) {
    const normalized = {
      round: blocker?.round ?? "Run",
      item: String(blocker?.item ?? "").trim(),
      detail: String(blocker?.detail ?? "").trim(),
    };
    if (!normalized.item || !normalized.detail) {
      return;
    }

    const key = `${normalized.round}|${normalized.item}|${normalized.detail}`;
    if (seenBlockers.has(key)) {
      return;
    }

    seenBlockers.add(key);
    blockers.push(normalized);
  }

  for (const violation of workflowViolations) {
    pushBlocker({
      round: violation.round ?? "Run",
      item: "Workflow violation",
      detail: violation.message,
    });
  }

  for (const step of steps) {
    if (
      step.phase !== "external_review" ||
      !["blocked", "stalled", "failed"].includes(step.status ?? "") ||
      !Number.isFinite(step.round) ||
      step.round < latestBatchWindow.start ||
      step.round > latestBatchWindow.end
    ) {
      continue;
    }

    pushBlocker({
      round: step.round,
      item: `${normalizeExternalReviewProvider(step.provider)} external review`,
      detail: step.result ?? `Review ended ${step.status ?? "without a verdict"}.`,
    });
  }

  if (latestExternalReviewStep && latestExternalReviewClassification) {
    const providerLabel = normalizeExternalReviewProvider(
      latestExternalReviewStep.provider
    );
    const round = latestExternalReviewStep.round ?? latestRound ?? "Latest";
    const latestExternalReviewIndex = findLatestExternalReviewIndex(steps);
    const laterResolutionKeys = new Set();

    for (const step of steps.slice(latestExternalReviewIndex + 1)) {
      for (const collection of [
        step.fixedNow,
        step.falsePositives,
        step.deferred,
        step.separateIssues,
      ]) {
        for (const item of collection ?? []) {
          const normalizedKey = normalizeIssueKey(item);
          if (normalizedKey) {
            laterResolutionKeys.add(normalizedKey);
          }
        }
      }
    }

    const isStillUnresolved = (finding) => {
      const normalizedKey = normalizeIssueKey(finding);
      return !normalizedKey || !laterResolutionKeys.has(normalizedKey);
    };

    for (const finding of latestExternalReviewClassification.buckets
      .freshActionable ?? []) {
      if (!isStillUnresolved(finding)) {
        continue;
      }
      pushBlocker({
        round,
        item: finding,
        detail: `Fresh actionable finding from the latest ${providerLabel} review.`,
      });
    }

    for (const finding of latestExternalReviewClassification.buckets
      .repeatedRejected ?? []) {
      if (!isStillUnresolved(finding)) {
        continue;
      }
      pushBlocker({
        round,
        item: finding,
        detail:
          "Repeated previously rejected finding from earlier rounds; avoid churn without new evidence.",
      });
    }

    for (const finding of latestExternalReviewClassification.buckets
      .designPolicy ?? []) {
      if (!isStillUnresolved(finding)) {
        continue;
      }
      pushBlocker({
        round,
        item: finding,
        detail:
          "Design or scope disagreement already represented in prior-reviewed context.",
      });
    }

    for (const failure of latestExternalReviewClassification.buckets
      .providerFailure ?? []) {
      pushBlocker({
        round,
        item: `${providerLabel} runtime`,
        detail: `Provider/runtime failure: ${failure}.`,
      });
    }

    if (latestExternalReviewStep.sameProviderRerunBlocked) {
      pushBlocker({
        round,
        item: `${providerLabel} rerun gate`,
        detail:
          "Unchanged review input after a no-fix Codex round; stop for a user decision.",
      });
    }
  }

  return blockers;
}

function renderItemTable(title, detailHeader, rows) {
  if (!rows.length) {
    return [];
  }

  const lines = [
    `### ${title}`,
    "",
    `| Round | Item | ${detailHeader} |`,
    "| --- | --- | --- |",
  ];

  for (const row of rows) {
    lines.push(
      `| ${escapeTableCell(row.round ?? "—")} | ${escapeTableCell(row.item)} | ${escapeTableCell(row.detail)} |`
    );
  }

  lines.push("");
  return lines;
}

function renderOptionsTable(options) {
  if (!options.length) {
    return [];
  }

  const lines = [
    "## Options",
    "",
    "| Choice | Effect |",
    "| --- | --- |",
  ];

  for (const option of options) {
    lines.push(
      `| ${escapeTableCell(sentenceCaseOption(option.choice))} | ${escapeTableCell(option.effect)} |`
    );
  }

  lines.push("");
  return lines;
}

export function renderTrackedReviewContextReport(metadata, steps) {
  const latestExternalReviewStep = findLatestExternalReviewStep(steps);
  const latestCodexExternalReviewStep = findLatestExternalReviewStep(
    steps,
    "codex"
  );
  const latestFinalSummaryStep = findLatestFinalSummaryStep(steps);
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
  const latestExternalReviewClassification = classifyLatestExternalReview(
    latestExternalReviewStep,
    steps
  );
  const endedAt = getRunEndedAt(steps) ?? metadata.startedAt;
  const totalDuration =
    formatDuration(getRangeDuration(metadata.startedAt, endedAt)) ?? "n/a";
  const workflowViolations = collectWorkflowViolations(steps);
  const userDecisionSteps = steps.filter((step) => step.phase === "user_decision");
  const fixedRecords = collectLatestFixedRecords(steps);
  const currentBlockers = collectCurrentBlockers(
    steps,
    workflowViolations,
    latestExternalReviewStep,
    latestExternalReviewClassification
  );
  const decisionOptions =
    suggestedFinalStatus === "needs_user_decision" || suggestedFinalStatus === "blocked"
      ? parseDecisionOptions(latestFinalSummaryStep?.details)
      : [];
  const latestRelevantExternalArtifact = latestExternalReviewStep?.artifactPath
    ? [latestExternalReviewStep.artifactPath]
    : [];
  const blockingArtifacts = currentBlockers.length
    ? [...new Set(
        steps
          .filter(
            (step) =>
              step.phase === "external_review" &&
              ["blocked", "stalled", "failed"].includes(step.status ?? "") &&
              step.artifactPath
          )
          .map((step) => step.artifactPath)
      )]
    : [];
  const evidenceArtifacts = [
    normalizeRepoRelativePath(path.join(metadata.runDirRelative, EVENTS_FILE_NAME)),
    ...latestRelevantExternalArtifact,
    ...blockingArtifacts,
    ...(deepReviewSteps.length > 0
      ? [normalizeRepoRelativePath(path.join(metadata.runDirRelative, "deep-review/"))]
      : []),
  ];

  const importantItemLines = [
    "## Important Items",
    "",
    ...renderItemTable(
      "Fixed Now",
      "Resolution",
      limitTableRows(fixedRecords, 6)
    ),
    ...renderItemTable(
      "Rejected Findings",
      "Reason",
      limitTableRows(
        falsePositiveFollowUps.map((record) => ({
          round: record.round ?? record.label,
          item: record.item,
          detail: record.detail,
        })),
        6
      )
    ),
    ...renderItemTable(
      "Deferred",
      "Reason",
      limitTableRows(
        deferredFollowUps.map((record) => ({
          round: record.round ?? record.label,
          item: record.item,
          detail: record.detail,
        })),
        6
      )
    ),
    ...renderItemTable(
      "Separate Issues",
      "Why separate",
      limitTableRows(
        separateIssueFollowUps.map((record) => ({
          round: record.round ?? record.label,
          item: record.item,
          detail: record.detail,
        })),
        6
      )
    ),
    ...renderItemTable(
      "Current Blockers",
      "Reason",
      limitTableRows(currentBlockers, 6)
    ),
  ];

  if (importantItemLines.at(-1) === "") {
    while (importantItemLines.at(-1) === "") {
      importantItemLines.pop();
    }
  }
  if (importantItemLines.length === 1) {
    importantItemLines.push("", "- None");
  }

  const roundSummaryLines = [
    "## Round Summary",
    "",
    "| Round | Provider | Verdict | Findings | Fixed | Rejected | Verify | Outcome |",
    "| --- | --- | --- | ---: | ---: | ---: | --- | --- |",
    ...(roundGroups.length > 0
      ? roundGroups.map((group) => {
          const summary = buildRoundSummary(group.steps);
          const latestRoundExternalReviewStep = [...group.steps]
            .reverse()
            .find((step) => step.phase === "external_review");

          return `| ${group.round} | ${escapeTableCell(
            latestRoundExternalReviewStep
              ? normalizeExternalReviewProvider(latestRoundExternalReviewStep.provider)
              : "—"
          )} | ${escapeTableCell(
            formatVerdictStatus(latestRoundExternalReviewStep?.status ?? "not_run")
          )} | ${summary.findingsCount} | ${summary.fixedCount} | ${summary.falsePositiveCount} | ${escapeTableCell(
            formatVerifyStatus(summary.verificationStatus)
          )} | ${escapeTableCell(summary.outcome)} |`;
        })
      : ["| — | — | ➖ not run | 0 | 0 | 0 | ➖ not run | No rounds recorded yet. |"]),
    "",
  ];
  const latestEffectiveReviewTarget =
    latestExternalReviewStep?.effectiveReviewTarget ??
    metadata.effectiveReviewTarget ??
    null;

  const reviewScopeLines = [
    "## Review Scope",
    "",
    `Review mode: \`${metadata.reviewMode ?? "legacy"}\``,
    `Target: \`${metadata.reviewTarget ?? "not recorded"}\``,
    ...(metadata.baseRef ? [`Base ref: \`${metadata.baseRef}\``] : []),
    ...(latestExternalReviewStep?.mergeBaseCommit
      ? [`Merge base: \`${latestExternalReviewStep.mergeBaseCommit}\``]
      : []),
    ...(latestEffectiveReviewTarget &&
    latestEffectiveReviewTarget !== metadata.reviewTarget
      ? [`Effective target: \`${latestEffectiveReviewTarget}\``]
      : []),
    "",
  ];

  return [
    "# code-review Report",
    "",
    `\`${metadata.reviewId}\` | ${formatHeaderStatus(suggestedFinalStatus)} | ${roundGroups.length} ${roundGroups.length === 1 ? "round" : "rounds"} | ${normalizeExternalReviewProvider(latestExternalReviewStep?.provider)}: ${formatVerdictStatus(latestExternalReviewStep?.status ?? "not_run")} | deep review: ${formatDeepReviewStatus(deepReviewRan)} | verify: ${formatVerifyStatus(latestVerificationStep?.verificationStatus ?? "not_run")} | ${totalDuration}`,
    `${fixedRecords.length} fixed | ${falsePositiveFollowUps.length} rejected | ${deferredFollowUps.length} deferred | ${separateIssueFollowUps.length} separate | ${userDecisionSteps.length} ${userDecisionSteps.length === 1 ? "decision" : "decisions"}`,
    "",
    ...reviewScopeLines,
    ...importantItemLines,
    "",
    ...roundSummaryLines,
    ...(suggestedFinalStatus === "needs_user_decision"
      ? ["## Decision Needed", "", summarizeDecisionText(latestFinalSummaryStep, suggestedFinalStatus), ""]
      : ["## Next Step", "", summarizeDecisionText(latestFinalSummaryStep, suggestedFinalStatus), ""]),
    ...renderOptionsTable(decisionOptions),
    "## Evidence",
    "",
    ...(evidenceArtifacts.length > 0
      ? evidenceArtifacts.map((artifact) => `- \`${artifact}\``)
      : ["- None"]),
    "",
  ].join("\n");
}

async function writeGeneratedReports({ absoluteRunDir, repoRoot, metadata, steps }) {
  const trackedReviewContextPath = resolveTrackedReviewContextPath(
    metadata.reviewId,
    repoRoot
  );
  const findingMemoryPath = path.join(absoluteRunDir, FINDING_MEMORY_FILE_NAME);
  const findingMemoryRecords = buildFindingMemoryRecords(steps);
  await mkdir(path.dirname(trackedReviewContextPath), { recursive: true });
  await writeFile(
    trackedReviewContextPath,
    renderTrackedReviewContextReport(metadata, steps),
    "utf8"
  );
  await writeFile(
    findingMemoryPath,
    findingMemoryRecords.length > 0
      ? `${findingMemoryRecords.map((record) => JSON.stringify(record)).join("\n")}\n`
      : "",
    "utf8"
  );

  return {
    reportPath: toRepoRelativePath(trackedReviewContextPath, repoRoot),
    trackedReviewContextPath: toRepoRelativePath(trackedReviewContextPath, repoRoot),
    findingMemoryPath: toRepoRelativePath(findingMemoryPath, repoRoot),
  };
}

export async function initRunArtifacts({
  reviewId,
  repoRoot = process.cwd(),
  startedAt = new Date().toISOString(),
  reviewMode = null,
  reviewTarget = null,
  baseRef = null,
  effectiveReviewTarget = null,
}) {
  const normalizedReviewId = validateReviewId(reviewId);
  const resolvedInitialPolicy = await resolveInitialReviewPolicy({
    repoRoot,
    reviewMode,
    reviewTarget,
    baseRef,
  });
  const normalizedReviewMode = resolvedInitialPolicy.reviewMode;
  const normalizedReviewTarget = resolvedInitialPolicy.reviewTarget;
  const normalizedBaseRef = resolvedInitialPolicy.baseRef;
  const normalizedEffectiveReviewTarget =
    effectiveReviewTarget ?? resolvedInitialPolicy.effectiveReviewTarget;
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
    reviewMode: normalizedReviewMode,
    reviewTarget: normalizedReviewTarget,
    baseRef: normalizedBaseRef,
    effectiveReviewTarget: normalizedEffectiveReviewTarget,
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
  provider,
  providerIndex,
  handoffReason,
  innerCycle,
  cycleSource,
  adapter,
  strategy,
  reviewMode,
  reviewTarget,
  baseRef,
  mergeBaseCommit,
  effectiveReviewTarget,
  snapshotCommit,
  snapshotRef,
  criticalCount,
  importantCount,
  minorCount,
  reviewInputFingerprint,
  reviewedFiles = [],
  sameProviderRerunBlocked,
  reviewInputFingerprintChanged,
  repeatClassification,
  repeatOverlap,
  repeatedFindingKeys = [],
  failureClassification,
  failureSubtype,
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
    provider: resolvedPhase === "external_review" ? normalizeExternalReviewProvider(provider) : undefined,
    providerIndex:
      resolvedPhase === "external_review" && Number.isFinite(Number(providerIndex))
        ? Number(providerIndex)
        : undefined,
    handoffReason,
    innerCycle: isInnerAdapterPhase(resolvedPhase) ? String(innerCycle ?? "").trim() || undefined : undefined,
    cycleSource: isInnerAdapterPhase(resolvedPhase) ? String(cycleSource ?? "").trim() || undefined : undefined,
    adapter: isInnerAdapterPhase(resolvedPhase) ? String(adapter ?? "").trim() || undefined : undefined,
    strategy: isInnerAdapterPhase(resolvedPhase) ? String(strategy ?? "").trim() || undefined : undefined,
    reviewMode:
      resolvedPhase === "external_review" && reviewMode
        ? String(reviewMode).trim()
        : undefined,
    reviewTarget:
      resolvedPhase === "external_review" && reviewTarget
        ? normalizeWhitespace(reviewTarget)
        : undefined,
    baseRef:
      resolvedPhase === "external_review" && baseRef
        ? normalizeWhitespace(baseRef)
        : undefined,
    mergeBaseCommit:
      resolvedPhase === "external_review" && mergeBaseCommit
        ? normalizeWhitespace(mergeBaseCommit)
        : undefined,
    effectiveReviewTarget:
      resolvedPhase === "external_review" && effectiveReviewTarget
        ? normalizeWhitespace(effectiveReviewTarget)
        : undefined,
    snapshotCommit:
      resolvedPhase === "external_review" && snapshotCommit
        ? normalizeWhitespace(snapshotCommit)
        : undefined,
    snapshotRef:
      resolvedPhase === "external_review" && snapshotRef
        ? normalizeWhitespace(snapshotRef)
        : undefined,
    criticalCount: isInnerAdapterPhase(resolvedPhase) && String(criticalCount ?? "").trim() ? Number(criticalCount) : undefined,
    importantCount: isInnerAdapterPhase(resolvedPhase) && String(importantCount ?? "").trim() ? Number(importantCount) : undefined,
    minorCount: isInnerAdapterPhase(resolvedPhase) && String(minorCount ?? "").trim() ? Number(minorCount) : undefined,
    reviewInputFingerprint:
      resolvedPhase === "external_review"
        ? normalizeWhitespace(reviewInputFingerprint)
        : undefined,
    reviewedFiles:
      resolvedPhase === "external_review"
        ? uniqueSorted(reviewedFiles.map(normalizeRepoRelativePath))
        : undefined,
    sameProviderRerunBlocked:
      resolvedPhase === "external_review" &&
      typeof sameProviderRerunBlocked === "boolean"
        ? sameProviderRerunBlocked
        : undefined,
    reviewInputFingerprintChanged:
      resolvedPhase === "external_review" &&
      typeof reviewInputFingerprintChanged === "boolean"
        ? reviewInputFingerprintChanged
        : undefined,
    repeatClassification:
      resolvedPhase === "external_review" && repeatClassification
        ? String(repeatClassification)
        : undefined,
    repeatOverlap:
      resolvedPhase === "external_review" && repeatOverlap
        ? repeatOverlap
        : undefined,
    repeatedFindingKeys:
      resolvedPhase === "external_review"
        ? uniqueSorted(repeatedFindingKeys)
        : undefined,
    failureClassification:
      resolvedPhase === "external_review" && failureClassification
        ? String(failureClassification)
        : undefined,
    failureSubtype:
      resolvedPhase === "external_review" && failureSubtype
        ? String(failureSubtype)
        : undefined,
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

  validateEventProgression(steps, event);

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

  const splitReviewTargetFlags = new Set(["--uncommitted", "--base", "--commit", "--pr"]);
  const splitReviewTargetFlagsWithValue = new Set(["--base", "--commit", "--pr"]);
  const normalizedRest = [];
  for (let index = 0; index < rest.length; index += 1) {
    const currentArg = rest[index];
    const nextArg = rest[index + 1];
    if (
      currentArg === "--review-target" &&
      typeof nextArg === "string" &&
      splitReviewTargetFlags.has(nextArg)
    ) {
      if (splitReviewTargetFlagsWithValue.has(nextArg)) {
        const targetValue = rest[index + 2];
        if (typeof targetValue !== "string" || targetValue.startsWith("-")) {
          throw new Error(`Split ${nextArg} review target requires a following value`);
        }
        normalizedRest.push(`--review-target=${nextArg} ${targetValue}`);
        index += 2;
      } else {
        normalizedRest.push(`--review-target=${nextArg}`);
        index += 1;
      }
      continue;
    }
    normalizedRest.push(currentArg);
  }

  const options = parseArgs({
    args: normalizedRest,
    allowPositionals: false,
    options: {
      "review-id": { type: "string" },
      "repo-root": { type: "string" },
      "run-dir": { type: "string" },
      "review-mode": { type: "string" },
      "review-target": { type: "string" },
      "base-ref": { type: "string" },
      "merge-base-commit": { type: "string" },
      "effective-review-target": { type: "string" },
      source: { type: "string" },
      dest: { type: "string" },
      artifact: { type: "string" },
      title: { type: "string" },
      phase: { type: "string" },
      round: { type: "string" },
      provider: { type: "string" },
      "provider-index": { type: "string" },
      "handoff-reason": { type: "string" },
      "inner-cycle": { type: "string" },
      "cycle-source": { type: "string" },
      adapter: { type: "string" },
      strategy: { type: "string" },
      "review-mode": { type: "string" },
      "review-target": { type: "string" },
      "base-ref": { type: "string" },
      "effective-review-target": { type: "string" },
      "snapshot-commit": { type: "string" },
      "snapshot-ref": { type: "string" },
      "critical-count": { type: "string" },
      "important-count": { type: "string" },
      "minor-count": { type: "string" },
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
      reviewMode: values["review-mode"],
      reviewTarget: values["review-target"],
      baseRef: values["base-ref"],
      effectiveReviewTarget: values["effective-review-target"],
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
      provider: values.provider,
      providerIndex: values["provider-index"],
      handoffReason: values["handoff-reason"],
      innerCycle: values["inner-cycle"],
      cycleSource: values["cycle-source"],
      adapter: values.adapter,
      strategy: values.strategy,
      reviewMode: values["review-mode"],
      reviewTarget: values["review-target"],
      baseRef: values["base-ref"],
      mergeBaseCommit: values["merge-base-commit"],
      effectiveReviewTarget: values["effective-review-target"],
      snapshotCommit: values["snapshot-commit"],
      snapshotRef: values["snapshot-ref"],
      criticalCount: values["critical-count"],
      importantCount: values["important-count"],
      minorCount: values["minor-count"],
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
