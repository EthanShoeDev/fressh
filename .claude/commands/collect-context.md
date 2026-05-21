---
description:
  Create intelligent, token-optimized context packages for external LLM review
allowed-tools:
  Write(.ai/context/**), Write(.ai/tmp/**), Write(.ai/cache/**),
  Write(.ai/checkpoints/**), Bash(./.ai/scripts/ast-discover.sh:*),
  Bash(./.ai/scripts/token-budget.sh:*),
  Bash(./.ai/scripts/validate-context.sh:*),
  Bash(./scripts/generate-context-template.mjs:*),
  Bash(./.ai/context/generate-context.mjs:*), Bash(ast-grep:*), Bash(rg:*),
  Bash(zx:*), Bash(jq:*), Bash(wc:*), Bash(find:*), Bash(ls:*), Bash(grep:*),
  Bash(repomix:*), Bash(git status), Bash(git rev-parse:*), Bash(git diff:*),
  Bash(git log:*), Bash(mkdir:*), Bash(chmod:*), Bash(cat:*), Bash(command:*)
---

# Intelligent Context Collection for GPT-5 Pro Review

You are activating the **context-collector** workflow to create intelligent,
token-optimized context packages for external LLM review.

## About XML-Like Tags (Important!)

We use XML-like tags (`<tag>...</tag>`) purely as **delimiters to structure
context for LLMs**. This is a proven prompting technique - NOT actual XML.

**What this means:**

- Tags are just markers to help the LLM understand context boundaries
- We do NOT need valid XML syntax
- No XML declaration header (`<?xml version="1.0"?>`) needed
- No CDATA wrappers (`<![CDATA[...]]>`) needed
- No entity encoding (`&lt;`, `&gt;`, `&amp;`) needed - LLMs handle raw `<`,
  `>`, `&` fine
- File extension can be `.xml` for convenience, but content is just tagged plain
  text

**Why this matters:**

- Cleaner, more readable output
- Fewer tokens wasted on XML boilerplate
- LLMs process the content exactly the same way
- Easier to manually edit or review the context

## Pre-flight Checks

Before starting the collection process, verify the environment:

1. **Directory Structure**: Ensure required directories exist

   ```bash
   mkdir -p .ai/{context,tmp,cache,checkpoints,scripts}
   ```

2. **Git Repository**: Check if in a git repository

   ```bash
   git rev-parse --git-dir >/dev/null 2>&1 || echo "Not a git repo - will use filesystem mode"
   ```

3. **Helper Scripts**: Verify scripts exist
   - `.ai/scripts/ast-discover.sh` - AST-aware file discovery
   - `.ai/scripts/token-budget.sh` - Token counting and optimization
   - `.ai/scripts/validate-context.sh` - Context validation
   - `scripts/generate-context-template.mjs` - Context generation

   If missing, inform the user they will be created on first run.

4. **Tools Check**: Verify available tools (graceful degradation if missing)
   - `ast-grep` - Preferred for semantic search (fallback: ripgrep)
   - `repomix` - Preferred for token counting (fallback: tiktoken/estimate)
   - `jq` - Required for JSON processing
   - `git` - Required for PR/uncommitted modes (fallback: filesystem mode)
   - `zx` - Required for generation script

## Your Role

Follow the comprehensive workflow to:

1. Run pre-flight checks and setup environment
2. Auto-detect context source (PR, uncommitted, or topic)
3. Run AST-aware discovery with automatic fallbacks
4. Present findings for user confirmation
5. Classify and prioritize files (critical vs. supporting)
6. Enforce token budget with smart optimization
7. Generate XML context package
8. Validate output and report results

## Parameters

Parse the following from the user's command:

**Mode Detection:**

- `--pr [branch]` - PR mode (compare branch to main)
- `--uncommitted` - Uncommitted mode (staged + unstaged changes)
- Topic mode (default if neither flag present) - Extract from user description

**Configuration:**

- `--tokens [limit]` - Token budget (default: 160K)
- `--output [path]` - Custom output path (default: .ai/context/context.xml)
- `--encoding [name]` - Token encoding (default: o200k_base for GPT-5 Pro)
- `--format [xml|markdown]` - Output format (default: xml)

**Examples:**

```bash
/collect-context --pr feat/commission-dashboard
/collect-context --uncommitted --tokens 160000
/collect-context --topic "How does invoice generation integrate with Stripe?"
/collect-context --pr main --tokens 160000 --output pr-review.xml
```

## Workflow

Follow the 7-step workflow from the `context-collector` skill:

1. Detect mode from flags or user intent.
2. Run AST-aware discovery first, then fall back to `rg` or plain-text
   heuristics.
3. Categorize files into critical and supporting sets, estimate token cost, and
   present findings before generation.
4. Expand the set with import/dependency tracing and repo-specific
   business-domain hints. Prefer 1-2 dependency hops.
5. Enforce budget by compressing supporting files, stripping low-signal content
   where safe, removing low-signal files, and asking the user to trim scope only
   if automated reduction is still insufficient.
6. Generate an editable `.ai/context/generate-context.mjs` and final context
   package with XML-like tags.
7. Validate the package before declaring success.

### XML Artifact Cleanup (Required)

After generating the context file, remove XML boilerplate that wastes tokens. Do
not globally decode `&lt;`, `&gt;`, `&amp;`, `&quot;`, or similar entity
strings; source files may legitimately contain those literal strings, and the
context package should preserve captured source content.

```bash
sed -i '1{/^<?xml/d}; s/<!\[CDATA\[//g; s/\]\]>//g' .ai/context/<filename>.xml
```

If a generator entity-encodes the whole artifact, regenerate with raw text
instead of mutating captured source content.

## Key Capabilities

**AST-Aware Discovery:**

- tRPC routers and procedures
- React components
- Trigger.dev tasks
- Prisma operations
- Integration webhooks
- Import dependencies

**Smart Compression:**

- Critical files: full content, no compression
- Supporting files: Tree-sitter structure extraction
- Optimization levels based on budget

**Business Domain Intelligence:**

- Use repo-local naming, architecture, and domain hints discovered during file
  search
- Prefer domain-specific source files over generic utilities when budget is
  tight
- Avoid hard-coded project assumptions unless this repository documents them

**Security:**

- Always-on repomix security checks
- Never include secrets in context
- Validate before sending to external LLMs

## Graceful Degradation Strategy

If tools are missing, use fallback strategies:

- **No ast-grep**: Use ripgrep for text search + manual pattern discovery
- **No repomix**: Use tiktoken Python library or character-based estimation
- **No git**: Use filesystem `find` with modification times
- **No zx**: Generate bash script instead of ZX script
- **No jq**: Use basic text processing (warn about reduced functionality)

Always inform the user which fallback strategies are being used.

## Error Recovery

- **AST-grep fails**: Automatically fall back to ripgrep, then grep
- **Over token budget**: Offer optimization options or manual adjustment
- **Missing files**: Continue with available files, log warnings
- **Invalid git state**: Fall back to filesystem scanning
- **Script errors**: Save checkpoints for resumption

## Tools Available

- `ast-grep` - Semantic code search
- `repomix` - Context packing and token counting
- `ripgrep (rg)` - Text search fallback
- `git` - Version control analysis
- `zx` - Script generation
- `jq` - JSON processing

## Output Filename

Generate a slugified filename based on the context source:

**Branch-based naming:**

- Use the current git branch name, slugified (lowercase, hyphens, no special
  chars)
- Example: `feat/commission-dashboard` → `feat-commission-dashboard.xml`
- Example: `bug/7321-deal-import-queue` → `bug-7321-deal-import-queue.xml`

**Generic branch fallback:**

- If on a generic branch (`main`, `master`, `develop`, `dev`), use the
  topic/task name instead
- Slugify the topic: lowercase, replace spaces/special chars with hyphens, max
  50 chars
- Example: topic "How does invoice generation work?" → `invoice-generation.xml`
- Example: topic "Commission import CSV parsing" →
  `commission-import-csv-parsing.xml`

**Slugify rules:**

1. Convert to lowercase
2. Replace spaces and underscores with hyphens
3. Remove special characters except hyphens
4. Collapse multiple hyphens into one
5. Trim hyphens from start/end
6. Truncate to 50 characters (at word boundary if possible)

Output path: `.ai/context/<slugified-name>.xml`

## Output Contents

Generate `.ai/context/<slugified-name>.xml` with:

- Metadata (mode, tokens, file counts)
- Instructions for GPT-5 Pro reviewer
- Repository structure
- **Full-context diffs** (if PR/uncommitted) - see below
- Critical files (full content)
- Supporting files (compressed)
- Token report

### Full-Context Diffs

When including diffs for PR or uncommitted changes, use **unified diff with
maximum context**:

```bash
# For PR mode (compare to main)
git diff -U9999 main...HEAD

# For uncommitted mode
git diff -U9999 HEAD
```

**Why `-U9999`:** This shows the entire file with +/- markers, not just isolated
hunks. The LLM gets:

- Full file structure and surrounding code
- Clear visibility of what changed (+/-) markers
- Context needed to generate correct code

This is much more useful for code generation than fragmented diff hunks.

## Success Criteria

✓ Context generated within token budget ✓ All critical files included with full
content ✓ Supporting files compressed appropriately ✓ No secrets or sensitive
data leaked ✓ XML artifacts cleaned up (no CDATA, no entity encoding) ✓ Ready
for GPT-5 Pro review

## Progress Tracking

Show clear progress through each phase:

```
[1/7] Pre-flight checks... ✓
[2/7] Detecting mode and extracting seeds... ✓
[3/7] Running AST-aware discovery... ⏳
[4/7] Classifying files... ✓
[5/7] Managing token budget... ✓
[6/7] Generating context package... ✓
[7/7] Validating output... ✓
```

Update the user at each step to maintain transparency.

## Interactive Confirmation Points

1. **After pre-flight**: Show environment status, ask to proceed or fix issues
2. **After discovery**: Show file count + token estimate, ask to proceed
3. **If over budget**: Show optimization options, let user choose
4. **Before generation**: Preview file categorization
5. **After generation**: Show validation results and next steps

## Remember

- **Semi-automated**: Always present findings and ask for confirmation before
  generating
- **Security first**: Never skip security checks, even for speed
- **Graceful degradation**: Use fallback strategies when tools are missing
- **Error recovery**: Save checkpoints to enable resumption
- **User control**: Allow customization of file lists and token limits
- **Reproducible**: Generate editable `.ai/context/generate-context.mjs` script
- **Iterate**: Support refinement and regeneration
- **Validate**: Always run validation before declaring success

## Execution Flow

1. Run pre-flight checks (create directories, verify tools)
2. Detect mode from parameters or user intent
3. Use helper scripts for discovery (`.ai/scripts/ast-discover.sh`)
4. Calculate token budget (`.ai/scripts/token-budget.sh`)
5. Generate context using template (`scripts/generate-context-template.mjs`)
6. Validate output (`.ai/scripts/validate-context.sh`)
7. Report results with next steps

Begin by running pre-flight checks and detecting the mode. Present your findings
to the user before proceeding with generation.

## File Transfer

After successful generation, automatically transfer the context file to the
Windows desktop using Tailscale:

```bash
sudo tailscale file cp .ai/context/<slugified-name>.xml desktop:
```

Use the actual generated filename (e.g., `bug-7321-deal-import-queue.xml`).
