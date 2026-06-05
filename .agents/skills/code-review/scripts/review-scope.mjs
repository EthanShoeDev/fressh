#!/usr/bin/env node

import { execFile as execFileCallback } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import process from "process";
import { promisify } from "util";

import { CODE_REVIEW_GENERATED_PATHSPECS } from "./review-artifact-pathspecs.mjs";
import { assertNoSensitiveReviewArtifacts } from "./sensitive-review-artifacts.mjs";
import {
  CANONICAL_UNCOMMITTED_REVIEW_TARGET,
  canonicalizeReviewTarget,
  parseNormalizedReviewTarget,
} from "./review-target.mjs";

const execFile = promisify(execFileCallback);
const REVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const SUPPORTED_REVIEW_MODES = new Set([
  "auto-detect",
  "uncommitted",
  "branch-stack",
]);

export function normalizeReviewModeValue(reviewMode, defaultValue = null) {
  const normalizedReviewMode = String(reviewMode ?? "").trim().toLowerCase();
  if (!normalizedReviewMode) {
    return defaultValue;
  }

  if (!SUPPORTED_REVIEW_MODES.has(normalizedReviewMode)) {
    throw new Error(
      "reviewMode must be one of: auto-detect, uncommitted, branch-stack"
    );
  }

  return normalizedReviewMode;
}

async function runGit(
  repoRoot,
  args,
  { env = {}, trim = true } = {}
) {
  const { stdout } = await execFile("git", args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    maxBuffer: 50 * 1024 * 1024,
  });
  return trim ? stdout.trim() : stdout;
}

