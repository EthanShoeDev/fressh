#!/usr/bin/env node

import os from "os";
import path from "path";
import process from "process";
import { readFile } from "fs/promises";
import { parseArgs } from "util";
import { pathToFileURL } from "url";
import { runExternalReviewRound } from "./run-external-review-round.mjs";
import {
  findLatestLifecycleBoundary,
  getStepAnchorLabel,
  hasDeepReviewCheckpointAfterCleanReview,
  hasLaterUserDecision,
  loadRunState,
  recordRunArtifact,
} from "./run-artifacts.mjs";

const LEGAL_ACTIONS = new Set([
  "none",
  "external_review",
  "wait_external_review",
  "inner_receive_review",
  "inner_plan",
  "inner_execute",
  "inner_request_review",
  "deep_review",
  "user_decision",
  "final_summary",
]);

function createResult(nextRequiredAction, reason, extra = {}) {
  if (!LEGAL_ACTIONS.has(nextRequiredAction)) {
    throw new Error(`Illegal boundary action: ${nextRequiredAction}`);
  }

  return {
    ok: true,
    nextRequiredAction,
    reason,
    ...extra,
  };
}

function getLatestStep(steps) {
  return steps.length > 0 ? steps[steps.length - 1] : null;
}

function getLatestStartedExternalReviewStep(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.phase !== "external_review" || step.status !== "started") {
      continue;
    }

    const hasLaterTerminalReview = steps.slice(index + 1).some(
      (laterStep) =>
        laterStep.phase === "external_review" &&
        laterStep.round === step.round &&
        laterStep.provider === step.provider &&
        laterStep.status !== "started"
    );

    if (!hasLaterTerminalReview) {
      return step;
    }
  }

  return null;
}

function getLatestTerminalExternalReviewEntry(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.phase === "external_review" && step.status !== "started") {
      return { step, index };
    }
  }

  return null;
}

function getLatestVerificationEntry(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.phase === "main_agent_verify" && step.verificationStatus) {
      return { step, index };
    }
  }

  return null;
}

function getLatestFixEntry(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.phase === "main_agent_fix" || step.phase === "inner_execute") {
      return { step, index };
    }
  }

  return null;
}

