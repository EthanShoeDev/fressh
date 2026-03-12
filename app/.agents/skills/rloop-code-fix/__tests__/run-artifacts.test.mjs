import os from "os";
import path from "path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveSuggestedFinalStatus,
  EVENTS_FILE_NAME,
  resolveTrackedReviewContextPath,
  fileExists,
  formatDuration,
  initRunArtifacts,
  parseEventLog,
  recordRunArtifact,
  resolveRunDir,
  resolveRunRoot,
  summarizeRunArtifacts,
  validateReviewId,
} from "../scripts/run-artifacts.mjs";

const tempRoots = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rloop-artifacts-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("run-artifacts", () => {
  it("initializes the new event-log layout and generated reports", async () => {
    const repoRoot = await createTempRoot();

    const result = await initRunArtifacts({
      reviewId: "abc12345",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    expect(result.runDir).toBe(resolveRunDir("abc12345", repoRoot));
    expect(result.runDirRelative).toBe("docs/tool-output/rloop-code-fix/abc12345");
    expect(await fileExists(path.join(result.runDir, EVENTS_FILE_NAME))).toBe(true);
    expect(await fileExists(resolveTrackedReviewContextPath("abc12345", repoRoot))).toBe(true);

    const events = parseEventLog(
      await readFile(path.join(result.runDir, EVENTS_FILE_NAME), "utf8")
    );
    const processReportContents = await readFile(
      resolveTrackedReviewContextPath("abc12345", repoRoot),
      "utf8"
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run_initialized",
      reviewId: "abc12345",
      runDirRelative: "docs/tool-output/rloop-code-fix/abc12345",
      startedAt: "2026-03-10T00:00:00.000Z",
    });
    expect(processReportContents).toContain("# rloop-code-fix Process Report");
    expect(processReportContents).toContain("- Suggested final status: `in_progress`");
    expect(processReportContents).toContain("- Current batch window: `1-5`");
    expect(processReportContents).toContain("- Latest external review status: `not_run`");
    expect(processReportContents).toContain("## Round Report");
    expect(processReportContents).toContain("## Full Timeline");
  });

  it("rewrites the tracked process report after external review, deep review, and final closeout", async () => {
    const repoRoot = await createTempRoot();
    const artifactPath = path.join(repoRoot, "artifact.md");
    await writeFile(artifactPath, "# artifact\n", "utf8");

    const { runDir } = await initRunArtifacts({
      reviewId: "trackedctx1",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/main-agent-triage.md",
      title: "Round 1 / Main-Agent Triage",
      phase: "main_agent_triage",
      round: 1,
      status: "completed",
      result: "Recorded one deferred issue for the next review.",
      deferred: ["deferred issue"],
      timestamp: "2026-03-10T00:01:00.000Z",
    });

    const trackedContextPath = resolveTrackedReviewContextPath(
      "trackedctx1",
      repoRoot
    );
    const contextAfterTriage = await readFile(trackedContextPath, "utf8");

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/2/codex-review.md",
      title: "Round 2 / External Review",
      phase: "external_review",
      round: 2,
      status: "clean",
      result: "External review is clean.",
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    const contextAfterExternalReview = await readFile(trackedContextPath, "utf8");
    expect(contextAfterExternalReview).not.toBe(contextAfterTriage);
    expect(contextAfterExternalReview).toContain("- Latest external review status: `clean`");

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "deep-review/merged-findings.md",
      title: "Deep Review / Merged Findings",
      phase: "deep_review",
      status: "completed",
      result: "Deep review ran and found no new issues.",
      timestamp: "2026-03-10T00:02:30.000Z",
    });

    const contextAfterDeepReview = await readFile(trackedContextPath, "utf8");
    expect(contextAfterDeepReview).not.toBe(contextAfterExternalReview);
    expect(contextAfterDeepReview).toContain("Deep review ran and found no new issues.");

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "verification/final-closeout.md",
      title: "Final Summary",
      phase: "final_summary",
      status: "completed",
      result: "Closeout completed after the clean external review.",
      timestamp: "2026-03-10T00:03:00.000Z",
    });

    const contextAfterCloseout = await readFile(trackedContextPath, "utf8");
    expect(contextAfterCloseout).not.toBe(contextAfterDeepReview);
    expect(contextAfterCloseout).toContain("- Suggested final status: `ready_with_follow_ups`");
  });

  it("rewrites the tracked review context when deep review records follow-up decisions", async () => {
    const repoRoot = await createTempRoot();
    const artifactPath = path.join(repoRoot, "artifact.md");
    await writeFile(artifactPath, "# artifact\n", "utf8");

    const { runDir } = await initRunArtifacts({
      reviewId: "deepfollow1",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/codex-review.md",
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "clean",
      result: "External review is clean.",
      timestamp: "2026-03-10T00:01:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "deep-review/merged-findings.md",
      title: "Deep Review / Merged Findings",
      phase: "deep_review",
      status: "completed",
      result: "Deep review found one separate follow-up issue.",
      separateIssues: ["follow-up: add missing retry logic"],
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    const trackedContextContents = await readFile(
      resolveTrackedReviewContextPath("deepfollow1", repoRoot),
      "utf8"
    );

    expect(trackedContextContents).toContain("add missing retry logic");
  });

  it("rewrites the tracked review context when deep review records only false-positive decisions", async () => {
    const repoRoot = await createTempRoot();
    const artifactPath = path.join(repoRoot, "artifact.md");
    await writeFile(artifactPath, "# artifact\n", "utf8");

    const { runDir } = await initRunArtifacts({
      reviewId: "deepfalse1",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/codex-review.md",
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "clean",
      result: "External review is clean.",
      timestamp: "2026-03-10T00:01:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "deep-review/merged-findings.md",
      title: "Deep Review / Merged Findings",
      phase: "deep_review",
      status: "completed",
      result: "Deep review rejected one false positive.",
      falsePositives: ["not a bug because invariant"],
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    const trackedContextContents = await readFile(
      resolveTrackedReviewContextPath("deepfalse1", repoRoot),
      "utf8"
    );

    expect(trackedContextContents).toContain("not a bug because invariant");
  });

  it("regenerates the tracked review context for an existing completed run when it is missing", async () => {
    const repoRoot = await createTempRoot();
    const artifactPath = path.join(repoRoot, "artifact.md");
    await writeFile(artifactPath, "# artifact\n", "utf8");

    const { runDir } = await initRunArtifacts({
      reviewId: "regenctx1",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/codex-review.md",
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "clean",
      result: "External review is clean.",
      timestamp: "2026-03-10T00:01:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "deep-review/merged-findings.md",
      title: "Deep Review / Merged Findings",
      phase: "deep_review",
      status: "completed",
      result: "Deep review found no issues.",
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Final Summary",
      phase: "final_summary",
      status: "completed",
      result: "Closeout completed after clean review and deep review.",
      timestamp: "2026-03-10T00:03:00.000Z",
    });

    const trackedContextPath = resolveTrackedReviewContextPath("regenctx1", repoRoot);
    await rm(trackedContextPath, { force: true });

    await summarizeRunArtifacts({ runDir, repoRoot });

    expect(await fileExists(trackedContextPath)).toBe(true);
  });

  it("renders workflow violations and user decisions in the tracked process report", async () => {
    const repoRoot = await createTempRoot();
    const { runDir } = await initRunArtifacts({
      reviewId: "decisions1",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 1 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 1,
      status: "passed",
      result: "Applied a fix before the decision checkpoint.",
      fixNow: ["issue one"],
      timestamp: "2026-03-10T00:01:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Final Summary",
      phase: "final_summary",
      status: "needs_user_decision",
      result: "Waiting for the user to decide whether to continue.",
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Batch Decision",
      phase: "user_decision",
      status: "completed",
      question: "Continue with another 5-round batch or stop as-is?",
      answer: "Stop as-is.",
      result: "The workflow will stop at the current batch boundary.",
      timestamp: "2026-03-10T00:03:00.000Z",
    });

    const reportContents = await readFile(
      resolveTrackedReviewContextPath("decisions1", repoRoot),
      "utf8"
    );

    expect(reportContents).toContain("## Workflow Violations");
    expect(reportContents).toContain("Round 1 advanced to Final Summary without a persisted main-agent verify");
    expect(reportContents).toContain("## User Decisions");
    expect(reportContents).toContain("Continue with another 5-round batch or stop as-is?");
    expect(reportContents).toContain("Stop as-is.");
  });

  it("blocks runs when deep review is recorded before the first clean external review", async () => {
    const repoRoot = await createTempRoot();
    const { runDir } = await initRunArtifacts({
      reviewId: "order1234",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "issues_found",
      timestamp: "2026-03-10T00:01:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 1 / Main-Agent Triage",
      phase: "main_agent_triage",
      round: 1,
      status: "completed",
      fixNow: ["issue one"],
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 1 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 1,
      status: "passed",
      fixNow: ["issue one"],
      timestamp: "2026-03-10T00:03:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 1 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 1,
      status: "passed",
      verificationStatus: "pass",
      timestamp: "2026-03-10T00:04:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Deep Review / Merged Findings",
      phase: "deep_review",
      status: "completed",
      result: "Deep review ran before external review was clean.",
      timestamp: "2026-03-10T00:05:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 2 / External Review",
      phase: "external_review",
      round: 2,
      status: "clean",
      timestamp: "2026-03-10T00:06:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Final Summary",
      phase: "final_summary",
      status: "completed",
      result: "Closeout was attempted after the invalid deep-review ordering.",
      timestamp: "2026-03-10T00:07:00.000Z",
    });

    const reportContents = await readFile(
      resolveTrackedReviewContextPath("order1234", repoRoot),
      "utf8"
    );
    const steps = parseEventLog(await readFile(path.join(runDir, EVENTS_FILE_NAME), "utf8")).slice(1);

    expect(deriveSuggestedFinalStatus(steps)).toBe("blocked");
    expect(reportContents).toContain("## Workflow Violations");
    expect(reportContents).toContain(
      "A deep review step was recorded before the first clean external review. Deep review can only run after external review returns clean."
    );
  });

  it("rejects reusing an existing review directory during init", async () => {
    const repoRoot = await createTempRoot();

    await initRunArtifacts({
      reviewId: "abc12345",
      repoRoot,
    });

    await expect(
      initRunArtifacts({
        reviewId: "abc12345",
        repoRoot,
      })
    ).rejects.toThrow(
      "Run directory already exists: docs/tool-output/rloop-code-fix/abc12345"
    );
  });

  it("rejects reusing a review ID when the tracked review context already exists", async () => {
    const repoRoot = await createTempRoot();
    const trackedContextPath = resolveTrackedReviewContextPath(
      "abc12345",
      repoRoot
    );

    await mkdir(path.dirname(trackedContextPath), { recursive: true });
    await writeFile(trackedContextPath, "# existing tracked context\n", "utf8");

    await expect(
      initRunArtifacts({
        reviewId: "abc12345",
        repoRoot,
      })
    ).rejects.toThrow(
      "Tracked review context already exists: docs/run/rloop-code-fix-abc12345.md"
    );
  });

  it("rejects invalid review IDs before init can escape the artifact root", async () => {
    const repoRoot = await createTempRoot();

    expect(validateReviewId("abc-123")).toBe("abc-123");
    expect(() => validateReviewId("../../escape")).toThrow(
      "reviewId must contain only letters, digits, and hyphens"
    );

    await expect(
      initRunArtifacts({
        reviewId: "../../escape",
        repoRoot,
      })
    ).rejects.toThrow("reviewId must contain only letters, digits, and hyphens");
  });

  it("records a round event, copies the artifact, and regenerates the tracked process report", async () => {
    const repoRoot = await createTempRoot();
    const rawArtifactPath = path.join(repoRoot, "review.md");
    const findingsPath = path.join(repoRoot, "findings.md");
    const notesPath = path.join(repoRoot, "notes.md");

    await writeFile(rawArtifactPath, "# raw review\n", "utf8");
    await writeFile(findingsPath, "- [P1] Missing pipefail on review pipeline\n", "utf8");
    await writeFile(notesPath, "- Review came from a fresh external Codex session\n", "utf8");

    const { runDir } = await initRunArtifacts({
      reviewId: "trace1234",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    const result = await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "rounds/1/codex-review.md",
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "issues_found",
      purpose: "Review the current diff from a fresh Codex context.",
      result: "Found one real workflow bug.",
      followUp: "Move to main-agent triage and decide whether to fix it now.",
      startedAt: "2026-03-10T00:00:00.000Z",
      endedAt: "2026-03-10T00:02:00.000Z",
      command: "codex review --uncommitted",
      sessionId: "11111111-2222-3333-4444-555555555555",
      findingsFile: findingsPath,
      notesFile: notesPath,
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    const copiedArtifactPath = path.join(runDir, "rounds/1/codex-review.md");
    const events = parseEventLog(await readFile(path.join(runDir, EVENTS_FILE_NAME), "utf8"));
    const reportContents = await readFile(
      resolveTrackedReviewContextPath("trace1234", repoRoot),
      "utf8"
    );

    expect(result.artifactPath).toBe(
      "docs/tool-output/rloop-code-fix/trace1234/rounds/1/codex-review.md"
    );
    expect(await readFile(copiedArtifactPath, "utf8")).toBe("# raw review\n");
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "step",
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "issues_found",
      findings: ["[P1] Missing pipefail on review pipeline"],
    });
    expect(reportContents).toContain("## Round Report");
    expect(reportContents).toContain("| 1 | 2m | 2m | n/a | n/a | n/a | 1 | 0 | 0 | 0 | 0 | not_run | Found one real workflow bug. |");
    expect(reportContents).toContain("## Full Timeline");
    expect(reportContents).toContain("### External Review");
    expect(reportContents).toContain("- Duration: `2m`");
    expect(reportContents).toContain("Missing pipefail on review pipeline");
  });

  it("versions retry artifacts while keeping other round destinations strict", async () => {
    const repoRoot = await createTempRoot();
    const rawArtifactPath = path.join(repoRoot, "verify.md");
    await writeFile(rawArtifactPath, "ok\n", "utf8");

    const { runDir } = await initRunArtifacts({
      reviewId: "verify123",
      repoRoot,
    });

    const firstResult = await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "verification/yarn-cq.md",
      title: "Round 1 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 1,
      status: "passed",
      result: "Static checks passed.",
      verificationStatus: "pass_no_applicable_tests",
    });
    const secondResult = await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "verification/yarn-cq.md",
      title: "Round 2 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 2,
      status: "passed",
      result: "Static checks passed again.",
      verificationStatus: "pass_no_applicable_tests",
    });

    expect(firstResult.artifactPath).toBe(
      "docs/tool-output/rloop-code-fix/verify123/verification/yarn-cq.md"
    );
    expect(secondResult.artifactPath).toBe(
      "docs/tool-output/rloop-code-fix/verify123/verification/yarn-cq-attempt-2.md"
    );

    const firstFixResult = await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "rounds/1/main-agent-fix.md",
      title: "Round 1 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 1,
      status: "passed",
      result: "Applied the first same-round fix.",
      fixNow: ["issue one"],
    });
    const secondFixResult = await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "rounds/1/main-agent-fix.md",
      title: "Round 1 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 1,
      status: "passed",
      result: "Applied the retry fix after verification failed.",
      fixNow: ["issue two"],
    });

    expect(firstFixResult.artifactPath).toBe(
      "docs/tool-output/rloop-code-fix/verify123/rounds/1/main-agent-fix.md"
    );
    expect(secondFixResult.artifactPath).toBe(
      "docs/tool-output/rloop-code-fix/verify123/rounds/1/main-agent-fix-attempt-2.md"
    );

    const firstVerifyResult = await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "rounds/1/main-agent-verify.md",
      title: "Round 1 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 1,
      status: "failed",
      result: "First verification attempt failed.",
      verificationStatus: "fail",
    });
    const secondVerifyResult = await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "rounds/1/main-agent-verify.md",
      title: "Round 1 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 1,
      status: "passed",
      result: "Retry verification passed after the same-round fix.",
      verificationStatus: "pass",
    });

    expect(firstVerifyResult.artifactPath).toBe(
      "docs/tool-output/rloop-code-fix/verify123/rounds/1/main-agent-verify.md"
    );
    expect(secondVerifyResult.artifactPath).toBe(
      "docs/tool-output/rloop-code-fix/verify123/rounds/1/main-agent-verify-attempt-2.md"
    );

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "rounds/1/codex-review.md",
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "clean",
    });

    await expect(
      recordRunArtifact({
        runDir,
        repoRoot,
        source: rawArtifactPath,
        destination: "rounds/1/codex-review.md",
        title: "Round 1 / External Review",
        phase: "external_review",
        round: 1,
        status: "clean",
      })
    ).rejects.toThrow("Artifact destination already exists: rounds/1/codex-review.md");
  });

  it("rejects invalid run directories and nested direct-child paths", async () => {
    const repoRoot = await createTempRoot();
    const rawArtifactPath = path.join(repoRoot, "artifact.md");
    await writeFile(rawArtifactPath, "# raw artifact\n", "utf8");

    await expect(
      recordRunArtifact({
        runDir: "../outside-run-dir",
        repoRoot,
        source: rawArtifactPath,
        destination: "rounds/1/codex-review.md",
        title: "Round 1 / External Review",
        status: "blocked",
      })
    ).rejects.toThrow("runDir must be a direct child");

    await expect(
      summarizeRunArtifacts({
        runDir: path.join(resolveRunRoot(repoRoot), "nested-review", "rounds"),
        repoRoot,
      })
    ).rejects.toThrow("runDir must be a direct child");
  });

  it("formats human-readable durations for short and long steps", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(1500)).toBe("1s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(3_661_000)).toBe("1h 1m 1s");
  });

  it("summarizes mixed triage outcomes and no-test verification cleanly", async () => {
    const repoRoot = await createTempRoot();
    const rawArtifactPath = path.join(repoRoot, "artifact.md");
    const triagePath = path.join(repoRoot, "triage.md");
    const fixPath = path.join(repoRoot, "fixes.md");
    const verifyPath = path.join(repoRoot, "verify.md");

    await writeFile(rawArtifactPath, "# artifact\n", "utf8");
    await writeFile(
      triagePath,
      [
        "- [P1] Fix now: missing pipefail on review pipeline",
        "- [P3] Defer: improve follow-up issue formatting in a separate cleanup PR",
        "- [P2] Separate issue: redesign deep review trigger heuristics",
        "- [P3] False positive: reviewer suggested changing wording only",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      fixPath,
      [
        "- [P1] Missing pipefail on review pipeline",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      verifyPath,
      "- Skill-only change; no meaningful app test suite applies beyond static validation.",
      "utf8"
    );

    const { runDir } = await initRunArtifacts({
      reviewId: "mixed123",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "rounds/1/codex-review.md",
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "issues_found",
      purpose: "Review the current diff from a fresh Codex context.",
      result: "Found one real issue plus three lower-priority decisions.",
      startedAt: "2026-03-10T00:00:00.000Z",
      endedAt: "2026-03-10T00:02:00.000Z",
      findings: [
        "[P1] Missing pipefail on review pipeline",
        "[P3] Follow-up issue formatting could be cleaner",
        "[P2] Deep review trigger heuristic is too noisy",
        "[P3] Wording-only suggestion on status line",
      ],
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: triagePath,
      destination: "rounds/1/main-agent-triage.md",
      title: "Round 1 / Main-Agent Triage",
      phase: "main_agent_triage",
      round: 1,
      status: "completed",
      purpose: "Classify which findings to fix, defer, move out of scope, or reject.",
      result: "Chose one fix-now item, one defer, one separate issue suggestion, and one false positive.",
      startedAt: "2026-03-10T00:02:30.000Z",
      endedAt: "2026-03-10T00:05:00.000Z",
      fixNow: ["[P1] Missing pipefail on review pipeline"],
      deferred: ["[P3] Follow-up issue formatting could be cleaned in a later PR because it is non-blocking."],
      separateIssues: ["[P2] Create GitHub issue: redesign deep review trigger heuristics; real issue, but broader than this PR."],
      falsePositives: ["[P3] Ignore wording-only status-line suggestion because it does not affect behavior."],
      notesFile: triagePath,
      timestamp: "2026-03-10T00:05:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: fixPath,
      destination: "rounds/1/main-agent-fix.md",
      title: "Round 1 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 1,
      status: "passed",
      purpose: "Apply the approved fix-now items in the main agent context.",
      result: "Applied the approved workflow fix and left the deferred items untouched.",
      startedAt: "2026-03-10T00:05:30.000Z",
      endedAt: "2026-03-10T00:08:00.000Z",
      fixNow: ["[P1] Missing pipefail on review pipeline"],
      fixesFile: fixPath,
      timestamp: "2026-03-10T00:08:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: verifyPath,
      destination: "rounds/1/main-agent-verify.md",
      title: "Round 1 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 1,
      status: "passed",
      purpose: "Verify the skill rewrite and explain the no-test scope.",
      result: "Validation passed, and no additional app test suite was applicable for this skill-only change.",
      startedAt: "2026-03-10T00:08:30.000Z",
      endedAt: "2026-03-10T00:09:00.000Z",
      verificationStatus: "pass_no_applicable_tests",
      notesFile: verifyPath,
      timestamp: "2026-03-10T00:09:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "rounds/2/codex-review.md",
      title: "Round 2 / External Review",
      phase: "external_review",
      round: 2,
      status: "clean",
      purpose: "Re-review the diff after the round-1 fix and rejection context landed.",
      result: "The latest external review came back clean after the round-1 fix.",
      startedAt: "2026-03-10T00:09:30.000Z",
      endedAt: "2026-03-10T00:10:00.000Z",
      timestamp: "2026-03-10T00:10:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: rawArtifactPath,
      destination: "deep-review/merged-findings.md",
      title: "Deep Review / Merged Findings",
      phase: "deep_review",
      status: "completed",
      result: "Deep review ran after the clean external review and found no additional issues.",
      startedAt: "2026-03-10T00:10:05.000Z",
      endedAt: "2026-03-10T00:10:20.000Z",
      timestamp: "2026-03-10T00:10:20.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Final Summary",
      phase: "final_summary",
      status: "completed",
      result:
        "Clean external review achieved after the round-1 fix; deferred and separate follow-ups remain recorded for later work.",
      notes: [
        "The user can now decide whether to turn the separate-issue follow-up into a GitHub issue.",
      ],
      timestamp: "2026-03-10T00:10:30.000Z",
    });

    const summaryResult = await summarizeRunArtifacts({ runDir, repoRoot });
    const reportContents = await readFile(
      resolveTrackedReviewContextPath("mixed123", repoRoot),
      "utf8"
    );

    expect(summaryResult.reportPath).toBe(
      "docs/run/rloop-code-fix-mixed123.md"
    );
    expect(reportContents).toContain("- Suggested final status: `ready_with_follow_ups`");
    expect(reportContents).toContain("- Latest verification status: `pass_no_applicable_tests`");
    expect(reportContents).toContain("| 1 | 9m | 2m | 2m 30s | 2m 30s | 30s | 4 | 1 | 1 | 1 | 1 | pass_no_applicable_tests | Validation passed, and no additional app test suite was applicable for this skill-only change. |");
    expect(reportContents).toContain("## Deferred in Current PR");
    expect(reportContents).toContain("Round 1: [P3] Follow-up issue formatting could be cleaned in a later PR because it is non-blocking.");
    expect(reportContents).toContain("Round 1: [P2] Create GitHub issue: redesign deep review trigger heuristics; real issue, but broader than this PR.");
    expect(reportContents).toContain("## Known Rejected Findings");
    expect(reportContents).toContain("Round 1: [P3] Ignore wording-only status-line suggestion because it does not affect behavior.");
    expect(reportContents).toContain("### Draft 1: Follow-up from rloop-code-fix: redesign deep review trigger heuristics; real issue, but broader than this PR.");
  });

  it("drops stale follow-ups from the final status after later rounds resolve them", async () => {
    const repoRoot = await createTempRoot();
    const { runDir } = await initRunArtifacts({
      reviewId: "resolve123",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 1 / Main-Agent Triage",
      phase: "main_agent_triage",
      round: 1,
      status: "completed",
      deferred: ["old issue"],
      separateIssues: ["later issue"],
      timestamp: "2026-03-10T00:01:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 2 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 2,
      status: "passed",
      fixNow: ["old issue", "later issue"],
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 2 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 2,
      status: "passed",
      verificationStatus: "pass",
      result: "Resolved the follow-up items.",
      timestamp: "2026-03-10T00:03:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 3 / External Review",
      phase: "external_review",
      round: 3,
      status: "clean",
      result: "The latest external review is clean after the follow-up items were resolved.",
      timestamp: "2026-03-10T00:04:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Deep Review / Merged Findings",
      phase: "deep_review",
      status: "completed",
      result: "Deep review ran after the clean external review and found no additional issues.",
      timestamp: "2026-03-10T00:04:30.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Final Summary",
      phase: "final_summary",
      status: "completed",
      result: "All follow-up items were resolved and the latest external review is clean.",
      timestamp: "2026-03-10T00:05:00.000Z",
    });

    const summaryResult = await summarizeRunArtifacts({ runDir, repoRoot });
    const reportContents = await readFile(
      resolveTrackedReviewContextPath("resolve123", repoRoot),
      "utf8"
    );

    expect(summaryResult.reportPath).toBe(
      "docs/run/rloop-code-fix-resolve123.md"
    );
    expect(reportContents).toContain("- Suggested final status: `ready`");
    expect(reportContents).toContain("## Deferred in Current PR\n- None");
    expect(reportContents).toContain("## Suggested Separate Issues\n- None");
    expect(reportContents).not.toContain("Round 1: old issue");
    expect(reportContents).not.toContain("Round 1: later issue");
  });

  it("keeps deferred follow-ups visible until a main-agent fix step actually resolves them", async () => {
    const repoRoot = await createTempRoot();
    const { runDir } = await initRunArtifacts({
      reviewId: "triagefix",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 1 / Main-Agent Triage",
      phase: "main_agent_triage",
      round: 1,
      status: "completed",
      deferred: ["shared issue"],
      timestamp: "2026-03-10T00:01:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 2 / Main-Agent Triage",
      phase: "main_agent_triage",
      round: 2,
      status: "completed",
      fixNow: ["shared issue"],
      result: "Promoted the same issue into the fix-now queue, but no fix has landed yet.",
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      title: "Round 2 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 2,
      status: "passed",
      verificationStatus: "pass_no_applicable_tests",
      result: "Only triage changed; no implementation resolution has been recorded yet.",
      timestamp: "2026-03-10T00:03:00.000Z",
    });

    await summarizeRunArtifacts({ runDir, repoRoot });

    const reportContents = await readFile(
      resolveTrackedReviewContextPath("triagefix", repoRoot),
      "utf8"
    );

    expect(reportContents).toContain("- Suggested final status: `in_progress`");
    expect(reportContents).toContain("## Deferred in Current PR");
    expect(reportContents).toContain("Round 1: shared issue");
  });

  it("aggregates per-phase round durations across same-round retry attempts", async () => {
    const repoRoot = await createTempRoot();
    const artifactPath = path.join(repoRoot, "artifact.md");
    await writeFile(artifactPath, "# artifact\n", "utf8");

    const { runDir } = await initRunArtifacts({
      reviewId: "attempts123",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/codex-review.md",
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "issues_found",
      result: "Found one issue.",
      findings: ["issue one"],
      startedAt: "2026-03-10T00:00:00.000Z",
      endedAt: "2026-03-10T00:02:00.000Z",
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/main-agent-triage.md",
      title: "Round 1 / Main-Agent Triage",
      phase: "main_agent_triage",
      round: 1,
      status: "completed",
      result: "Marked one issue fix_now.",
      fixNow: ["issue one"],
      startedAt: "2026-03-10T00:02:00.000Z",
      endedAt: "2026-03-10T00:03:00.000Z",
      timestamp: "2026-03-10T00:03:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/main-agent-fix.md",
      title: "Round 1 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 1,
      status: "passed",
      result: "Applied the first fix attempt.",
      fixNow: ["issue one"],
      startedAt: "2026-03-10T00:03:00.000Z",
      endedAt: "2026-03-10T00:04:00.000Z",
      timestamp: "2026-03-10T00:04:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/main-agent-verify.md",
      title: "Round 1 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 1,
      status: "failed",
      result: "First verify attempt failed.",
      verificationStatus: "fail",
      startedAt: "2026-03-10T00:04:00.000Z",
      endedAt: "2026-03-10T00:04:30.000Z",
      timestamp: "2026-03-10T00:04:30.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/main-agent-fix.md",
      title: "Round 1 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 1,
      status: "passed",
      result: "Applied the retry fix attempt.",
      fixNow: ["issue two"],
      startedAt: "2026-03-10T00:04:30.000Z",
      endedAt: "2026-03-10T00:06:00.000Z",
      timestamp: "2026-03-10T00:06:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/main-agent-verify.md",
      title: "Round 1 / Main-Agent Verify",
      phase: "main_agent_verify",
      round: 1,
      status: "passed",
      result: "Retry verify passed.",
      verificationStatus: "pass",
      startedAt: "2026-03-10T00:06:00.000Z",
      endedAt: "2026-03-10T00:06:20.000Z",
      timestamp: "2026-03-10T00:06:20.000Z",
    });

    await summarizeRunArtifacts({ runDir, repoRoot });
    const reportContents = await readFile(
      resolveTrackedReviewContextPath("attempts123", repoRoot),
      "utf8"
    );

    expect(reportContents).toContain("| 1 | 6m 20s | 2m | 1m | 2m 30s | 50s | 1 | 2 | 0 | 0 | 0 | pass | Retry verify passed. |");
  });

  it("renders the canonical process timeline in event order when a round resumes after deep review", async () => {
    const repoRoot = await createTempRoot();
    const artifactPath = path.join(repoRoot, "artifact.md");
    await writeFile(artifactPath, "# artifact\n", "utf8");

    const { runDir } = await initRunArtifacts({
      reviewId: "traceorder123",
      repoRoot,
      startedAt: "2026-03-10T00:00:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/codex-review.md",
      title: "Round 1 / External Review",
      phase: "external_review",
      round: 1,
      status: "issues_found",
      result: "Found one issue.",
      findings: ["issue one"],
      timestamp: "2026-03-10T00:01:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/main-agent-fix.md",
      title: "Round 1 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 1,
      status: "passed",
      result: "Applied the first fix.",
      fixNow: ["issue one"],
      timestamp: "2026-03-10T00:02:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "deep-review/merged-findings.md",
      title: "Deep Review / Merged Findings",
      phase: "deep_review",
      status: "completed",
      result: "Deep review finished between fix attempts.",
      timestamp: "2026-03-10T00:03:00.000Z",
    });

    await recordRunArtifact({
      runDir,
      repoRoot,
      source: artifactPath,
      destination: "rounds/1/main-agent-fix.md",
      title: "Round 1 / Main-Agent Fix",
      phase: "main_agent_fix",
      round: 1,
      status: "passed",
      result: "Applied the retry fix after deep review.",
      fixNow: ["issue two"],
      timestamp: "2026-03-10T00:04:00.000Z",
    });

    const reportContents = await readFile(
      resolveTrackedReviewContextPath("traceorder123", repoRoot),
      "utf8"
    );
    const timelineContents = reportContents.slice(
      reportContents.indexOf("## Full Timeline")
    );
    const deepReviewIndex = timelineContents.indexOf(
      "Deep review finished between fix attempts."
    );
    const retryFixIndex = timelineContents.indexOf(
      "Applied the retry fix after deep review."
    );

    expect(deepReviewIndex).toBeGreaterThan(-1);
    expect(retryFixIndex).toBeGreaterThan(-1);
    expect(deepReviewIndex).toBeLessThan(retryFixIndex);
  });

  it("marks the run blocked when the latest verification fails", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_verify",
          verificationStatus: "fail",
          status: "failed",
        },
      ])
    ).toBe("blocked");
  });

  it("marks the run as needing a user decision when the latest step is a review with real issues", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "external_review",
          status: "issues_found",
        },
      ])
    ).toBe("in_progress");
  });

  it("marks the run as needing a user decision when triage or closeout explicitly asks the user", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_triage",
          status: "needs_user_decision",
        },
      ])
    ).toBe("needs_user_decision");

    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "final_summary",
          status: "needs_user_decision",
        },
      ])
    ).toBe("needs_user_decision");
  });

  it("marks the run stopped when the user closes the batch without continuing", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "external_review",
          status: "issues_found",
        },
        {
          phase: "main_agent_triage",
          status: "completed",
          falsePositives: ["legacy compatibility"],
        },
        {
          phase: "final_summary",
          status: "stopped",
        },
      ])
    ).toBe("stopped");
  });

  it("marks the run as needing a user decision when the latest external review is stalled", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "external_review",
          status: "stalled",
        },
      ])
    ).toBe("needs_user_decision");
  });

  it("does not report ready when newer work was recorded after the last passing verification", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "main_agent_fix",
          status: "passed",
        },
      ])
    ).toBe("in_progress");
  });

  it("requires a clean latest external review, deep review, and completed closeout before reporting ready", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "external_review",
          status: "clean",
        },
      ])
    ).toBe("in_progress");

    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "external_review",
          status: "clean",
        },
        {
          phase: "deep_review",
          status: "completed",
          result: "Deep review finished with no issues.",
        },
        {
          phase: "final_summary",
          status: "completed",
        },
      ])
    ).toBe("ready");
  });

  it("reports ready_with_follow_ups when clean closeout completes with separate issues", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_triage",
          status: "completed",
          separateIssues: ["follow-up issue"],
        },
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "external_review",
          status: "clean",
        },
        {
          phase: "deep_review",
          status: "completed",
          result: "Deep review finished with no issues.",
        },
        {
          phase: "final_summary",
          status: "completed",
        },
      ])
    ).toBe("ready_with_follow_ups");
  });

  it("keeps the run in progress until the mandatory deep review has run", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "external_review",
          status: "clean",
        },
        {
          phase: "final_summary",
          status: "completed",
        },
      ])
    ).toBe("in_progress");
  });

  it("marks the run blocked when deep review happened before any clean external review", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "deep_review",
          status: "completed",
          result: "Deep review happened too early.",
        },
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "external_review",
          status: "clean",
        },
        {
          phase: "final_summary",
          status: "completed",
        },
      ])
    ).toBe("blocked");
  });

  it("allows ready when deep review happened after an earlier clean review and a later clean review closed the run", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "external_review",
          status: "clean",
        },
        {
          phase: "deep_review",
          status: "completed",
          result: "Deep review finished with no issues.",
        },
        {
          phase: "main_agent_fix",
          status: "passed",
        },
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "external_review",
          status: "clean",
        },
        {
          phase: "final_summary",
          status: "completed",
        },
      ])
    ).toBe("ready");
  });

  it("marks the run blocked when a fix round advances without a later same-round verify", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_fix",
          round: 1,
          status: "passed",
        },
        {
          phase: "external_review",
          round: 2,
          status: "clean",
        },
        {
          phase: "final_summary",
          status: "completed",
        },
      ])
    ).toBe("blocked");
  });

  it("marks the run blocked when completed closeout is recorded before the latest clean external review", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "final_summary",
          status: "completed",
        },
        {
          phase: "external_review",
          status: "clean",
        },
      ])
    ).toBe("blocked");
  });

  it("keeps the run in progress when deep review finds real issues after the latest clean external review", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "external_review",
          status: "clean",
        },
        {
          phase: "deep_review",
          status: "completed",
          separateIssues: ["follow-up issue"],
        },
        {
          phase: "final_summary",
          status: "completed",
        },
      ])
    ).toBe("in_progress");
  });

  it("allows ready when post-clean deep review records only false positives", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "external_review",
          status: "clean",
        },
        {
          phase: "deep_review",
          status: "completed",
          falsePositives: ["not a bug because invariant"],
        },
        {
          phase: "final_summary",
          status: "completed",
        },
      ])
    ).toBe("ready");
  });

  it("preserves a passing verify across later no-op review rounds", () => {
    expect(
      deriveSuggestedFinalStatus([
        {
          phase: "main_agent_verify",
          verificationStatus: "pass",
          status: "passed",
        },
        {
          phase: "external_review",
          round: 2,
          status: "issues_found",
        },
        {
          phase: "main_agent_triage",
          round: 2,
          status: "completed",
          falsePositives: ["not real"],
          deferred: ["keep for later"],
        },
        {
          phase: "external_review",
          round: 3,
          status: "clean",
        },
        {
          phase: "deep_review",
          status: "completed",
          result: "Deep review finished with no issues.",
        },
        {
          phase: "final_summary",
          status: "completed",
        },
      ])
    ).toBe("ready_with_follow_ups");
  });
});
