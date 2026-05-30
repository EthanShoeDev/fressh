---
name: install-custom-skill
description: Use when the user wants to install, import, copy, register, or track a custom Codex skill in this repository from a URL, GitHub repository, local folder, or this repository's own skills directory.
---

# Install Custom Skill

Install custom skills through this repository's canonical `./si` script and
record where each skill came from.

## When to Use

Use this skill when the user asks to:

- install a skill from a URL
- add a skill from a GitHub `owner/repo`
- copy a skill from another local folder
- register a skill as originally developed in this repository
- track or update skill origin metadata

## Required Workflow

1. Locate the repository root that contains both `./si` and `skills/`.
2. Extract the skill source and skill name from the user's request.
3. If either the source or skill name is missing, ask one concise clarification.
4. Run exactly one `./si` command from the repository root.
5. Verify the skill and origin metadata.
6. Report the installed source path and recorded origin.

## Command Selection

For GitHub shorthand:

```bash
./si add-repo "<owner/repo>" --skill "<name>"
```

For a full URL or local path:

```bash
./si add "<source>" --skill "<name>"
```

When the source is a local path, or when any source or skill value came from
the user, pass each value as a separate shell argument and quote it in shell
examples. This matters for paths with spaces and for option-like input:

```bash
./si add "<local path>" --skill "<name>"
./si add "<source>" --skill "<name>"
```

For a skill whose original source is this repository:

```bash
./si origin local "<name>"
```

Do not run raw `npx skills add` in this repository. Use `./si` so imports go to
the committed `skills/<name>/` source tree and origin metadata stays current.

## Verification

After `./si` succeeds, run:

```bash
skill="<name>"
expected_origin="<expected repo, source, or path>"

test -f "skills/$skill/SKILL.md"
test -f skills-origin.json
node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync("skills-origin.json", "utf8")); const entry = data.skills.find((item) => item.name === process.argv[1]); const origin = entry && entry.origin && (entry.origin.repo || entry.origin.source || entry.origin.path); if (origin !== process.argv[2]) process.exit(1);' "$skill" "$expected_origin"
awk -v skill="$skill" -v expected_origin="$expected_origin" '
  $0 == "<!-- BEGIN SKILL ORIGINS -->" { in_block = 1; next }
  $0 == "<!-- END SKILL ORIGINS -->" { in_block = 0 }
  in_block && index($0, "| " skill " |") == 1 && index($0, expected_origin) { found = 1 }
  END { exit found ? 0 : 1 }
' README.md
```

Do not treat `rg "<name>" README.md skills-origin.json` as sufficient
verification; it only proves that the name appears somewhere. Confirm that
`skills-origin.json` has a matching structured entry whose recorded origin
value (`source`, `repo`, or `path`) is the expected origin, and that README has
the skill row with the same origin display inside the `BEGIN SKILL ORIGINS` and
`END SKILL ORIGINS` block.

For `./si origin local "<name>"`, the same verification applies.

## Reporting

Tell the user:

- the installed or registered skill name
- the source path, usually `skills/<name>`
- the origin recorded in `skills-origin.json`
- whether README's Skill Origins table was updated

Do not claim the install is complete if any verification command fails.
