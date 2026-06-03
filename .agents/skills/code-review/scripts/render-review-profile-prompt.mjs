#!/usr/bin/env node

import { readFile } from "fs/promises";
import path from "path";
import process from "process";
import { parseArgs } from "util";
import { fileURLToPath, pathToFileURL } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
export const REVIEW_PROFILE_DIR = path.resolve(currentDir, "..", "review-profiles");
export const DEFAULT_REVIEW_PROFILE = "default";

export const REVIEW_PROFILE_DEFINITIONS = {
  default: {
    mode: "prompt",
    fileName: "default.md",
    description: "Balanced bug-risk review prompt for general review passes.",
  },
  mix: {
    mode: "prompt",
    fileName: "mix.md",
    description: "Broader mixed review profile for ambiguous PR risk.",
  },
  roasted: {
    mode: "prompt",
    fileName: "roasted.md",
    description: "Harsh simplicity and breakage-focused review profile.",
  },
  architect: {
    mode: "prompt",
    fileName: "architect.md",
    description: "Blast-radius and architecture review profile.",
  },
  correctness: {
    mode: "prompt",
    fileName: "correctness.md",
    description: "Correctness and runtime failure review profile.",
  },
};

export function getAvailableReviewProfiles() {
  return Object.keys(REVIEW_PROFILE_DEFINITIONS);
}

export function resolveReviewProfileDefinition(reviewProfile = DEFAULT_REVIEW_PROFILE) {
  const normalizedProfile = String(reviewProfile ?? "").trim().toLowerCase();
  const profileName = normalizedProfile || DEFAULT_REVIEW_PROFILE;
  const definition = REVIEW_PROFILE_DEFINITIONS[profileName];

  if (!definition) {
    throw new Error(
      `Unsupported review profile: ${reviewProfile}. Expected one of: ${getAvailableReviewProfiles().join(", ")}`
    );
  }

  return {
    name: profileName,
    ...definition,
    absolutePath: path.join(REVIEW_PROFILE_DIR, definition.fileName),
  };
}

export function buildReviewBasePrompt() {
  return [
    "You are a strict code reviewer.",
    "Review only the provided patch/context for introduced bugs, regressions, missing edge-case handling, broken assumptions, or missing test coverage that should be fixed before merge.",
    "Ignore style nits, formatting, and speculative architecture advice unless the selected review profile explicitly elevates them as part of a concrete bug or compatibility risk.",
    "Prefer fewer findings with high confidence.",
    "If the patch is clean, reply with exactly one short paragraph that starts with: I did not find an introduced bug",
    'If you find issues, reply with a short summary paragraph followed by a blank line, then the heading "Full review comments:", then a blank line, then one bullet per issue in the form "- [P1] ...", "- [P2] ...", or "- [P3] ...".',
    "Each finding must identify the concrete risk and reference the relevant file or diff section when possible.",
    "Do not add any headings other than Full review comments.",
    "Do not propose code changes unless they are necessary to explain the defect.",
    "Do not ask clarifying questions, do not request approval, and do not describe a plan.",
    "Do not mention tools, files you want to write, workflow modes, or what you will do next.",
    "Return the final review only.",
  ].join(" ");
}

export async function loadReviewProfileText(reviewProfile = DEFAULT_REVIEW_PROFILE) {
  const definition = resolveReviewProfileDefinition(reviewProfile);
  const contents = (await readFile(definition.absolutePath, "utf8")).trim();

  if (!contents) {
    throw new Error(`Review profile is empty: ${definition.absolutePath}`);
  }

  return {
    ...definition,
    contents,
  };
}

function normalizePriorReviewedRecords(priorReviewedContext) {
  if (!priorReviewedContext) {
    return [];
  }

  const records = Array.isArray(priorReviewedContext)
    ? priorReviewedContext
    : Array.isArray(priorReviewedContext.records)
      ? priorReviewedContext.records
      : [];

  return records
    .map((record) => ({
      normalizedKey: String(record?.normalizedKey ?? "").trim(),
      claimClass: String(record?.claimClass ?? "general").trim() || "general",
      triageBucket:
        String(record?.triageBucket ?? record?.bucket ?? "prior_reviewed").trim() ||
        "prior_reviewed",
      affectedFiles: Array.isArray(record?.affectedFiles)
        ? record.affectedFiles.map((value) => String(value).trim()).filter(Boolean)
        : [],
      affectedFunctions: Array.isArray(record?.affectedFunctions)
        ? record.affectedFunctions.map((value) => String(value).trim()).filter(Boolean)
        : [],
      sourceFinding:
        String(record?.sourceFinding ?? record?.finding ?? record?.item ?? "").trim(),
      reason: String(record?.reason ?? "").trim(),
    }))
    .filter((record) => record.sourceFinding);
}

export function renderPriorReviewedFindingsBlock(priorReviewedContext) {
  const records = normalizePriorReviewedRecords(priorReviewedContext);
  if (records.length === 0) {
    return "";
  }

  const lines = [
    "Previously reviewed findings:",
    "These findings were already reviewed and rejected or deferred in earlier rounds.",
    "Do not restate them unless the relevant files changed, you have materially new evidence, or the claim clearly expands beyond the earlier disagreement.",
    "",
  ];

  for (const record of records) {
    const facets = [
      `bucket=${record.triageBucket}`,
      `claim_class=${record.claimClass}`,
    ];
    if (record.affectedFiles.length > 0) {
      facets.push(`files=${record.affectedFiles.join(", ")}`);
    }
    if (record.affectedFunctions.length > 0) {
      facets.push(`functions=${record.affectedFunctions.join(", ")}`);
    }
    if (record.reason) {
      facets.push(`reason=${record.reason}`);
    }
    lines.push(`- ${record.sourceFinding} (${facets.join("; ")})`);
  }

  return lines.join("\n");
}

export async function loadPriorReviewedContext(priorReviewedContextFile) {
  if (!priorReviewedContextFile) {
    return null;
  }

  const contents = await readFile(priorReviewedContextFile, "utf8");
  const parsed = JSON.parse(contents);
  return parsed ?? null;
}

export async function renderReviewProfilePrompt({
  reviewProfile = DEFAULT_REVIEW_PROFILE,
  priorReviewedContext = null,
} = {}) {
  const profile = await loadReviewProfileText(reviewProfile);
  const priorReviewedBlock = renderPriorReviewedFindingsBlock(priorReviewedContext);

  return [
    buildReviewBasePrompt(),
    `Selected review profile: ${profile.name}.`,
    "Apply the following additional review guidance while preserving the required output contract above:",
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
      "  node .agents/skills/code-review/scripts/render-review-profile-prompt.mjs [--review-profile default|mix|roasted|architect|correctness] [--prior-reviewed-context-file <path>]",
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
    await renderReviewProfilePrompt({
      reviewProfile: options.reviewProfile,
      priorReviewedContext: await loadPriorReviewedContext(
        options.priorReviewedContextFile
      ),
    })
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