function buildExternalReviewTempPaths(reviewId, round) {
  const basePath = path.join(
    os.tmpdir(),
    `code-review-${reviewId}-r${round}-codex`
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatTerminalStep(step) {
  if (!step) {
    return null;
  }

  return {
    title: step.title,
    phase: step.phase ?? null,
    status: step.status ?? null,
    round: step.round ?? null,
    provider: step.provider ?? null,
    result: step.result ?? null,
    timestamp: step.timestamp ?? null,
  };
}

function countOutstandingReviewItems(step) {
  const explicitCounts = [
    step?.criticalCount,
    step?.importantCount,
    step?.minorCount,
  ].map((value) => (Number.isFinite(value) ? Number(value) : null));

  if (explicitCounts.every((value) => value !== null)) {
    return explicitCounts.reduce((total, value) => total + value, 0);
  }

  return (
    (step?.findings?.length ?? 0) +
    (step?.deferred?.length ?? 0) +
    (step?.separateIssues?.length ?? 0)
  );
}

function hasLaterPhaseForRound(steps, stepIndex, round, phase) {
  return steps.slice(stepIndex + 1).some(
    (step) => step.round === round && step.phase === phase
  );
}

export async function determineNextBoundaryAction({
  runDir,
  repoRoot = process.cwd(),
}) {
  const { steps } = await loadRunState(runDir, repoRoot);
  const lifecycleBoundary = findLatestLifecycleBoundary(steps);

  if (
    lifecycleBoundary &&
    !hasLaterUserDecision(steps, lifecycleBoundary.index)
  ) {
    const { step } = lifecycleBoundary;
    if (step.status === "completed") {
      return createResult(
        "none",
        `Run is terminal after ${getStepAnchorLabel(step)} (${step.status}).`,
        { latestPhase: step.phase, latestStatus: step.status }
      );
    }

    return createResult(
      "user_decision",
      `Run is paused after ${getStepAnchorLabel(step)} (${step.status}) and requires an explicit user_decision to resume.`,
      { latestPhase: step.phase, latestStatus: step.status }
    );
  }

  const latestStep = getLatestStep(steps);
  if (!latestStep) {
    return createResult(
      "external_review",
      "Run has no recorded steps yet; the first legal action is external_review."
    );
  }

  const activeStartedExternalReview = getLatestStartedExternalReviewStep(steps);
  if (
    activeStartedExternalReview &&
    latestStep !== activeStartedExternalReview
  ) {
    return createResult(
      "wait_external_review",
      `Round ${activeStartedExternalReview.round} external review is still running; resume the same external review wrapper call and wait for its terminal result.`,
      {
        latestPhase: latestStep.phase,
        latestStatus: latestStep.status ?? null,
        activeRound: activeStartedExternalReview.round,
        activeProvider: activeStartedExternalReview.provider ?? null,
      }
    );
  }

  const latestIndex = steps.length - 1;
  const latestVerificationEntry = getLatestVerificationEntry(steps);
  const latestVerificationStep = latestVerificationEntry?.step ?? null;

  if (
    latestVerificationStep?.verificationStatus === "fail" &&
    !hasLaterUserDecision(steps, latestVerificationEntry.index)
  ) {
    return createResult(
      "user_decision",
      "Latest verification failed; resolve the failed check or record a user decision before advancing the review boundary.",
      {
        latestPhase: latestStep.phase,
        latestStatus: latestStep.status ?? null,
        verificationStatus: latestVerificationStep.verificationStatus,
      }
    );
  }

  if (latestStep.phase === "main_agent_verify") {
    const latestTerminalExternalReview = getLatestTerminalExternalReviewEntry(steps);
    const latestFixEntry = getLatestFixEntry(steps);

    if (
      latestVerificationEntry &&
      latestFixEntry &&
      latestFixEntry.index < latestVerificationEntry.index &&
      !hasLaterPhaseForRound(
        steps,
        latestFixEntry.index,
        latestFixEntry.step.round,
        "inner_request_review"
      )
    ) {
      return createResult(
        "inner_request_review",
        "Latest verification followed a recorded fix, so the fixes still need an inner review before another external review or final closeout.",
        { latestPhase: latestStep.phase, latestStatus: latestStep.status ?? null }
      );
    }

    if (latestTerminalExternalReview?.step.status === "issues_found") {
      const { step, index } = latestTerminalExternalReview;
      const hasInnerReceive = hasLaterPhaseForRound(
        steps,
        index,
        step.round,
        "inner_receive_review"
      );

      if (!hasInnerReceive) {
        return createResult(
          "inner_receive_review",
          `Latest outer review for Round ${step.round} ended issues_found and no inner_receive_review is persisted for that round yet.`,
          { latestPhase: latestStep.phase, latestStatus: latestStep.status ?? null }
        );
      }
    }

    if (latestTerminalExternalReview?.step.status === "clean") {
      const { step } = latestTerminalExternalReview;
      if (step.provider !== "codex") {
        return createResult(
          "external_review",
          `Latest external_review is clean, but provider ${step.provider} is not Codex, so another clean Codex review is required before advancing.`,
          { latestPhase: latestStep.phase, latestStatus: latestStep.status ?? null }
        );
      }

      if (!hasDeepReviewCheckpointAfterCleanReview(steps)) {
        return createResult(
          "deep_review",
          "Latest external_review is a clean Codex review and the required deep_review checkpoint has not been recorded yet.",
          { latestPhase: latestStep.phase, latestStatus: latestStep.status ?? null }
        );
      }

      return createResult(
        "final_summary",
        "Latest external_review is a clean Codex review and the required deep_review checkpoint is already recorded, so the closeout path is available.",
        { latestPhase: latestStep.phase, latestStatus: latestStep.status ?? null }
      );
    }
  }

  if (latestStep.phase === "setup") {
    return createResult(
      "external_review",
      "Setup is complete; the next legal boundary action is external_review."
    );
  }

  if (latestStep.phase === "external_review") {
    if (latestStep.status === "started") {
      return createResult(
        "wait_external_review",
        `Latest outer review for Round ${latestStep.round} is still running; resume the same external review wrapper call and wait for its terminal result.`,
        { latestPhase: latestStep.phase, latestStatus: latestStep.status }
      );
    }

    if (latestStep.status === "issues_found") {
      const hasInnerReceive = hasLaterPhaseForRound(
        steps,
        latestIndex,
        latestStep.round,
        "inner_receive_review"
      );

      if (!hasInnerReceive) {
        return createResult(
          "inner_receive_review",
          `Latest outer review for Round ${latestStep.round} ended issues_found and no inner_receive_review is persisted for that round yet.`,
          { latestPhase: latestStep.phase, latestStatus: latestStep.status }
        );
      }
    }

    if (latestStep.status === "clean") {
      if (latestStep.provider !== "codex") {
        return createResult(
          "external_review",
          `Latest external_review is clean, but provider ${latestStep.provider} is not Codex, so another clean Codex review is required before advancing.`,
          { latestPhase: latestStep.phase, latestStatus: latestStep.status }
        );
      }

      if (!hasDeepReviewCheckpointAfterCleanReview(steps)) {
        return createResult(
          "deep_review",
          "Latest external_review is a clean Codex review and the required deep_review checkpoint has not been recorded yet.",
          { latestPhase: latestStep.phase, latestStatus: latestStep.status }
        );
      }

      return createResult(
        "final_summary",
        "Latest external_review is a clean Codex review and the required deep_review checkpoint is already recorded, so the closeout path is available.",
        { latestPhase: latestStep.phase, latestStatus: latestStep.status }
      );
    }
  }

  if (latestStep.phase === "inner_receive_review" && latestStep.status === "completed") {
    return createResult(
      "none",
      "inner_receive_review completed. This thin controller does not choose between inner_plan and inner_execute.",
      { latestPhase: latestStep.phase, latestStatus: latestStep.status }
    );
  }

  if (latestStep.phase === "inner_plan" && latestStep.status === "completed") {
    return createResult(
      "inner_execute",
      "inner_plan completed; the next legal boundary action is inner_execute.",
      { latestPhase: latestStep.phase, latestStatus: latestStep.status }
    );
  }

  if (latestStep.phase === "inner_execute" && latestStep.status === "completed") {
    return createResult(
      "inner_request_review",
      "Latest inner_execute completed; the next legal boundary action is inner_request_review.",
      { latestPhase: latestStep.phase, latestStatus: latestStep.status }
    );
  }

  if (latestStep.phase === "inner_request_review") {
    if (latestStep.status === "clean") {
      return createResult(
        "external_review",
        "Latest inner_request_review is clean, so the loop may resume with external_review.",
        { latestPhase: latestStep.phase, latestStatus: latestStep.status }
      );
    }

    if (latestStep.status === "completed") {
      const outstandingItems = countOutstandingReviewItems(latestStep);

      if (outstandingItems === 0) {
        return createResult(
          "external_review",
          "Latest inner_request_review completed with zero outstanding counts, so the next legal action is external_review.",
          {
            latestPhase: latestStep.phase,
            latestStatus: latestStep.status,
            outstandingItems,
          }
        );
      }

      return createResult(
        "inner_receive_review",
        "Latest inner_request_review completed with non-zero outstanding counts, so another inner_receive_review is required.",
        {
          latestPhase: latestStep.phase,
          latestStatus: latestStep.status,
          outstandingItems,
        }
      );
    }
  }

  if (latestStep.phase === "deep_review") {
    const hasFixNowFindings =
      (latestStep.findings?.length ?? 0) > 0 ||
      (latestStep.fixedNow?.length ?? 0) > 0;

    if (hasFixNowFindings) {
      return createResult(
        "inner_receive_review",
        "deep_review is the latest boundary step and recorded fix-now findings, so the loop must re-enter the inner loop before another clean outer review.",
        { latestPhase: latestStep.phase, latestStatus: latestStep.status ?? null }
      );
    }

    return createResult(
      "final_summary",
      "deep_review is the latest boundary step with no fix-now findings, so the next legal action is final_summary.",
      { latestPhase: latestStep.phase, latestStatus: latestStep.status ?? null }
    );
  }

  if (latestStep.phase === "user_decision" && latestStep.status === "completed") {
    return createResult(
      "external_review",
      "user_decision completed; the run may resume with external_review.",
      { latestPhase: latestStep.phase, latestStatus: latestStep.status }
    );
  }

  if (latestStep.phase === "final_summary") {
    if (latestStep.status === "completed") {
      return createResult(
        "none",
        "Run is complete after final_summary completed.",
        { latestPhase: latestStep.phase, latestStatus: latestStep.status }
      );
    }

    return createResult(
      "user_decision",
      `Latest final_summary is ${latestStep.status}; the run requires user_decision before more work.`,
      { latestPhase: latestStep.phase, latestStatus: latestStep.status }
    );
  }

  return createResult(
    "none",
    `Latest durable step is ${getStepAnchorLabel(latestStep)}${latestStep.status ? ` (${latestStep.status})` : ""}. No narrower boundary action is determined by this thin controller.`,
    { latestPhase: latestStep.phase, latestStatus: latestStep.status ?? null }
  );
}

export async function closeIllegalPauseState({
  runDir,
  repoRoot = process.cwd(),
  timestamp = new Date().toISOString(),
}) {
  const boundaryResult = await determineNextBoundaryAction({ runDir, repoRoot });
  const shouldClose = new Set(["inner_receive_review", "inner_request_review"]).has(
    boundaryResult.nextRequiredAction
  );

  if (!shouldClose) {
    return {
      ok: true,
      closed: false,
      recordedStatus: null,
      nextRequiredAction: boundaryResult.nextRequiredAction,
      reason: boundaryResult.reason,
    };
  }

  await recordRunArtifact({
    runDir,
    repoRoot,
    title: "Final Summary",
    phase: "final_summary",
    status: "needs_user_decision",
    result: `Boundary closeout recorded because the run would otherwise pause illegally requiring ${boundaryResult.nextRequiredAction}.`,
    followUp: boundaryResult.reason,
    timestamp,
  });

  return {
    ok: true,
    closed: true,
    recordedStatus: "needs_user_decision",
    nextRequiredAction: "user_decision",
    reason: boundaryResult.reason,
  };
}

export async function waitForExternalReviewTerminal({
  runDir,
  repoRoot = process.cwd(),
  pollMs = 5000,
  timeoutMs = 30 * 60 * 1000,
  now = () => Date.now(),
  sleepFn = sleep,
  resumeExternalReview = runExternalReviewRound,
}) {
  const initialBoundaryResult = await determineNextBoundaryAction({ runDir, repoRoot });
  if (initialBoundaryResult.nextRequiredAction !== "wait_external_review") {
    const { steps } = await loadRunState(runDir, repoRoot);
    return {
      ok: true,
      timedOut: false,
      boundaryResult: initialBoundaryResult,
      terminalStep: formatTerminalStep(getLatestStep(steps)),
    };
  }

  const startedAt = now();
  let boundaryResult = initialBoundaryResult;

  while (now() - startedAt < timeoutMs) {
    const remainingMs = Math.max(timeoutMs - (now() - startedAt), 0);

    if (remainingMs === 0) {
      break;
    }

    await sleepFn(Math.min(pollMs, remainingMs));
    boundaryResult = await determineNextBoundaryAction({ runDir, repoRoot });

    if (boundaryResult.nextRequiredAction !== "wait_external_review") {
      const { steps: settledSteps } = await loadRunState(runDir, repoRoot);
      return {
        ok: true,
        timedOut: false,
        boundaryResult,
        terminalStep: formatTerminalStep(getLatestStep(settledSteps)),
      };
    }

    const updatedRemainingMs = Math.max(timeoutMs - (now() - startedAt), 0);
    const { metadata, steps } = await loadRunState(runDir, repoRoot);
    const activeStartedStep = getLatestStartedExternalReviewStep(steps);

    if (!activeStartedStep) {
      continue;
    }

    const { reviewPidFilePath, reviewExitFilePath } = buildExternalReviewTempPaths(
      metadata.reviewId,
      activeStartedStep.round
    );
    const activeReviewPid = await readOptionalInteger(reviewPidFilePath);
    const activeReviewExitCode = await readOptionalInteger(reviewExitFilePath);
    const shouldResumeNow =
      activeReviewExitCode !== null || activeReviewPid === null;

    if (shouldResumeNow) {
      const resumedResult = await resumeExternalReview({
        repoRoot,
        runDir,
        round: activeStartedStep.round,
        reviewId: metadata.reviewId,
        reviewMode: metadata.reviewMode ?? activeStartedStep.reviewMode ?? "auto-detect",
        reviewTarget:
          metadata.reviewTarget ?? activeStartedStep.reviewTarget ?? null,
        baseRef: metadata.baseRef ?? activeStartedStep.baseRef ?? null,
        pollMs,
        stallMs: updatedRemainingMs,
      });

      boundaryResult = await determineNextBoundaryAction({ runDir, repoRoot });
      if (
        resumedResult?.state &&
        resumedResult.state !== "started" &&
        boundaryResult.nextRequiredAction !== "wait_external_review"
      ) {
        const { steps: settledSteps } = await loadRunState(runDir, repoRoot);
        return {
          ok: true,
          timedOut: false,
          boundaryResult,
          terminalStep: formatTerminalStep(getLatestStep(settledSteps)),
        };
      }
    }
  }

  return {
    ok: true,
    timedOut: true,
    boundaryResult,
    terminalStep: null,
  };
}

function buildTerminalStepSummary(terminalStep) {
  if (!terminalStep) {
    return {};
  }

  return {
    terminalPhase: terminalStep.phase ?? null,
    terminalStatus: terminalStep.status ?? null,
    terminalRound: terminalStep.round ?? null,
    terminalProvider: terminalStep.provider ?? null,
    terminalResult: terminalStep.result ?? null,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "run-dir": { type: "string" },
      "repo-root": { type: "string" },
      action: { type: "string" },
      "poll-ms": { type: "string" },
      timestamp: { type: "string" },
      "timeout-ms": { type: "string" },
    },
    allowPositionals: false,
  });

  const runDir = values["run-dir"];
  const repoRoot = values["repo-root"] ?? process.cwd();
  const action = values.action ?? "check";
  const pollMs = values["poll-ms"] === undefined ? undefined : Number(values["poll-ms"]);
  const timestamp = values.timestamp ?? new Date().toISOString();
  const timeoutMs =
    values["timeout-ms"] === undefined ? undefined : Number(values["timeout-ms"]);

  if (!runDir) {
    throw new Error("--run-dir is required");
  }

  if (!["check", "advance", "close-if-illegal", "wait"].includes(action)) {
    throw new Error("--action must be one of: check, advance, close-if-illegal, wait");
  }

  let result;
  if (action === "close-if-illegal") {
    result = await closeIllegalPauseState({ runDir, repoRoot, timestamp });
  } else if (action === "wait") {
    result = await waitForExternalReviewTerminal({
      runDir,
      repoRoot,
      ...(pollMs === undefined ? {} : { pollMs }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  } else {
    result = await determineNextBoundaryAction({ runDir, repoRoot });
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      action,
      ...result,
      ...buildTerminalStepSummary(result.terminalStep),
    })}\n`
  );
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl && import.meta.url === entryUrl) {
  main().catch((error) => {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })}\n`
    );
    process.exitCode = 1;
  });
}
