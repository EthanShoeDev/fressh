#!/usr/bin/env node

import { existsSync } from "fs";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import os from "os";
import path from "path";
import process from "process";
import { parseArgs } from "util";
import { pathToFileURL } from "url";

import {
  parseCodexReviewLog,
  parseCodexReviewText,
  startManagedReview,
  waitForManagedReview,
} from "../shared/scripts/managed-review-process.mjs";
import {
  DEFAULT_REVIEW_PROFILE,
  resolveReviewProfileDefinition,
} from "./render-review-profile-prompt.mjs";
import { prepareReviewInput } from "./prepare-review-input.mjs";
import {
  assertRunAllowsExternalReview,
  EVENTS_FILE_NAME,
  buildPriorReviewedContext,
  parseEventLog,
  recordRunArtifact,
  requireExistingRunDir,
  resolveTrackedReviewContextPath,
  toRepoRelativePath,
} from "./run-artifacts.mjs";
import {
  CANONICAL_UNCOMMITTED_REVIEW_TARGET,
  canonicalizeReviewTarget,
} from "./review-target.mjs";
import {
  normalizeReviewModeValue,
  resolveRoundReviewScope,
} from "./review-scope.mjs";

export { createBranchStackSnapshot } from "./review-scope.mjs";
export { resolveRoundReviewScope } from "./review-scope.mjs";

const DEFAULT_STALL_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TAIL_LINES = 120;
const CODEX_PROVIDER = "codex";
const CODEX_PROVIDER_INDEX = 0;
const CODEX_REVIEW_ORDER = [CODEX_PROVIDER];
const CODEX_SANDBOX_BACKEND_ENV = "CODE_REVIEW_CODEX_SANDBOX_BACKEND";
const CODEX_SANDBOX_BACKEND_AUTO = "auto";
const CODEX_SANDBOX_BACKEND_DEFAULT = "default";
const CODEX_SANDBOX_BACKEND_LEGACY_LANDLOCK = "legacy-landlock";

function shellQuoteArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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

function validateRequiredString(value, label) {
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue) {
    throw new Error(`${label} is required`);
  }

  return normalizedValue;
}