async function gitRefExists(repoRoot, ref) {
  try {
    await runGit(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function resolveUpstreamRef(repoRoot) {
  try {
    return await runGit(repoRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
  } catch {
    return null;
  }
}

async function countCommitsAhead(repoRoot, baseRef) {
  const rawCount = await runGit(repoRoot, [
    "rev-list",
    "--count",
    `${baseRef}..HEAD`,
  ]);
  const parsedCount = Number.parseInt(rawCount, 10);
  return Number.isFinite(parsedCount) ? parsedCount : 0;
}

async function resolveMergeBaseCommit(repoRoot, baseRef) {
  return await runGit(repoRoot, ["merge-base", "HEAD", baseRef]);
}

export async function resolvePreferredBaseRef({
  repoRoot = process.cwd(),
  explicitBaseRef = null,
  allowMissing = false,
  preferExplicit = false,
}) {
  const upstreamRef = await resolveUpstreamRef(repoRoot);
  const normalizedExplicitBaseRef = String(explicitBaseRef ?? "").trim();

  if (preferExplicit && normalizedExplicitBaseRef) {
    if (await gitRefExists(repoRoot, normalizedExplicitBaseRef)) {
      return normalizedExplicitBaseRef;
    }

    if (allowMissing) {
      return null;
    }

    throw new Error(
      `Explicit branch-stack base ref does not exist: ${normalizedExplicitBaseRef}`
    );
  }

  const candidates = [upstreamRef, normalizedExplicitBaseRef, "origin/dev"]
    .map((ref) => String(ref ?? "").trim())
    .filter(Boolean);
  const seenRefs = new Set();

  for (const candidate of candidates) {
    if (seenRefs.has(candidate)) {
      continue;
    }
    seenRefs.add(candidate);
    if (await gitRefExists(repoRoot, candidate)) {
      return candidate;
    }
  }

  if (allowMissing) {
    return null;
  }

  throw new Error(
    "Could not resolve a branch-stack base ref from branch upstream, explicit baseRef, or origin/dev."
  );
}

function buildUncommittedPolicy() {
  return {
    reviewMode: "uncommitted",
    reviewTarget: CANONICAL_UNCOMMITTED_REVIEW_TARGET,
    baseRef: null,
    effectiveReviewTarget: CANONICAL_UNCOMMITTED_REVIEW_TARGET,
  };
}

function buildLiteralTargetPolicy(reviewTarget) {
  const normalizedReviewTarget = canonicalizeReviewTarget(reviewTarget);
  const parsedReviewTarget = parseNormalizedReviewTarget(normalizedReviewTarget);

  if (parsedReviewTarget.kind === "uncommitted") {
    return buildUncommittedPolicy();
  }

  if (parsedReviewTarget.kind === "base") {
    return {
      reviewMode: "branch-stack",
      reviewTarget: normalizedReviewTarget,
      baseRef: parsedReviewTarget.value,
      effectiveReviewTarget: normalizedReviewTarget,
    };
  }

  return {
    reviewMode: null,
    reviewTarget: normalizedReviewTarget,
    baseRef: null,
    effectiveReviewTarget: normalizedReviewTarget,
  };
}

function validateBranchStackReviewId(reviewId) {
  const normalizedReviewId = String(reviewId ?? "").trim();

  if (!normalizedReviewId) {
    throw new Error("reviewId is required for branch-stack snapshots");
  }

  if (!REVIEW_ID_PATTERN.test(normalizedReviewId)) {
    throw new Error(
      `reviewId must contain only letters, digits, and hyphens: ${reviewId}`
    );
  }

  return normalizedReviewId;
}

function hasText(value) {
  return String(value ?? "").trim().length > 0;
}

export async function resolveInitialReviewPolicy({
  repoRoot = process.cwd(),
  reviewMode = null,
  reviewTarget = null,
  baseRef = null,
}) {
  const normalizedReviewMode = normalizeReviewModeValue(reviewMode, "auto-detect");
  const literalTargetPolicy = reviewTarget
    ? buildLiteralTargetPolicy(reviewTarget)
    : null;
  const normalizedBaseRef = hasText(baseRef) ? String(baseRef).trim() : null;

  if (normalizedReviewMode === "uncommitted") {
    if (
      literalTargetPolicy &&
      literalTargetPolicy.reviewMode !== "uncommitted"
    ) {
      throw new Error(
        `reviewMode "uncommitted" conflicts with reviewTarget "${literalTargetPolicy.reviewTarget}"`
      );
    }
    if (normalizedBaseRef) {
      throw new Error(
        `reviewMode "uncommitted" conflicts with baseRef "${normalizedBaseRef}"`
      );
    }

    return buildUncommittedPolicy();
  }

  if (normalizedReviewMode === "branch-stack") {
    if (
      literalTargetPolicy &&
      literalTargetPolicy.reviewMode !== "branch-stack"
    ) {
      throw new Error(
        `reviewMode "branch-stack" conflicts with reviewTarget "${literalTargetPolicy.reviewTarget}"`
      );
    }
    if (
      normalizedBaseRef &&
      literalTargetPolicy?.baseRef &&
      literalTargetPolicy.baseRef !== normalizedBaseRef
    ) {
      throw new Error(
        `baseRef "${normalizedBaseRef}" conflicts with reviewTarget "${literalTargetPolicy.reviewTarget}"`
      );
    }

    const resolvedBaseRef = await resolvePreferredBaseRef({
      repoRoot,
      explicitBaseRef: literalTargetPolicy?.baseRef ?? normalizedBaseRef,
      allowMissing: false,
      preferExplicit: true,
    });

    return {
      reviewMode: "branch-stack",
      reviewTarget: `--base ${resolvedBaseRef}`,
      baseRef: resolvedBaseRef,
      effectiveReviewTarget: `--base ${resolvedBaseRef}`,
    };
  }

  if (literalTargetPolicy) {
    if (
      normalizedBaseRef &&
      literalTargetPolicy.baseRef &&
      literalTargetPolicy.baseRef !== normalizedBaseRef
    ) {
      throw new Error(
        `baseRef "${normalizedBaseRef}" conflicts with reviewTarget "${literalTargetPolicy.reviewTarget}"`
      );
    }
    if (normalizedBaseRef && literalTargetPolicy.reviewMode === "uncommitted") {
      throw new Error(
        `baseRef "${normalizedBaseRef}" conflicts with reviewTarget "${literalTargetPolicy.reviewTarget}"`
      );
    }
    if (normalizedBaseRef && !literalTargetPolicy.baseRef) {
      throw new Error(
        `baseRef "${normalizedBaseRef}" conflicts with reviewTarget "${literalTargetPolicy.reviewTarget}"`
      );
    }

    if (literalTargetPolicy.reviewMode === "branch-stack") {
      const resolvedBaseRef = await resolvePreferredBaseRef({
        repoRoot,
        explicitBaseRef: literalTargetPolicy.baseRef,
        allowMissing: false,
        preferExplicit: true,
      });

      return {
        reviewMode: "branch-stack",
        reviewTarget: `--base ${resolvedBaseRef}`,
        baseRef: resolvedBaseRef,
        effectiveReviewTarget: `--base ${resolvedBaseRef}`,
      };
    }

    return literalTargetPolicy;
  }

  const resolvedBaseRef = await resolvePreferredBaseRef({
    repoRoot,
    explicitBaseRef: normalizedBaseRef,
    allowMissing: true,
    preferExplicit: false,
  });

  if (!resolvedBaseRef) {
    return buildUncommittedPolicy();
  }

  const aheadCount = await countCommitsAhead(repoRoot, resolvedBaseRef);
  if (aheadCount === 0) {
    return buildUncommittedPolicy();
  }

  return {
    reviewMode: "branch-stack",
    reviewTarget: `--base ${resolvedBaseRef}`,
    baseRef: resolvedBaseRef,
    effectiveReviewTarget: `--base ${resolvedBaseRef}`,
  };
}

export async function createBranchStackSnapshot({
  repoRoot = process.cwd(),
  reviewId,
  round,
  baseRef,
}) {
  const normalizedReviewId = validateBranchStackReviewId(reviewId);

  const resolvedRound = Number.parseInt(String(round ?? "").trim(), 10);
  if (!Number.isFinite(resolvedRound) || resolvedRound <= 0) {
    throw new Error("round must be a positive integer for branch-stack snapshots");
  }

  const resolvedBaseRef = await resolvePreferredBaseRef({
    repoRoot,
    explicitBaseRef: baseRef,
    allowMissing: false,
    preferExplicit: true,
  });
  await assertNoSensitiveReviewArtifacts({
    repoRoot,
    reviewTarget: `--base ${resolvedBaseRef}`,
    excludeCodeReviewArtifacts: true,
  });
  const mergeBaseCommit = await resolveMergeBaseCommit(repoRoot, resolvedBaseRef);
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), `code-review-${normalizedReviewId}-r${resolvedRound}-`)
  );
  const indexPath = path.join(tempDir, "index");
  const pathspecFile = path.join(tempDir, "pathspecs.nul");

  try {
    await runGit(repoRoot, ["read-tree", mergeBaseCommit], {
      env: {
        GIT_INDEX_FILE: indexPath,
      },
    });
    await runGit(
      repoRoot,
      ["rm", "-f", "-r", "--cached", "--ignore-unmatch", "--", "."],
      {
        env: {
          GIT_INDEX_FILE: indexPath,
        },
      }
    );
    const currentPaths = await runGit(
      repoRoot,
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ".",
        ...CODE_REVIEW_GENERATED_PATHSPECS,
      ],
      { trim: false }
    );
    if (currentPaths.length > 0) {
      await writeFile(pathspecFile, currentPaths);
      await runGit(
        repoRoot,
        [
          "add",
          "-f",
          "--all",
          "--pathspec-from-file",
          pathspecFile,
          "--pathspec-file-nul",
        ],
        {
          env: {
            GIT_INDEX_FILE: indexPath,
          },
        }
      );
    }
    const treeId = await runGit(repoRoot, ["write-tree"], {
      env: {
        GIT_INDEX_FILE: indexPath,
      },
    });
    const snapshotCommit = await runGit(
      repoRoot,
      [
        "commit-tree",
        treeId,
        "-p",
        mergeBaseCommit,
        "-m",
        `code-review snapshot ${normalizedReviewId} round ${resolvedRound}`,
      ],
      {
        env: {
          GIT_INDEX_FILE: indexPath,
        },
      }
    );
    const snapshotRef = `refs/code-review/${normalizedReviewId}/round-${resolvedRound}`;
    await runGit(repoRoot, ["update-ref", snapshotRef, snapshotCommit]);

    return {
      reviewMode: "branch-stack",
      reviewTarget: `--base ${resolvedBaseRef}`,
      baseRef: resolvedBaseRef,
      mergeBaseCommit,
      effectiveReviewTarget: `--commit ${snapshotCommit}`,
      fingerprintKey: `branch-stack:${mergeBaseCommit}:${treeId}`,
      snapshotCommit,
      snapshotRef,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function resolveRoundReviewScope({
  repoRoot = process.cwd(),
  metadata = {},
  reviewMode = null,
  reviewTarget = null,
  baseRef = null,
  reviewId,
  round,
}) {
  const initialPolicy = await resolveInitialReviewPolicy({
    repoRoot,
    reviewMode: metadata.reviewMode ?? reviewMode,
    reviewTarget: metadata.reviewTarget ?? reviewTarget,
    baseRef: metadata.baseRef ?? baseRef,
  });

  if (initialPolicy.reviewMode !== "branch-stack") {
    return {
      ...initialPolicy,
      effectiveReviewTarget:
        metadata.effectiveReviewTarget ?? initialPolicy.effectiveReviewTarget,
      snapshotCommit: null,
      snapshotRef: null,
    };
  }

  const snapshot = await createBranchStackSnapshot({
    repoRoot,
    reviewId,
    round,
    baseRef: initialPolicy.baseRef,
  });

  return {
    reviewMode: "branch-stack",
    reviewTarget: initialPolicy.reviewTarget,
    baseRef: initialPolicy.baseRef,
    mergeBaseCommit: snapshot.mergeBaseCommit,
    effectiveReviewTarget: snapshot.effectiveReviewTarget,
    fingerprintKey: snapshot.fingerprintKey,
    snapshotCommit: snapshot.snapshotCommit,
    snapshotRef: snapshot.snapshotRef,
  };
}
