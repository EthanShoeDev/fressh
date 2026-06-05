#!/usr/bin/env node

import process from "node:process";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { initRunArtifacts, recordRunArtifact } from "./run-artifacts.mjs";
import { runExternalReviewRound } from "./run-external-review-round.mjs";

const REVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const execFileAsync = promisify(execFile);
const REVIEW_PROFILE = "mix";

function requireNonEmptyString(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

export function validateReviewId(reviewId) {
  const normalized = requireNonEmptyString(reviewId, "review id");
  if (!REVIEW_ID_PATTERN.test(normalized)) {
    throw new Error(
      `review id must contain only letters, digits, and hyphens: ${reviewId}`
    );
  }
  return normalized;
}

function normalizeBranchSlug(branchName) {
  const slug = String(branchName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "detached";
}

export function createDefaultReviewId({
  now = new Date(),
  branchName = "detached",
} = {}) {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");

  return validateReviewId(
    `closeout-${normalizeBranchSlug(branchName)}-${timestamp}`
  );
}

export function parseCloseoutArgs(argv = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        base: { type: "string" },
        check: { type: "string" },
        id: { type: "string" },
        "dry-run": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });

    return {
      baseRef: Object.hasOwn(values, "base")
        ? requireNonEmptyString(values.base, "base")
        : null,
      checkCommand: Object.hasOwn(values, "check")
        ? requireNonEmptyString(values.check, "check command")
        : null,
      dryRun: values["dry-run"] ?? false,
      help: values.help ?? false,
      reviewId: Object.hasOwn(values, "id") ? validateReviewId(values.id) : null,
    };
  } catch (error) {
    if (error?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const optionName =
        error.optionName ?? error.message.match(/Unknown option '([^']+)'/)?.[1];
      throw new Error(`Unknown option: ${optionName}`);
    }
    throw error;
  }
}

export function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node .agents/skills/code-review/scripts/run-closeout-review.mjs [--check <command>] [--base <ref>] [--id <review-id>] [--dry-run]",
      "",
    ].join("\n")
  );
}

export async function runGit(repoRoot, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  return stdout.trim();
}

