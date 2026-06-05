#!/usr/bin/env node

import { execFile as execFileCallback } from "child_process";
import process from "process";
import { promisify } from "util";

import { parseNormalizedReviewTarget } from "./review-target.mjs";
import { CODE_REVIEW_GENERATED_PATHSPECS } from "./review-artifact-pathspecs.mjs";

const execFile = promisify(execFileCallback);

function normalizeRelativePath(relativePath) {
  return String(relativePath ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/+$/u, "");
}

function appendPathspecArgs(args, excludedPathspecs = []) {
  if (excludedPathspecs.length === 0) {
    return args;
  }

  return [...args, "--", ".", ...excludedPathspecs];
}

async function runGit(repoRoot, args, { trim = true } = {}) {
  const { stdout } = await execFile("git", args, {
    cwd: repoRoot,
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  return trim ? stdout.trim() : stdout;
}

async function collectNameOnlyPaths(
  repoRoot,
  args,
  { excludedPathspecs = [], nulDelimited = false } = {}
) {
  const stdout = await runGit(
    repoRoot,
    appendPathspecArgs(args, excludedPathspecs),
    { trim: false }
  );
  const entries = nulDelimited ? stdout.split("\0") : stdout.split("\n");

  return entries
    .map((entry) => normalizeRelativePath(entry))
    .filter(Boolean);
}

function parseNameStatusPaths(stdout) {
  const paths = [];
  const entries = stdout.split("\0").filter(Boolean);

  for (let index = 0; index < entries.length; ) {
    const status = entries[index++];
    const pathCount = /^[RC]\d*/u.test(status) ? 2 : 1;

    for (let count = 0; count < pathCount && index < entries.length; count += 1) {
      paths.push(entries[index++]);
    }
  }

  return paths.map((entry) => normalizeRelativePath(entry)).filter(Boolean);
}

async function collectNameStatusPaths(
  repoRoot,
  args,
  { excludedPathspecs = [] } = {}
) {
  const stdout = await runGit(
    repoRoot,
    appendPathspecArgs(args, excludedPathspecs),
    { trim: false }
  );

  return parseNameStatusPaths(stdout);
}

async function collectWorktreeOverlayPaths(
  repoRoot,
  { excludeCodeReviewArtifacts = false } = {}
) {
  const excludedPathspecs = excludeCodeReviewArtifacts
    ? [...CODE_REVIEW_GENERATED_PATHSPECS]
    : [];
  const [unstagedPaths, stagedPaths, untrackedPaths] = await Promise.all([
    collectNameStatusPaths(
      repoRoot,
      ["diff", "--name-status", "-z", "--find-renames", "--find-copies-harder"],
      { excludedPathspecs }
    ),
    collectNameStatusPaths(
      repoRoot,
      ["diff", "--cached", "--name-status", "-z", "--find-renames", "--find-copies-harder"],
      { excludedPathspecs }
    ),
    collectNameOnlyPaths(
      repoRoot,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      {
        excludedPathspecs,
        nulDelimited: true,
      }
    ),
  ]);

  return [...new Set([...unstagedPaths, ...stagedPaths, ...untrackedPaths])].sort();
}

export function isSensitiveReviewArtifactPath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (!normalizedPath) {
    return false;
  }

  if (/^env\/[^/]+\.public$/u.test(normalizedPath)) {
    return false;
  }

  if (
    normalizedPath
      .split("/")
      .some((segment) => segment === ".env" || segment === ".env.keys")
  ) {
    return true;
  }

  if (normalizedPath === ".auth-state.json") {
    return true;
  }

  if (
    normalizedPath === ".playwright-auth" ||
    normalizedPath.startsWith(".playwright-auth/")
  ) {
    return true;
  }

  if (
    normalizedPath === ".agents/skills/agent-browser/profiles" ||
    normalizedPath.startsWith(".agents/skills/agent-browser/profiles/")
  ) {
    return true;
  }

  if (
    normalizedPath === ".claude/skills/agent-browser/profiles" ||
    normalizedPath.startsWith(".claude/skills/agent-browser/profiles/")
  ) {
    return true;
  }

  return false;
}

export async function findSensitiveReviewArtifacts({
  repoRoot = process.cwd(),
  reviewTarget = "--uncommitted",
  excludeCodeReviewArtifacts = false,
}) {
  const normalizedTarget = parseNormalizedReviewTarget(reviewTarget);
  const blockedPaths = new Set();
  const addBlockedPaths = (paths) => {
    for (const relativePath of paths) {
      if (isSensitiveReviewArtifactPath(relativePath)) {
        blockedPaths.add(normalizeRelativePath(relativePath));
      }
    }
  };

  if (normalizedTarget.kind === "uncommitted") {
    addBlockedPaths(
      await collectWorktreeOverlayPaths(repoRoot, { excludeCodeReviewArtifacts })
    );
    return [...blockedPaths].sort();
  }

  if (normalizedTarget.kind === "commit") {
    addBlockedPaths(
      await collectNameStatusPaths(repoRoot, [
        "show",
        "--format=",
        "--name-status",
        "-z",
        "--find-renames",
        "--find-copies-harder",
        normalizedTarget.value,
      ])
    );
    return [...blockedPaths].sort();
  }

  if (normalizedTarget.kind === "base" || normalizedTarget.kind === "pr") {
    const excludedPathspecs = excludeCodeReviewArtifacts
      ? [...CODE_REVIEW_GENERATED_PATHSPECS]
      : [];
    addBlockedPaths(
      await collectNameStatusPaths(
        repoRoot,
        [
          "diff",
          "--name-status",
          "-z",
          "--find-renames",
          "--find-copies-harder",
          `${normalizedTarget.value}...HEAD`,
        ],
        { excludedPathspecs }
      )
    );
    addBlockedPaths(
      await collectWorktreeOverlayPaths(repoRoot, { excludeCodeReviewArtifacts })
    );
    return [...blockedPaths].sort();
  }

  throw new Error(
    `Unsupported normalized review target for sensitive artifact scan: ${normalizedTarget.kind}`
  );
}

export async function assertNoSensitiveReviewArtifacts(options = {}) {
  const { reviewTarget = "--uncommitted" } = options;
  const blockedPaths = await findSensitiveReviewArtifacts(options);

  if (blockedPaths.length === 0) {
    return;
  }

  throw new Error(
    `Blocked sensitive review artifacts for ${reviewTarget}: ${blockedPaths.join(", ")}`
  );
}
