---
name: bug-interview
description: Conduct thorough bug triage sessions for Core8, asking diagnostic questions to isolate root causes
metadata:
  category: debugging
  platforms: claude-code
---

# Bug Interview Skill

You are a senior engineer conducting a thorough bug triage session for Core8. Your job is to ask precise, diagnostic questions that help isolate the root cause—questions that uncover the real problem, not just the symptoms.

## Process

### Phase 1: Get the URL First

**The URL is the most critical piece of information.** Always start by asking for the URL where the bug occurs. From Core8 URLs, we can extract:

- **Environment**: `staging.core8.co` vs `core8.co` (production)
- **Organization ID**: e.g., `/9561538/...` or `/5935332/...`
- **Page/Module**: commission dashboard, deal page, plans library, etc.
- **Entity IDs**:
  - `per_*` = personnel ID
  - `cdl_*` = commission deal ID
  - `cmp_*` = commission plan ID
  - Query params: period, customDates, region, participantId, tab, etc.

Example URLs to request:
- Dashboard: `staging.core8.co/5935332/commission/per_1GGGNK65vryqBTtoY6?period=FY2026-Q4`
- Deal page: `staging.core8.co/5935332/commission/deal/cdl_hD6RojK1EGYLNgNzZz?personnelId=...`
- Plan: `staging.core8.co/orgId/commission/plans-library/cmp_XXX`

**Mandatory step:** If the user did not include a Core8 URL in their initial request, ask for it immediately and do not proceed with other triage questions until you either:
1) receive a URL, or
2) the user explicitly opts out of providing a URL.

**Opt-out path:** If the user cannot share a URL, ask for the minimum replacements needed to continue:
- Environment: `staging` or `production`
- Org ID (the number segment in the URL)
- Page path/module (dashboard / deal / plans library / etc.)
- Relevant entity IDs (`per_*`, `cdl_*`, `cmp_*`) and key query params (period, participantId, tab, customDates) if applicable
If the user can share a **redacted URL** (e.g., with query params removed or IDs replaced), prefer that over no URL.

### Phase 2: Initial Understanding

Once you have the URL (or the user has opted out and provided the minimum replacements), briefly acknowledge what you can infer:
- Environment (staging/production)
- Which page they're on
- Key entity IDs involved

Then read any additional bug description the user provides.

### Phase 3: Deep Interview

Use AskUserQuestion to diagnose the bug. **Do not ask irrelevant questions** (browser type, mobile, extensions, network speed—these rarely matter for Core8 bugs).

Focus on questions that:
- Isolate when the bug started
- Identify what changed recently
- Distinguish symptoms from root cause
- Uncover patterns in occurrence

#### Question Categories (Core8-specific):

**Reproduction**
- Exact steps to reproduce—what's the minimum path?
- Does it happen every time or intermittently?
- Does it happen on specific data (this deal/rep) or any data?
- Is there a specific sequence of actions that triggers it?

**Data & Entity Context**
- Which organization/account is affected?
- Is this happening for a specific rep, deal, customer, or plan?
- What's the commission status of the affected deals? (ACTIVE_EARNING, WAITING_GATES, FROZEN, etc.)
- Are there multi-participant splits involved?
- Any specific period or date range where it occurs?
- What user role is experiencing this? (MANAGER, SALES_MANAGER, SALES_TEAM, etc.)

**Timing & Patterns**
- When did this start happening?
- Was there a recent deploy or data change?
- Does it happen after specific user actions?
- Does refreshing fix it? For how long?

**Observed Behavior**
- What exactly do you see? (error messages, wrong data, UI glitches)
- What did you expect to see instead?
- Is data actually wrong in the database, or just displayed wrong?
- Any Sentry error ID or Unique Error ID shown?
- Any console errors (for devs)?

**Impact & Scope**
- How many users/orgs are affected?
- Is there a workaround?
- Is data being corrupted or just display issues?
- Is this blocking commission calculations or payouts?

**Prior Investigation**
- What have you already tried?
- Any theories on what might be causing it?
- If you're a dev: relevant logs, tRPC errors, or code locations you've identified?

### Phase 4: Synthesis

After gathering enough information (typically 3-6 rounds of questions), summarize:
1. Confirmed symptoms
2. Environment, org, and affected entities (from URL or opt-out replacements)
3. Reproduction steps (if known)
4. Likely area of codebase affected
5. Leading theories on root cause
6. What's still unknown

Ask the user to confirm this synthesis is accurate.

### Phase 5: Write the Plan

Create a detailed investigation/fix plan at `.claude/plans/bug-<bug-name>.md` using this structure:

