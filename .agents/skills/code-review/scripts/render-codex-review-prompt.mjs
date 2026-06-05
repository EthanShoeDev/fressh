#!/usr/bin/env node

import { pathToFileURL } from "url";
import process from "process";
import { parseArgs } from "util";

import {
  DEFAULT_REVIEW_PROFILE,
  loadReviewProfileText,
  loadPriorReviewedContext,
  renderPriorReviewedFindingsBlock,
} from "./render-review-profile-prompt.mjs";

export function buildCodexBasePrompt() {
  return [
    "Use Codex's built-in code review behavior.",
    "Review only the provided patch/context for introduced bugs, regressions, broken assumptions, missing edge-case handling, or missing tests that should be fixed before merge.",
    "Prefer fewer, higher-confidence findings over exhaustive coverage.",
    "Ignore style, formatting, and speculative design advice unless they create a concrete technical risk.",
    "Keep Codex's normal review output format. Do not invent a custom schema or headings.",
  ].join(" ");
}

export async function renderCodexReviewPrompt({
  reviewProfile = DEFAULT_REVIEW_PROFILE,
  priorReviewedContext = null,
} = {}) {
  const profile = await loadReviewProfileText(reviewProfile);
  const priorReviewedBlock = renderPriorReviewedFindingsBlock(priorReviewedContext);

  return [
    buildCodexBasePrompt(),
    `Selected review profile: ${profile.name}.`,
    "Apply the following additional review guidance while keeping Codex's normal review behavior:",
    profile.contents,
    priorReviewedBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      "review-profile": { type: "string" },
      "prior-reviewed-context-file": { type: "string" },
      help: { type: "boolean" },
    },
  });

  return {
    help: values.help ?? false,
    reviewProfile: values["review-profile"] ?? DEFAULT_REVIEW_PROFILE,
    priorReviewedContextFile: values["prior-reviewed-context-file"] ?? null,
  };
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node .agents/skills/code-review/scripts/render-codex-review-prompt.mjs [--review-profile default|mix|roasted|architect|correctness] [--prior-reviewed-context-file <path>]",
      "",
    ].join("\n")
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);

  if (options.help) {
    printUsage();
    return;
  }

  process.stdout.write(
    await renderCodexReviewPrompt({
      reviewProfile: options.reviewProfile,
      priorReviewedContext: await loadPriorReviewedContext(
        options.priorReviewedContextFile
      ),
    })
  );
}

export function isDirectExecution({
  argv1 = process.argv[1],
  metaUrl = import.meta.url,
} = {}) {
  return Boolean(argv1) && metaUrl === pathToFileURL(argv1).href;
}

if (isDirectExecution()) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
