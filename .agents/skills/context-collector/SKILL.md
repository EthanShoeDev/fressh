---
name: context-collector
description: Manual-only custom skill. Use only when explicitly requested as $context-collector or named directly.
---


# Context Collector

## Overview

Create an editable, validated context package for an external LLM review workflow. Optimize for signal density, token budget, reproducibility, and secret safety.

**Important:** XML-like tags in the output are plain-text delimiters for LLMs, not real XML. Do not add an XML declaration, CDATA, or entity encoding unless a downstream tool strictly requires it.

## When to Use

- A user wants a repo, PR, or topic-specific context bundle for GPT-5 Pro or another external model
- You need full-context diffs plus the most relevant source files
- You need token budgeting, validation, or reproducible regeneration
- You may benefit from repo-local helper scripts under `.ai/` or `scripts/`, but the workflow must still work without them

Do not use this for ordinary in-session code exploration where a packaged artifact is unnecessary.

## Quick Reference

| Input | Meaning | Default |
|---|---|---|
| `--pr [branch]` | Compare a branch to the current branch or mainline | off |
| `--uncommitted` | Package staged and unstaged changes | off |
| topic text | Focus discovery on a question or subsystem | off |
| `--tokens [limit]` | Token budget | `160000` |
| `--output [path]` | Output file | `.ai/context/<slug>.xml` |
| `--encoding [name]` | Token encoding | `o200k_base` |
| `--format [xml|markdown]` | Output format | `xml` |

## Pre-Flight

1. Ensure required directories exist:
   ```bash
   mkdir -p .ai/{context,tmp,cache,checkpoints,scripts}
   ```
2. Check repo state:
   ```bash
   git rev-parse --git-dir >/dev/null 2>&1 || echo "Not a git repo - using filesystem fallbacks"
   ```
3. Check optional helper scripts:
   - `.ai/scripts/ast-discover.sh`
   - `.ai/scripts/token-budget.sh`
   - `.ai/scripts/validate-context.sh`
   - `scripts/generate-context-template.mjs`
4. Check tool availability and announce degraded mode when needed:
   - `ast-grep` preferred, fallback `rg`
   - `repomix` preferred for packing/token counts
   - `jq` for JSON processing
   - `git` for PR and diff modes
   - `zx` for generation scripts

## Workflow

1. Detect mode from flags or user intent:
   - PR mode: compare branch changes
   - Uncommitted mode: use `git diff -U9999 HEAD`
   - Topic mode: derive keywords from the question
2. Run AST-aware discovery first, then fall back to `rg` or plain-text heuristics.
3. Categorize files into critical and supporting sets, estimate token cost, and present findings before generation.
4. Expand the set with import/dependency tracing and repo-specific business-domain hints. Prefer 1-2 dependency hops.
5. Enforce budget in this order:
   - Compress supporting files
   - Strip comments and empty lines where safe
   - Remove low-signal files
   - Reduce oversized schema/reference files
   - Ask the user to trim scope only if automated reduction is still insufficient
6. Generate an editable `.ai/context/generate-context.mjs` and the final context package.
7. Validate the package before declaring success.

Use visible progress updates:

```text
[1/7] Pre-flight checks... ✓
[2/7] Detecting mode and seeds... ✓
[3/7] Running AST-aware discovery... ⏳
[4/7] Classifying files... ✓
[5/7] Managing token budget... ✓
[6/7] Generating context package... ✓
[7/7] Validating output... ✓
```

## Output Requirements

Generate `.ai/context/<slug>.xml` containing:
- Metadata: mode, token budget, file counts
- Reviewer instructions
- Repository structure summary
- Full-context diffs for PR or uncommitted modes
- Critical files in full
- Supporting files in compressed form
- Token report

For diffs, prefer full-file unified context:

```bash
git diff -U9999 main...HEAD
git diff -U9999 HEAD
```

Slugify filenames by lowercasing, replacing spaces and underscores with hyphens, removing other special characters, collapsing duplicate hyphens, trimming ends, and capping length at about 50 characters.

## XML Artifact Cleanup

After generation, remove XML boilerplate that wastes tokens:

```bash
sed -i '1{/^<?xml/d}; s/<!\\[CDATA\\[//g; s/\\]\\]>//g; s/&lt;/</g; s/&gt;/>/g; s/&amp;/\\&/g; s/&quot;/"/g' .ai/context/<filename>.xml
```

## Decision Points

Only stop for confirmation when a decision is actually needed:
- Missing tools or scripts change fidelity or block the preferred workflow
- Discovery found ambiguous scope and multiple plausible file sets
- The package is still over budget after automated optimization
- The user explicitly asked to review or edit the included paths before generation

Otherwise, make a reasonable choice, continue, and report what you assumed.

## Fallback Strategy

- No `ast-grep`: use `rg` plus manual pattern discovery
- No `repomix`: use a rough token estimate or another local tokenizer
- No `git`: scan by topic and filesystem state only
- No `zx`: generate a shell or Node script instead
- No `jq`: continue with simpler text processing and note reduced fidelity

Always tell the user which fallbacks were used.

## Security and Recovery

- Never include secrets, service-account files, `.env` contents, or unreviewed credentials in the package
- Run validation before sharing the artifact with any external model
- If discovery or generation fails, keep partial outputs and checkpoints under `.ai/tmp` or `.ai/checkpoints` so the run can resume
- If AST discovery fails, retry with text search instead of stopping
- If the package remains over budget after automated optimization, stop and ask the user to narrow scope

## Common Mistakes

- Generating immediately instead of showing the discovered file set first
- Treating XML-like tags as real XML and keeping declarations, CDATA, or entity encoding
- Using narrow diff hunks instead of full-context diffs
- Including secrets or unreviewed environment files
- Declaring success before validation

## Optional Delivery

If the user wants the finished artifact copied to another machine after validation, use the dedicated `cp` skill instead of embedding transfer commands here.

Treat delivery as separate from core context generation.