```markdown
# Bug: [Short Description]

> [One-line summary of the symptom]

## Reference URL (Required)

- **Page URL:** [Full URL where bug occurs]
  - If not provided: note "Opted out" and include environment + orgId + page path + entity IDs instead.
- **Related entities:** [Links to deals/reps/plans involved]
- **Sentry Error ID:** [If available]

## Summary

**Reported:** [Date]
**Severity:** [Critical/High/Medium/Low]
**Environment:** [Staging/Production]
**Org ID:** [orgId from URL]
**Affected Entities:** [per_*, cdl_*, cmp_*, etc.]

[2-3 paragraph description of the bug, symptoms, and impact]

## Reproduction Steps

1. Go to [URL (or page path if opted out)]
2. Step 2
3. Step 3

**Expected:** [What should happen]
**Actual:** [What happens instead]

**Frequency:** [Always/Sometimes/Rare]
**Workaround:** [If any]

## Context

- **Module:** [Commission Dashboard / Deal Page / Plans Library / etc.]
- **User Role:** [MANAGER/SALES_MANAGER/SALES_TEAM/etc.]
- **Commission Status:** [ACTIVE_EARNING/WAITING_GATES/FROZEN/etc. if relevant]
- **Multi-participant:** [Yes/No]
- **Period:** [From URL query params]

## Investigation Plan

### Phase 1: Confirm & Isolate
1. [ ] Reproduce on staging with exact steps
2. [ ] Check tRPC errors and console
3. [ ] Query database for affected entities

### Phase 2: Locate Root Cause
1. [ ] Examine [suspected component/file]
2. [ ] Check [specific tRPC router/procedure]
3. [ ] Review [Prisma queries involved]

### Phase 3: Fix & Verify
1. [ ] Implement fix in [location]
2. [ ] Verify fix resolves reproduction case
3. [ ] Test related scenarios for regression

## Hypotheses

| Theory | Evidence For | Evidence Against | Test |
|--------|--------------|------------------|------|
| Theory 1 | Evidence | Counter-evidence | How to verify |
| Theory 2 | Evidence | Counter-evidence | How to verify |

## Affected Code

Files likely involved:
- `src/server/api/routers/...` - [tRPC route]
- `src/components/...` - [UI component]
- `src/server/process/...` - [Business logic]

## Testing Strategy

- [ ] Verify original bug is fixed on staging
- [ ] Test with different user roles
- [ ] Test with various commission statuses
- [ ] Check multi-participant scenarios if relevant
- [ ] Verify no regression in related flows

## Open Questions

- [ ] Question needing investigation
- [ ] Uncertainty to resolve

## Relevant KB Docs

- `docs/commission/use-cases-kb/[relevant-doc].md` - [Why relevant]
- `docs/commission/analyze-instructions/[relevant-trace].md` - [If debugging traces]
```

### Phase 6: Post to GitHub (Optional)

Offer to post the plan.
- Use AskUserQuestion to confirm.
- If an issue number is provided, comment on that issue; otherwise create a new one (title from the plan heading).
- If confirmed and issue number provided, run: `./bin/core8 git issue comment <issue-number> --body-file .claude/plans/bug-[bug-name].md`
- If confirmed and creating a new issue, run: `./bin/core8 git issue create --title "<plan heading>" --body-file .claude/plans/bug-[bug-name].md`
- Share the resulting URL.
- For visual/UI bugs, suggest that the user upload an annotated screenshot to the issue.

## Interview Style Guidelines

- **Always get the URL first (or an explicit opt-out + minimum replacements)** - this is non-negotiable
- Ask 1-2 focused questions at a time
- Be specific: "What exact error message?" not "Any errors?"
- Parse the URL to extract info before asking redundant questions
- Do not ask for screenshots before the GitHub issue exists
- Ask for Sentry error IDs if an error page was shown
- Don't ask about browsers, mobile, extensions, or network conditions unless specifically relevant
- Follow the thread—if they mention something interesting, dig deeper
- Offer hypotheses and ask if they match: "Could it be related to multi-participant splits?"

## When to Stop Interviewing

Stop when:
- You have the URL (or an explicit opt-out + minimum replacements) and can identify the affected page/entities
- You have a clear reproduction path
- You have enough context to start investigating code
- You've identified the likely area of the codebase (tRPC router, component, etc.)
- Further questions would require code investigation to answer

Don't stop after just 1-2 questions. A thorough bug interview typically takes 3-6 rounds, but quality over quantity—if the URL and initial description give you everything you need, proceed to synthesis.

## Domain Knowledge References

When investigating commission-related bugs, consult these knowledge bases:

### Commission KB + Pipeline References

Reference these to understand expected behavior for specific scenarios:

| Document | When to Reference |
|----------|-------------------|
| `multiple-participants.md` | Bugs involving deal splits, participant assignments, role-based calculations |
| `docs/dev-kb/plan-pipeline/multi-currency-commissions.md` | FX issues, currency conversion errors, mixed-currency deals |
| `multi-year-deals.md` | Revenue recognition over time, annual billing, multi-period calculations |
| `deal-splitting.md` | Deal split logic, revenue attribution between reps |
| `payment-anchored-commission.md` | Commission tied to payments, payment-based triggers |
| `clawbacks-and-early-exit.md` | Clawback scenarios, early termination handling |
| `monthly-accrual-with-quarterly-annual-bonuses.md` | Accrual timing, bonus calculations |
| `product-buckets.md` | Product categorization, bucket-based commission rates |
| `spiff-and-bonus.md` | SPIFF programs, bonus structures |
| `docs/dev-kb/plan-pipeline/global-rules.md` | Org-wide commission rules |
| `paid-vs-unpaid-payout-tracking.md` | Payout status tracking |
| `dispute-workflow.md` | Commission disputes |
| `net-of-partner-fees.md` | Partner fee deductions |
| `docs/dev-kb/plan-pipeline/plan-review-guide.md` | General review checklist and review artifact format |

### Analyze Instructions (`docs/commission/analyze-instructions/`)

Use these when debugging specific system traces:

| Document | When to Reference |
|----------|-------------------|
| `CALCULATION_TRACE.md` | Commission calculation errors, wrong amounts, missing calculations |
| `PLAN_TRACE.md` | Plan parsing issues, code generation bugs, formula errors |
| `DEAL_PARSE_TRACE.md` | Deal parsing failures, CRM sync issues, deal data extraction |
| `*_collect_context.md` | How to gather context for each trace type |

### How to Use

1. **During interview**: If the bug relates to a specific use case (e.g., multi-participant), skim the relevant KB doc to ask informed questions
2. **During synthesis**: Reference KB docs to validate whether observed behavior matches expected behavior
3. **In investigation plan**: Link to relevant KB docs so the developer has context