function validateRound(round) {
  const parsed = Number.parseInt(String(round ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("round must be a positive integer");
  }

  return parsed;
}

function normalizeReviewProfileValue(reviewProfile) {
  const normalized = String(reviewProfile ?? "").trim();
  return normalized || null;
}

function resolveCodexSandboxBackend() {
  const override = String(
    process.env[CODEX_SANDBOX_BACKEND_ENV] ??
      CODEX_SANDBOX_BACKEND_AUTO
  )
    .trim()
    .toLowerCase();

  if (override === CODEX_SANDBOX_BACKEND_LEGACY_LANDLOCK) {
    return CODEX_SANDBOX_BACKEND_LEGACY_LANDLOCK;
  }

  return CODEX_SANDBOX_BACKEND_DEFAULT;
}

function buildCodexCommandPrefix() {
  const sandboxBackend = resolveCodexSandboxBackend();
  if (sandboxBackend === CODEX_SANDBOX_BACKEND_LEGACY_LANDLOCK) {
    return {
      commandPrefix: "codex -c features.use_legacy_landlock=true",
      sandboxBackend,
    };
  }

  return {
    commandPrefix: "codex",
    sandboxBackend,
  };
}

function buildCodexReviewScopeArgs(reviewTarget) {
  const normalizedTarget = canonicalizeReviewTarget(reviewTarget);

  if (normalizedTarget === CANONICAL_UNCOMMITTED_REVIEW_TARGET) {
    return {
      scopeArgs: CANONICAL_UNCOMMITTED_REVIEW_TARGET,
      supportsProfilePrompt: true,
    };
  }

  const [flag, ...rest] = normalizedTarget.split(/\s+/);
  if ((flag === "--base" || flag === "--commit") && rest.length === 1) {
    return {
      scopeArgs: `${flag} ${shellQuoteArg(rest[0])}`,
      supportsProfilePrompt: true,
    };
  }

  if (flag === "--pr" && rest.length === 1) {
    return {
      scopeArgs: `--base ${shellQuoteArg(rest[0])}`,
      supportsProfilePrompt: true,
    };
  }

  return {
    scopeArgs: shellQuoteArg(normalizedTarget),
    supportsProfilePrompt: false,
  };
}

export function buildCodexReviewCommand(reviewTarget, options = {}) {
  const { reviewProfile = null, priorReviewedContextFile = null } = options;
  const { scopeArgs, supportsProfilePrompt } = buildCodexReviewScopeArgs(reviewTarget);
  const { commandPrefix } = buildCodexCommandPrefix();

  if (!reviewProfile) {
    return `${commandPrefix} review ${scopeArgs}`;
  }

  const resolvedReviewProfile = resolveReviewProfileDefinition(reviewProfile);
  if (!supportsProfilePrompt) {
    throw new Error(
      "Codex review profiles require an explicit review target flag like --uncommitted, --base, --pr, or --commit"
    );
  }

  const renderPromptCommand = [
    shellQuoteArg(process.execPath),
    shellQuoteArg(
      ".agents/skills/code-review/scripts/render-codex-review-prompt.mjs"
    ),
    "--review-profile",
    shellQuoteArg(resolvedReviewProfile.name),
    ...(priorReviewedContextFile
      ? [
          "--prior-reviewed-context-file",
          shellQuoteArg(priorReviewedContextFile),
        ]
      : []),
  ].join(" ");

  return `${renderPromptCommand} | ${commandPrefix} review ${scopeArgs}`;
}

export function buildReviewCommand(reviewTarget) {
  return buildCodexReviewCommand(reviewTarget);
}

export function buildReviewCommandForProvider({
  reviewTarget,
  reviewProfile = null,
  priorReviewedContextFile = null,
}) {
  return buildCodexReviewCommand(reviewTarget, {
    reviewProfile,
    priorReviewedContextFile,
  });
}

function normalizeStoredReviewProvider(provider) {
  const normalizedProvider = String(provider ?? CODEX_PROVIDER).trim().toLowerCase();
  return normalizedProvider === "codex" || normalizedProvider === "codex-review"
    ? CODEX_PROVIDER
    : null;
}

export function classifyExistingRoundState(steps, { round, provider }) {
  const normalizedProvider = normalizeStoredReviewProvider(provider);
  const matchingSteps = steps.filter(
    (step) =>
      step.phase === "external_review" &&
      step.round === round &&
      normalizeStoredReviewProvider(step.provider) === normalizedProvider
  );

  const terminalStep =
    [...matchingSteps].reverse().find((step) => step.status !== "started") ?? null;
  const activeStartedStep = terminalStep
    ? null
    : [...matchingSteps].reverse().find((step) => step.status === "started") ?? null;

  return {
    matchingSteps,
    terminalStep,
    activeStartedStep,
  };
}

async function loadInitializedRunState(runDir, repoRoot) {
  const absoluteRunDir = await requireExistingRunDir(runDir, repoRoot);
  const eventsPath = path.join(absoluteRunDir, EVENTS_FILE_NAME);
  if (!existsSync(eventsPath)) {
    throw new Error(
      `Run event log not found: ${toRepoRelativePath(eventsPath, repoRoot)}`
    );
  }

  const events = parseEventLog(await readFile(eventsPath, "utf8"));
  const metadataEvent = events.find((event) => event.type === "run_initialized");

  if (!metadataEvent) {
    throw new Error(
      `Run metadata missing in ${toRepoRelativePath(eventsPath, repoRoot)}`
    );
  }

  return {
    absoluteRunDir,
    metadata: metadataEvent,
    steps: events.filter((event) => event.type === "step"),
  };
}

function computeReviewInputFingerprint(reviewInput) {
  return createHash("sha256")
    .update(String(reviewInput ?? ""), "utf8")
    .digest("hex");
}

function collectUntrackedFileHeaders(contents) {
  const files = [];
  const lines = String(contents ?? "").split("\n");
  let inUntrackedFiles = false;
  let activeFence = null;

  for (const line of lines) {
    const fenceMatch = line.match(/^([`~]{3,})(?:\s.*)?$/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      if (!activeFence) {
        activeFence = fence;
      } else if (
        fence[0] === activeFence[0] &&
        fence.length >= activeFence.length
      ) {
        activeFence = null;
      }
      continue;
    }

    if (activeFence) {
      continue;
    }

    if (/^#{2,3}\s+Untracked Files\s*$/.test(line)) {
      inUntrackedFiles = true;
      continue;
    }

    if (!inUntrackedFiles) {
      continue;
    }

    const fileHeaderMatch = line.match(/^###\s+File:\s+(.+)$/);
    if (fileHeaderMatch) {
      files.push(fileHeaderMatch[1].trim());
    }
  }

  return files;
}

export function extractReviewedFiles(reviewInput) {
  const files = new Set();
  const contents = String(reviewInput ?? "");

  for (const match of contents.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    files.add(match[2]);
  }
  for (const file of collectUntrackedFileHeaders(contents)) {
    files.add(file);
  }
  for (const match of contents.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
    files.add(match[1]);
  }

  return [...files].map((value) => value.trim()).filter(Boolean).sort();
}

function buildTempPaths(reviewId, round) {
  const basePath = path.join(
    os.tmpdir(),
    `code-review-${reviewId}-r${round}-${CODEX_PROVIDER}`
  );

  return {
    reviewLogPath: `${basePath}.md`,
    reviewPidFilePath: `${basePath}.pid`,
    reviewExitFilePath: `${basePath}.exit`,
  };
}

async function readOptionalInteger(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    const parsed = Number.parseInt(String(contents).trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function buildRoundTitle(round) {
  return `Round ${round} / External Review`;
}

function buildCodexExecutionNote({ reviewProfile }) {
  const sandboxBackend = resolveCodexSandboxBackend();
  const backendNote =
    sandboxBackend === CODEX_SANDBOX_BACKEND_LEGACY_LANDLOCK
      ? "sandbox backend: legacy-landlock."
      : "sandbox backend: default.";
  return `Codex runtime: built-in codex review; review profile: ${reviewProfile ?? "none"}; ${backendNote}`;
}

function buildStartedResult(reviewTarget) {
  if (reviewTarget === "--uncommitted") {
    return "Started detached Codex external review against the uncommitted diff.";
  }

  return `Started detached Codex external review against ${reviewTarget}.`;
}

function buildInProgressRoundResult({
  provider,
  providerIndex,
  reviewOrder,
  repoRoot,
  reviewId,
  activeStartedStep,
  summary,
  reviewLogPath,
}) {
  return {
    state: "started",
    findings: [],
    summary,
    provider,
    providerIndex,
    reviewProfile: activeStartedStep.reviewProfile ?? null,
    reviewMode: activeStartedStep.reviewMode ?? null,
    reviewTarget: activeStartedStep.reviewTarget ?? null,
    baseRef: activeStartedStep.baseRef ?? null,
    mergeBaseCommit: activeStartedStep.mergeBaseCommit ?? null,
    effectiveReviewTarget: activeStartedStep.effectiveReviewTarget ?? null,
    snapshotCommit: activeStartedStep.snapshotCommit ?? null,
    snapshotRef: activeStartedStep.snapshotRef ?? null,
    reviewOrder,
    sessionId: activeStartedStep.sessionId ?? null,
    sessionLogPath: null,
    reviewLogPath,
    artifactPath: activeStartedStep.artifactPath ?? null,
    reportPath: toRepoRelativePath(
      resolveTrackedReviewContextPath(reviewId, repoRoot),
      repoRoot
    ),
  };
}

function buildRecordedRoundResult({
  step,
  provider,
  providerIndex,
  reviewOrder,
  repoRoot,
  reviewId,
}) {
  return {
    state: step.status,
    findings: step.findings ?? [],
    summary: step.result ?? null,
    provider,
    providerIndex,
    reviewProfile: null,
    reviewMode: step.reviewMode ?? null,
    reviewTarget: step.reviewTarget ?? null,
    baseRef: step.baseRef ?? null,
    mergeBaseCommit: step.mergeBaseCommit ?? null,
    effectiveReviewTarget: step.effectiveReviewTarget ?? null,
    snapshotCommit: step.snapshotCommit ?? null,
    snapshotRef: step.snapshotRef ?? null,
    reviewOrder,
    sessionId: step.sessionId ?? null,
    sessionLogPath: null,
    reviewLogPath: null,
    artifactPath: step.artifactPath ?? null,
    reportPath: toRepoRelativePath(
      resolveTrackedReviewContextPath(reviewId, repoRoot),
      repoRoot
    ),
  };
}

function buildPersistedReviewScopeFromStartedStep(step) {
  if (!step?.effectiveReviewTarget) {
    return null;
  }

  return {
    reviewMode: step.reviewMode ?? null,
    reviewTarget: step.reviewTarget ?? null,
    baseRef: step.baseRef ?? null,
    mergeBaseCommit: step.mergeBaseCommit ?? null,
    effectiveReviewTarget: step.effectiveReviewTarget,
    snapshotCommit: step.snapshotCommit ?? null,
    snapshotRef: step.snapshotRef ?? null,
  };
}

async function resumeActiveExternalReviewRound({
  provider,
  reviewLogPath,
  reviewPidFilePath,
  reviewExitFilePath,
  stallMs,
  pollMs,
  tail,
  repoRoot,
  reviewId,
  providerIndex,
  reviewOrder,
  activeStartedStep,
}) {
  const pid = await readOptionalInteger(reviewPidFilePath);
  if (pid !== null) {
    return await waitForManagedReview({
      logPath: reviewLogPath,
      pidFilePath: reviewPidFilePath,
      exitFilePath: reviewExitFilePath,
      parserName: "codex-review",
      stallMs,
      pollMs,
      tail,
    });
  }

  const exitCode = await readOptionalInteger(reviewExitFilePath);
  const fullLog = await readFile(reviewLogPath, "utf8").catch(() => null);
  const parsedLog = parseCodexReviewLog(fullLog ?? "");
  const parsed =
    parsedLog.state === "unknown" ? parseCodexReviewText(fullLog ?? "") : parsedLog;

  if (exitCode !== null && (parsed.state === "clean" || parsed.state === "issues_found")) {
    return {
      state: parsed.state,
      findings: parsed.findings,
      summary: parsed.summary,
      sessionId: activeStartedStep.sessionId ?? null,
      sessionLogPath: null,
      tail: [],
    };
  }

  return buildInProgressRoundResult({
    provider,
    providerIndex,
    reviewOrder,
    repoRoot,
    reviewId,
    activeStartedStep,
    summary:
      `Round ${activeStartedStep.round} Codex external review is already active; keep waiting for the existing review to finish.`,
    reviewLogPath,
  });
}

async function resolveTerminalArtifactDestination({ repoRoot, runDir, round, state }) {
  const canonicalRelativePath = `rounds/${round}/codex-review.md`;
  if (state === "clean" || state === "issues_found") {
    return canonicalRelativePath;
  }

  const runRoot = path.isAbsolute(runDir) ? runDir : path.join(repoRoot, runDir);
  const roundDir = path.join(runRoot, "rounds", String(round));
  const baseName = `codex-review-${state}`;

  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const relativePath = `rounds/${round}/${baseName}${suffix}.md`;
    const absolutePath = path.join(roundDir, `${baseName}${suffix}.md`);
    try {
      await access(absolutePath);
    } catch {
      return relativePath;
    }
  }

  throw new Error(`Could not allocate a unique ${state} artifact path for round ${round}`);
}

async function writePriorReviewedContextFile({ absoluteRunDir, round, context }) {
  if (!context?.records?.length) {
    return null;
  }

  const filePath = path.join(
    absoluteRunDir,
    "rounds",
    String(round),
    "prior-reviewed-context.json"
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(context, null, 2)}\n`, "utf8");

  return filePath;
}

export async function runExternalReviewRound({
  repoRoot = process.cwd(),
  runDir,
  round,
  reviewId,
  reviewMode = "auto-detect",
  reviewTarget = null,
  baseRef = null,
  reviewProfile = null,
  reviewCommand = null,
  stallMs = DEFAULT_STALL_MS,
  pollMs = DEFAULT_POLL_MS,
  tail = DEFAULT_TAIL_LINES,
}) {
  const validatedRunDir = validateRequiredString(runDir, "runDir");
  const validatedReviewId = validateRequiredString(reviewId, "reviewId");
  const normalizedReviewMode = normalizeReviewModeValue(
    reviewMode,
    "auto-detect"
  );
  const validatedReviewTarget = reviewTarget
    ? canonicalizeReviewTarget(reviewTarget)
    : null;
  const normalizedReviewProfile = normalizeReviewProfileValue(reviewProfile);
  const validatedRound = validateRound(round);
  const provider = CODEX_PROVIDER;
  const resolvedProviderIndex = CODEX_PROVIDER_INDEX;
  const resolvedReviewOrder = CODEX_REVIEW_ORDER;
  const title = buildRoundTitle(validatedRound);
  const { reviewLogPath, reviewPidFilePath, reviewExitFilePath } = buildTempPaths(
    validatedReviewId,
    validatedRound
  );
  const { absoluteRunDir, metadata: runMetadata, steps: existingSteps } =
    await loadInitializedRunState(validatedRunDir, repoRoot);
  const existingRoundState = classifyExistingRoundState(existingSteps, {
    round: validatedRound,
    provider,
  });
  let resumedWaitResult = null;

  if (existingRoundState.terminalStep) {
    return buildRecordedRoundResult({
      step: existingRoundState.terminalStep,
      provider,
      providerIndex: resolvedProviderIndex,
      reviewOrder: resolvedReviewOrder,
      repoRoot,
      reviewId: validatedReviewId,
    });
  }

  if (existingRoundState.activeStartedStep) {
    resumedWaitResult = await resumeActiveExternalReviewRound({
      provider,
      reviewLogPath,
      reviewPidFilePath,
      reviewExitFilePath,
      stallMs,
      pollMs,
      tail,
      repoRoot,
      reviewId: validatedReviewId,
      providerIndex: resolvedProviderIndex,
      reviewOrder: resolvedReviewOrder,
      activeStartedStep: existingRoundState.activeStartedStep,
    });

    if (resumedWaitResult.state === "started") {
      return resumedWaitResult;
    }
  }

  assertRunAllowsExternalReview(existingSteps);
  const resumedReviewScope =
    resumedWaitResult && existingRoundState.activeStartedStep
      ? buildPersistedReviewScopeFromStartedStep(
          existingRoundState.activeStartedStep
        )
      : null;
  const resolvedReviewScope =
    resumedReviewScope ??
    (await resolveRoundReviewScope({
      repoRoot,
      metadata: runMetadata,
      reviewMode: normalizedReviewMode,
      reviewTarget: validatedReviewTarget,
      baseRef,
      reviewId: validatedReviewId,
      round: validatedRound,
    }));
  const reviewScopeArtifactFields = {
    reviewMode: resolvedReviewScope.reviewMode,
    reviewTarget: resolvedReviewScope.reviewTarget,
    baseRef: resolvedReviewScope.baseRef,
    mergeBaseCommit: resolvedReviewScope.mergeBaseCommit,
    effectiveReviewTarget: resolvedReviewScope.effectiveReviewTarget,
    snapshotCommit: resolvedReviewScope.snapshotCommit,
    snapshotRef: resolvedReviewScope.snapshotRef,
  };
  const purpose =
    resolvedReviewScope.reviewMode === "branch-stack"
      ? `Review the current branch stack against ${resolvedReviewScope.baseRef} from a fresh external Codex context.`
      : "Review the current diff from a fresh external Codex context.";
  let reviewInputFingerprint =
    existingRoundState.activeStartedStep?.reviewInputFingerprint ?? null;
  let reviewedFiles = existingRoundState.activeStartedStep?.reviewedFiles ?? [];
  let priorReviewedContextFile = null;

  if (!resumedReviewScope) {
    const reviewInput = await prepareReviewInput({
      repoRoot,
      reviewTarget: resolvedReviewScope.effectiveReviewTarget,
      excludeCodeReviewArtifacts: true,
    });
    reviewInputFingerprint = computeReviewInputFingerprint(reviewInput);
    reviewedFiles = extractReviewedFiles(reviewInput);
    priorReviewedContextFile = await writePriorReviewedContextFile({
      absoluteRunDir,
      round: validatedRound,
      context: buildPriorReviewedContext(existingSteps),
    });
  }

  const command =
    reviewCommand ??
    buildReviewCommandForProvider({
      reviewTarget: resolvedReviewScope.effectiveReviewTarget,
      reviewProfile: normalizedReviewProfile,
      priorReviewedContextFile,
    });
  const startedAt =
    existingRoundState.activeStartedStep?.startedAt ??
    existingRoundState.activeStartedStep?.timestamp ??
    new Date().toISOString();

  let waitResult = resumedWaitResult;
  if (!waitResult) {
    const startResult = await startManagedReview({
      command,
      workdir: repoRoot,
      logPath: reviewLogPath,
      pidFilePath: reviewPidFilePath,
      exitFilePath: reviewExitFilePath,
    });

    const startedRecord = await recordRunArtifact({
      repoRoot,
      runDir: validatedRunDir,
      title,
      phase: "external_review",
      round: validatedRound,
      status: "started",
      provider,
      providerIndex: resolvedProviderIndex,
      ...reviewScopeArtifactFields,
      purpose,
      result: buildStartedResult(resolvedReviewScope.effectiveReviewTarget),
      startedAt: startResult.startedAt,
      command,
      sessionId: startResult.sessionId,
      reviewInputFingerprint,
      reviewedFiles,
      notes: [
        buildCodexExecutionNote({ reviewProfile: normalizedReviewProfile }),
        `Review log: ${reviewLogPath}`,
      ],
    });

    waitResult = await waitForManagedReview({
      logPath: reviewLogPath,
      pidFilePath: reviewPidFilePath,
      exitFilePath: reviewExitFilePath,
      parserName: "codex-review",
      stallMs,
      pollMs,
      tail,
    });

    if (waitResult.state === "started") {
      return {
        state: "started",
        findings: [],
        summary: buildStartedResult(resolvedReviewScope.effectiveReviewTarget),
        provider,
        providerIndex: resolvedProviderIndex,
        reviewProfile: normalizedReviewProfile,
        ...reviewScopeArtifactFields,
        reviewOrder: resolvedReviewOrder,
        sessionId: startResult.sessionId,
        sessionLogPath: null,
        reviewLogPath,
        artifactPath: null,
        reportPath: startedRecord.reportPath,
      };
    }
  }

  const terminalState = waitResult.state;
  const terminalSummary =
    waitResult.summary ??
    (terminalState === "clean"
      ? "Codex external review found no issues."
      : terminalState === "issues_found"
        ? `Codex external review found ${waitResult.findings?.length ?? 0} issue(s).`
        : `Codex external review ended with ${terminalState}.`);
  const endedAt = new Date().toISOString();
  const destination = await resolveTerminalArtifactDestination({
    repoRoot,
    runDir: validatedRunDir,
    round: validatedRound,
    state: terminalState,
  });
  const recordResult = await recordRunArtifact({
    repoRoot,
    runDir: validatedRunDir,
    source: reviewLogPath,
    destination,
    title,
    phase: "external_review",
    round: validatedRound,
    status: terminalState,
    provider,
    providerIndex: resolvedProviderIndex,
    ...reviewScopeArtifactFields,
    purpose,
    result: terminalSummary,
    startedAt,
    endedAt,
    command,
    sessionId: waitResult.sessionId,
    findings: waitResult.findings ?? [],
    reviewInputFingerprint,
    reviewedFiles,
    notes: [
      buildCodexExecutionNote({ reviewProfile: normalizedReviewProfile }),
      `Review log: ${reviewLogPath}`,
      ...(waitResult.sessionLogPath
        ? [`Codex session log: ${waitResult.sessionLogPath}`]
        : []),
    ],
  });

  return {
    state: terminalState,
    findings: waitResult.findings ?? [],
    summary: terminalSummary,
    provider,
    providerIndex: resolvedProviderIndex,
    reviewProfile: normalizedReviewProfile,
    ...reviewScopeArtifactFields,
    reviewOrder: resolvedReviewOrder,
    sessionId: waitResult.sessionId ?? null,
    sessionLogPath: waitResult.sessionLogPath ?? null,
    reviewLogPath,
    artifactPath: recordResult.artifactPath ?? null,
    reportPath: recordResult.reportPath,
  };
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const splitReviewTargetFlags = new Set(["--uncommitted", "--base", "--commit", "--pr"]);
  const splitReviewTargetFlagsWithValue = new Set(["--base", "--commit", "--pr"]);
  const normalizedArgv = [];
  for (let index = 0; index < argv.length; index += 1) {
    const currentArg = argv[index];
    const nextArg = argv[index + 1];
    if (
      currentArg === "--review-target" &&
      typeof nextArg === "string" &&
      splitReviewTargetFlags.has(nextArg)
    ) {
      if (splitReviewTargetFlagsWithValue.has(nextArg)) {
        const targetValue = argv[index + 2];
        if (typeof targetValue !== "string" || targetValue.startsWith("-")) {
          throw new Error(`Split ${nextArg} review target requires a following value`);
        }
        normalizedArgv.push(`--review-target=${nextArg} ${targetValue}`);
        index += 2;
      } else {
        normalizedArgv.push(`--review-target=${nextArg}`);
        index += 1;
      }
      continue;
    }
    normalizedArgv.push(currentArg);
  }

  const { values } = parseArgs({
    args: normalizedArgv,
    strict: true,
    allowPositionals: false,
    options: {
      "repo-root": { type: "string" },
      "run-dir": { type: "string" },
      round: { type: "string" },
      "review-id": { type: "string" },
      "review-mode": { type: "string" },
      "review-target": { type: "string" },
      "base-ref": { type: "string" },
      "review-profile": { type: "string" },
      "stall-ms": { type: "string" },
      "poll-ms": { type: "string" },
      tail: { type: "string" },
      help: { type: "boolean" },
    },
  });

  return {
    help: values.help ?? false,
    repoRoot: values["repo-root"] ?? process.cwd(),
    runDir: values["run-dir"] ?? null,
    round: values.round ?? null,
    reviewId: values["review-id"] ?? null,
    reviewMode: normalizeReviewModeValue(values["review-mode"], "auto-detect"),
    reviewTarget: values["review-target"]
      ? canonicalizeReviewTarget(values["review-target"])
      : null,
    baseRef: values["base-ref"] ?? null,
    reviewProfile: normalizeReviewProfileValue(
      values["review-profile"] ?? DEFAULT_REVIEW_PROFILE
    ),
    stallMs: ensurePositiveInteger(values["stall-ms"], "stall-ms", DEFAULT_STALL_MS),
    pollMs: ensurePositiveInteger(values["poll-ms"], "poll-ms", DEFAULT_POLL_MS),
    tail: ensurePositiveInteger(values.tail, "tail", DEFAULT_TAIL_LINES),
  };
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node .agents/skills/code-review/scripts/run-external-review-round.mjs \\",
      "    --repo-root <path> --run-dir <path> --round <n> --review-id <id> [--review-mode auto-detect|uncommitted|branch-stack] [--base-ref <ref>] [--review-target <target>] [--review-profile default|mix|roasted|architect|correctness]",
      "",
    ].join("\n")
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);

  if (options.help) {
    printUsage();
    return;
  }

  const result = await runExternalReviewRound(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