export async function gitRefExists(repoRoot, ref) {
  try {
    await runGit(repoRoot, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentBranch(repoRoot) {
  const branchName = await runGit(repoRoot, ["branch", "--show-current"]);
  return branchName || "detached";
}

export async function hasDirtyWorktree(repoRoot) {
  const status = await runGit(repoRoot, ["status", "--porcelain"]);
  return status.length > 0;
}

export async function countCommitsAhead(repoRoot, baseRef) {
  const count = await runGit(repoRoot, [
    "rev-list",
    "--count",
    `${baseRef}..HEAD`,
  ]);
  return Number.parseInt(count, 10);
}

export async function resolveUpstreamRef(repoRoot) {
  try {
    const upstreamRef = await runGit(repoRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    return upstreamRef || null;
  } catch {
    return null;
  }
}

export async function resolveBaseRef(repoRoot, explicitBaseRef = null) {
  if (explicitBaseRef) {
    return (await gitRefExists(repoRoot, explicitBaseRef))
      ? explicitBaseRef
      : null;
  }

  const candidates = [
    "origin/main",
    "origin/master",
    "origin/dev",
    "main",
    "master",
    "dev",
  ];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (await gitRefExists(repoRoot, candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function resolveCloseoutPlan({
  repoRoot = process.cwd(),
  options = parseCloseoutArgs([]),
  now = new Date(),
} = {}) {
  const branchName = await getCurrentBranch(repoRoot);
  const reviewId =
    options.reviewId ?? createDefaultReviewId({ now, branchName });

  if (await hasDirtyWorktree(repoRoot)) {
    return {
      ...options,
      repoRoot,
      branchName,
      reviewId,
      hasTarget: true,
      reviewMode: "uncommitted",
      reviewTarget: "--uncommitted",
      baseRef: null,
    };
  }

  const baseRef = await resolveBaseRef(repoRoot, options.baseRef);
  if (!baseRef) {
    const reason = options.baseRef
      ? `explicit base ref does not exist: ${options.baseRef}`
      : "no uncommitted changes and no base ref could be resolved";

    return {
      ...options,
      repoRoot,
      branchName,
      reviewId,
      hasTarget: false,
      reviewMode: null,
      reviewTarget: null,
      baseRef: null,
      reason,
    };
  }

  const commitsAhead = await countCommitsAhead(repoRoot, baseRef);
  if (commitsAhead > 0) {
    return {
      ...options,
      repoRoot,
      branchName,
      reviewId,
      hasTarget: true,
      reviewMode: "branch-stack",
      reviewTarget: `--base ${baseRef}`,
      baseRef,
      commitsAhead,
    };
  }

  return {
    ...options,
    repoRoot,
    branchName,
    reviewId,
    hasTarget: false,
    reviewMode: null,
    reviewTarget: null,
    baseRef,
    commitsAhead,
    reason: `no uncommitted changes and no commits ahead of ${baseRef}`,
  };
}

export function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function buildRunDir(reviewId) {
  return path.posix.join("docs", "tool-output", "code-review", reviewId);
}

function shellOptionAssignment(name, value) {
  return `${name}=${shellQuote(value)}`;
}

function renderCommandArgs(args) {
  return args
    .map((arg) =>
      String(arg).startsWith("--review-target=") ? String(arg) : shellQuote(arg)
    )
    .join(" ");
}

export function buildInitCommand({
  reviewId,
  repoRoot,
  reviewMode,
  reviewTarget,
  baseRef = null,
}) {
  const args = [
    "node",
    ".agents/skills/code-review/scripts/run-artifacts.mjs",
    "init",
    "--review-id",
    reviewId,
    "--repo-root",
    repoRoot,
    "--review-mode",
    reviewMode,
    shellOptionAssignment("--review-target", reviewTarget),
  ];

  if (baseRef) {
    args.push("--base-ref", baseRef);
  }

  return renderCommandArgs(args);
}

export function buildExternalReviewCommand({
  repoRoot,
  runDir,
  reviewId,
  reviewMode,
  reviewTarget,
  baseRef = null,
  round = 1,
  reviewProfile = REVIEW_PROFILE,
}) {
  const args = [
    "node",
    ".agents/skills/code-review/scripts/run-external-review-round.mjs",
    "--repo-root",
    repoRoot,
    "--run-dir",
    runDir,
    "--round",
    String(round),
    "--review-id",
    reviewId,
    "--review-mode",
    reviewMode,
    shellOptionAssignment("--review-target", reviewTarget),
    "--review-profile",
    reviewProfile,
  ];

  if (baseRef) {
    args.push("--base-ref", baseRef);
  }

  return renderCommandArgs(args);
}

export function buildWaitCommand({ repoRoot, runDir }) {
  return [
    "node",
    ".agents/skills/code-review/scripts/run-boundary-step.mjs",
    "--repo-root",
    repoRoot,
    "--run-dir",
    runDir,
    "--action",
    "wait",
  ]
    .map(shellQuote)
    .join(" ");
}

export function buildDryRunCommands({
  repoRoot,
  reviewId,
  reviewMode,
  reviewTarget,
  baseRef = null,
}) {
  const runDir = buildRunDir(reviewId);

  return [
    buildInitCommand({
      repoRoot,
      reviewId,
      reviewMode,
      reviewTarget,
      baseRef,
    }),
    buildExternalReviewCommand({
      repoRoot,
      runDir,
      reviewId,
      reviewMode,
      reviewTarget,
      baseRef,
      round: 1,
      reviewProfile: REVIEW_PROFILE,
    }),
    buildWaitCommand({ repoRoot, runDir }),
  ];
}

export async function runCheckCommand({ command, cwd = process.cwd() } = {}) {
  const normalizedCommand = requireNonEmptyString(command, "check command");

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(normalizedCommand, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        status: "fail",
        command: normalizedCommand,
        exitCode: null,
        ...(stdout ? { stdout } : {}),
        ...(stderr ? { stderr } : {}),
        error: error.message,
      });
    });

    child.on("close", (exitCode) => {
      resolve({
        status: exitCode === 0 ? "pass" : "fail",
        command: normalizedCommand,
        exitCode,
        ...(stdout ? { stdout } : {}),
        ...(stderr ? { stderr } : {}),
      });
    });
  });
}

function formatCheckDetails(checkResult) {
  const details = [];
  if (checkResult.stdout) {
    details.push(["stdout:", checkResult.stdout].join("\n"));
  }
  if (checkResult.stderr) {
    details.push(["stderr:", checkResult.stderr].join("\n"));
  }
  if (checkResult.error) {
    details.push(`error: ${checkResult.error}`);
  }
  return details.join("\n\n") || null;
}

async function recordCloseoutCheck({
  deps,
  repoRoot,
  runDir,
  checkResult,
  round = 1,
}) {
  const recordArtifact = deps.recordRunArtifact ?? recordRunArtifact;
  const verificationStatus = checkResult.status === "pass" ? "pass" : "fail";
  const exitText =
    checkResult.exitCode === null || checkResult.exitCode === undefined
      ? "without an exit code"
      : `with exit code ${checkResult.exitCode}`;
  const result =
    verificationStatus === "pass"
      ? `Closeout check passed ${exitText}.`
      : `Closeout check failed ${exitText}.`;

  await recordArtifact({
    repoRoot,
    runDir,
    title: `Round ${round} / Closeout Check`,
    phase: "main_agent_verify",
    round,
    status: "completed",
    verificationStatus,
    command: checkResult.command,
    result,
    details: formatCheckDetails(checkResult),
  });
}

export async function runCloseoutReview({
  repoRoot = process.cwd(),
  options = parseCloseoutArgs([]),
  now = new Date(),
  deps = {},
} = {}) {
  const plan = await resolveCloseoutPlan({ repoRoot, options, now });

  if (!plan.hasTarget) {
    return {
      state: "no_target",
      reviewId: plan.reviewId,
      reason: plan.reason,
    };
  }

  if (options.dryRun) {
    return {
      state: "dry_run",
      reviewId: plan.reviewId,
      reviewMode: plan.reviewMode,
      reviewTarget: plan.reviewTarget,
      baseRef: plan.baseRef,
      commands: buildDryRunCommands({
        repoRoot,
        reviewId: plan.reviewId,
        reviewMode: plan.reviewMode,
        reviewTarget: plan.reviewTarget,
        baseRef: plan.baseRef,
      }),
    };
  }

  const initArtifacts = deps.initRunArtifacts ?? initRunArtifacts;
  const runReview = deps.runExternalReviewRound ?? runExternalReviewRound;

  const initResult = await initArtifacts({
    reviewId: plan.reviewId,
    repoRoot,
    reviewMode: plan.reviewMode,
    reviewTarget: plan.reviewTarget,
    baseRef: plan.baseRef,
  });
  const runDir =
    initResult.runDirRelative ?? initResult.runDir ?? buildRunDir(plan.reviewId);
  const runCheck = deps.runCheckCommand ?? runCheckCommand;
  const reviewResult = await runReview({
    repoRoot,
    runDir,
    round: 1,
    reviewId: plan.reviewId,
    reviewMode: plan.reviewMode,
    reviewTarget: plan.reviewTarget,
    baseRef: plan.baseRef,
    reviewProfile: REVIEW_PROFILE,
  });
  const checkResult = plan.checkCommand
    ? await runCheck({ command: plan.checkCommand, cwd: repoRoot })
    : null;
  if (checkResult) {
    await recordCloseoutCheck({
      deps,
      repoRoot,
      runDir,
      checkResult,
      round: 1,
    });
  }
  const state = checkResult?.status === "fail" ? "blocked" : reviewResult.state;

  return {
    ...reviewResult,
    state,
    ...(state !== reviewResult.state ? { reviewState: reviewResult.state } : {}),
    reviewId: plan.reviewId,
    runDir,
    waitCommand: buildWaitCommand({ repoRoot, runDir }),
    ...(checkResult ? { check: checkResult } : {}),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCloseoutArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }
  const result = await runCloseoutReview({ options });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
