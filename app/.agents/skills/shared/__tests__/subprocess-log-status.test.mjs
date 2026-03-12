import os from "os";
import path from "path";
import { appendFile, mkdtemp, rm, writeFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveProgressState,
  getSubprocessLogStatus,
  tailTextLines,
} from "../scripts/subprocess-log-status.mjs";

const execFileAsync = promisify(execFile);
const tempRoots = [];
const helperPath = path.resolve(
  process.cwd(),
  ".agents/skills/shared/scripts/subprocess-log-status.mjs"
);

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "shared-subprocess-log-status-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("subprocess-log-status", () => {
  it("returns missing status for a log that does not exist", async () => {
    const repoRoot = await createTempRoot();
    const logPath = path.join(repoRoot, "missing.log");

    const status = await getSubprocessLogStatus({
      logPath,
      now: new Date("2026-03-10T00:00:00.000Z"),
    });

    expect(status).toEqual({
      exists: false,
      sizeBytes: 0,
      updatedAt: null,
      secondsSinceUpdate: null,
      tail: "",
      changedSinceBaseline: null,
      progressState: "missing",
    });
  });

  it("tails the most recent lines and detects idle vs progressed states", async () => {
    const repoRoot = await createTempRoot();
    const logPath = path.join(repoRoot, "review.log");

    await writeFile(logPath, "line 1\nline 2\nline 3\n", "utf8");

    const firstStatus = await getSubprocessLogStatus({
      logPath,
      tail: 2,
      now: new Date(Date.now() + 5000),
    });

    expect(firstStatus.exists).toBe(true);
    expect(firstStatus.tail).toBe("line 2\nline 3");
    expect(firstStatus.progressState).toBe("unknown");

    const idleStatus = await getSubprocessLogStatus({
      logPath,
      tail: 2,
      now: new Date(Date.now() + 10000),
      baselineSizeBytes: firstStatus.sizeBytes,
      baselineUpdatedAt: firstStatus.updatedAt,
    });

    expect(idleStatus.progressState).toBe("idle");
    expect(idleStatus.changedSinceBaseline).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 25));
    await appendFile(logPath, "line 4\n", "utf8");

    const progressedStatus = await getSubprocessLogStatus({
      logPath,
      tail: 2,
      now: new Date(Date.now() + 15000),
      baselineSizeBytes: firstStatus.sizeBytes,
      baselineUpdatedAt: firstStatus.updatedAt,
    });

    expect(progressedStatus.tail).toBe("line 3\nline 4");
    expect(progressedStatus.progressState).toBe("progressed");
    expect(progressedStatus.changedSinceBaseline).toBe(true);
  });

  it("returns the tail from a large log without needing the full file contents", async () => {
    const repoRoot = await createTempRoot();
    const logPath = path.join(repoRoot, "large-review.log");
    const largePrefix = `${"x".repeat(20_000)}\n${"y".repeat(20_000)}\n`;
    await writeFile(logPath, `${largePrefix}tail 1\ntail 2\ntail 3\n`, "utf8");

    const status = await getSubprocessLogStatus({
      logPath,
      tail: 2,
      now: new Date("2026-03-10T00:00:10.000Z"),
    });

    expect(status.tail).toBe("tail 2\ntail 3");
    expect(status.progressState).toBe("unknown");
  });

  it("outputs JSON only from the CLI on success", async () => {
    const repoRoot = await createTempRoot();
    const logPath = path.join(repoRoot, "review.log");
    await writeFile(logPath, "alpha\nbeta\ngamma\n", "utf8");

    const { stdout, stderr } = await execFileAsync("node", [
      helperPath,
      "--log",
      logPath,
      "--tail",
      "1",
    ]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      exists: true,
      progressState: "unknown",
      tail: "gamma",
    });
  });

  it("flushes stderr when the CLI exits with an argument error", async () => {
    await expect(execFileAsync("node", [helperPath])).rejects.toMatchObject({
      code: 1,
      stderr: "--log is required\n",
      stdout: "",
    });
  });

  it("returns JSON through the callback-based execFile API", async () => {
    const repoRoot = await createTempRoot();
    const logPath = path.join(repoRoot, "review.log");
    await writeFile(logPath, "delta\nepsilon\n", "utf8");

    const result = await new Promise((resolve, reject) => {
      execFile(
        "node",
        [helperPath, "--log", logPath, "--tail", "1"],
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({ stdout, stderr });
        }
      );
    });

    expect(result).toEqual({
      stdout:
        expect.stringContaining('"tail":"epsilon"'),
      stderr: "",
    });
  });

  it("keeps the helper-only state logic simple and explicit", () => {
    expect(
      deriveProgressState({
        exists: true,
        sizeBytes: 10,
        updatedAt: "2026-03-10T00:00:00.000Z",
      })
    ).toBe("unknown");
    expect(
      deriveProgressState({
        exists: true,
        sizeBytes: 10,
        updatedAt: "2026-03-10T00:00:00.000Z",
        baselineSizeBytes: 10,
        baselineUpdatedAt: "2026-03-10T00:00:00.000Z",
      })
    ).toBe("idle");
    expect(
      deriveProgressState({
        exists: true,
        sizeBytes: 12,
        updatedAt: "2026-03-10T00:05:00.000Z",
        baselineSizeBytes: 10,
        baselineUpdatedAt: "2026-03-10T00:00:00.000Z",
      })
    ).toBe("progressed");
    expect(
      deriveProgressState({
        exists: true,
        sizeBytes: 10,
        updatedAt: "2026-03-10T00:00:00.000Z",
        baselineSizeBytes: 10,
      })
    ).toBe("idle");
    expect(
      deriveProgressState({
        exists: true,
        sizeBytes: 10,
        updatedAt: "2026-03-10T00:00:00.000Z",
        baselineUpdatedAt: "2026-03-10T00:00:00.000Z",
      })
    ).toBe("idle");
    expect(
      tailTextLines("one\ntwo\nthree\n", 2)
    ).toBe("two\nthree");
  });
});
