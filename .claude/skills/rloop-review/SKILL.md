---

name: rloop-review

description: Send the current plan to OpenAI Codex CLI for iterative review. Claude and Codex go back-and-forth until Codex approves the plan.

user_invocable: true

---



# Codex Plan Review (Iterative)



Send the current implementation plan to OpenAI Codex for review. Claude revises the plan based on Codex's feedback and re-submits until Codex approves. Max 5 rounds.



---



## When to Invoke



- When the user runs `/rloop-review` during or after plan mode

- When the user wants a second opinion on a plan from a different model



## Agent Instructions



When invoked, perform the following iterative review loop:



### Step 1: Generate Session ID



Generate a unique ID to avoid conflicts with other concurrent Claude Code sessions:



```bash

REVIEW_ID=$(uuidgen | tr '[:upper:]' '[:lower:]' | head -c 8)

```



Use this for all temp file paths: `/tmp/claude-plan-${REVIEW_ID}.md` and `/tmp/rloop-review-${REVIEW_ID}.md`.



### Step 2: Capture the Plan



Write the current plan to the session-scoped temporary file. The plan is whatever implementation plan exists in the current conversation context (from plan mode, or a plan discussed in chat).



1. Write the full plan content to `/tmp/claude-plan-${REVIEW_ID}.md`

2. If there is no plan in the current context, ask the user what they want reviewed



### Step 3: Initial Review (Round 1)



Run Codex CLI in non-interactive mode to review the plan:



```bash
codex exec \
  -m gpt-5.4 \
  -c model_reasoning_effort="high" \
  -s read-only \
  -o /tmp/rloop-review-${REVIEW_ID}.md \
  "Review the implementation plan in /tmp/claude-plan-${REVIEW_ID}.md. Focus on:

1. Correctness - Will this plan achieve the stated goals?

2. Risks - What could go wrong? Edge cases? Data loss?

3. Missing steps - Is anything forgotten?

4. Alternatives - Is there a simpler or better approach?

5. Security - Any security concerns?



Be specific and actionable. If the plan is solid and ready to implement, end your review with exactly: VERDICT: APPROVED



If changes are needed, end with exactly: VERDICT: REVISE"

```



**Capture the Codex session ID** from the output line that says `session id: <uuid>`. Store this as `CODEX_SESSION_ID`. You MUST use this exact ID to resume in subsequent rounds (do NOT use `--last`, which would grab the wrong session if multiple reviews are running concurrently).



**Notes:**

- Use `-m gpt-5.4 -c model_reasoning_effort="high"` for high-quality reasoning.

- Use `-s read-only` so Codex can read the codebase for context but cannot modify anything.

- Use `-o` to capture the output to a file for reliable reading.



### Step 4: Read Review & Check Verdict



1. Read `/tmp/rloop-review-${REVIEW_ID}.md`

2. Present Codex's review to the user:



```

## Codex Review — Round N (model: gpt-5.4)



[Codex's feedback here]

```



3. Check the verdict:

   - If **VERDICT: APPROVED** → go to Step 7 (Done)

   - If **VERDICT: REVISE** → go to Step 5 (Revise & Re-submit)

   - If no clear verdict but feedback is all positive / no actionable items → treat as approved

   - If max rounds (5) reached → go to Step 7 with a note that max rounds hit



### Step 5: Revise the Plan



Based on Codex's feedback:



1. **Revise the plan** — address each issue Codex raised. Update the plan content in the conversation context and rewrite `/tmp/claude-plan-${REVIEW_ID}.md` with the revised version.

2. **Briefly summarize** what you changed for the user:



```

### Revisions (Round N)

- [What was changed and why, one bullet per Codex issue addressed]

```



3. Inform the user what's happening: "Sending revised plan back to Codex for re-review..."



### Step 6: Re-submit to Codex (Rounds 2-5)



Resume the existing Codex session so it has full context of the prior review:



```bash

set -o pipefail

codex exec resume ${CODEX_SESSION_ID} \

  "I've revised the plan based on your feedback. The updated plan is in /tmp/claude-plan-${REVIEW_ID}.md.



Here's what I changed:

[List the specific changes made]



Please re-review. If the plan is now solid and ready to implement, end with: VERDICT: APPROVED

If more changes are needed, end with: VERDICT: REVISE" \
  2>&1 | tee /tmp/rloop-review-${REVIEW_ID}.md | tail -80

```



**Note:** `codex exec resume` does NOT support `-o` flag. Use `tee` to overwrite `/tmp/rloop-review-${REVIEW_ID}.md` each round so Step 4 always reads the latest review.



Then go back to **Step 4** (Read Review & Check Verdict).



**Important:** Keep `set -o pipefail` enabled before the `tee | tail` pipeline so resume failures are not masked.

If `resume ${CODEX_SESSION_ID}` fails (e.g., session expired), run this fallback before continuing:

```bash
FALLBACK_OUTPUT=$(codex exec \
  -m gpt-5.4 \
  -c model_reasoning_effort="high" \
  -s read-only \
  -o /tmp/rloop-review-${REVIEW_ID}.md \
  "Review the revised implementation plan in /tmp/claude-plan-${REVIEW_ID}.md with context from prior rounds.
If the plan is solid and ready to implement, end with exactly: VERDICT: APPROVED
If changes are needed, end with exactly: VERDICT: REVISE" 2>&1)

echo "${FALLBACK_OUTPUT}" | tail -80
CODEX_SESSION_ID=$(echo "${FALLBACK_OUTPUT}" | sed -n 's/.*session id: \([a-f0-9-]\{36\}\).*/\1/p' | tail -1)
```

Then verify `CODEX_SESSION_ID` is non-empty. Only go back to **Step 4** after both are true:
- `/tmp/rloop-review-${REVIEW_ID}.md` contains the fresh fallback review output
- `CODEX_SESSION_ID` has been replaced with the new session id from that fallback run

If fallback `codex exec` fails or no session id is captured, stop the loop and surface the error instead of continuing with stale state.



### Step 7: Present Final Result



Once approved (or max rounds reached):



```

## Codex Review — Final (model: gpt-5.4)



**Status:** ✅ Approved after N round(s)



[Final Codex feedback / approval message]



---

**The plan has been reviewed and approved by Codex. Ready for your approval to implement.**

```



If max rounds were reached without approval:



```

## Codex Review — Final (model: gpt-5.4)



**Status:** ⚠️ Max rounds (5) reached — not fully approved



**Remaining concerns:**

[List unresolved issues from last review]



---

**Codex still has concerns. Review the remaining items and decide whether to proceed or continue refining.**

```



### Step 8: Cleanup



Remove the session-scoped temporary files:

```bash

rm -f /tmp/claude-plan-${REVIEW_ID}.md /tmp/rloop-review-${REVIEW_ID}.md

```



## Loop Summary



```

Round 1: Claude sends plan → Codex reviews → REVISE?

Round 2: Claude revises → Codex re-reviews (resume session) → REVISE?

Round 3: Claude revises → Codex re-reviews (resume session) → APPROVED ✅

```



Max 5 rounds. Each round preserves Codex's conversation context via session resume.



## Rules



- Claude **actively revises the plan** based on Codex feedback between rounds — this is NOT just passing messages, Claude should make real improvements

- Always use model `gpt-5.4` with `-c model_reasoning_effort="high"`

- Always use read-only sandbox mode — Codex should never write files

- Max 5 review rounds to prevent infinite loops

- Show the user each round's feedback and revisions so they can follow along

- If Codex CLI is not installed or fails, inform the user and suggest `npm install -g @openai/codex`

- If a revision contradicts the user's explicit requirements, skip that revision and note it for the user