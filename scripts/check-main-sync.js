const { spawnSync } = require("node:child_process");

function runGit(args, options = {}) {
  return spawnSync("git", args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.env.SKIP_MAIN_SYNC_CHECK === "1") {
  console.log("[predev] Skipping latest-main sync check because SKIP_MAIN_SYNC_CHECK=1.");
  process.exit(0);
}

const insideRepo = runGit(["rev-parse", "--is-inside-work-tree"]);
if (insideRepo.status !== 0 || insideRepo.stdout.trim() !== "true") {
  console.log("[predev] Git worktree not detected. Skipping latest-main sync check.");
  process.exit(0);
}

const remoteCheck = runGit(["remote", "get-url", "origin"]);
if (remoteCheck.status !== 0) {
  console.log("[predev] No origin remote configured. Skipping latest-main sync check.");
  process.exit(0);
}

const fetchResult = runGit(["fetch", "origin", "--quiet"]);
if (fetchResult.status !== 0) {
  fail(
    [
      "[predev] Could not verify latest origin/main state.",
      fetchResult.stderr.trim() || fetchResult.stdout.trim() || "git fetch origin failed.",
      "Resolve network/git access or bypass once with SKIP_MAIN_SYNC_CHECK=1."
    ].join("\n")
  );
}

const branchResult = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
const branch = branchResult.status === 0 ? branchResult.stdout.trim() : "HEAD";

const containsMainResult = runGit(["merge-base", "--is-ancestor", "origin/main", "HEAD"], {
  stdio: "ignore"
});

if (containsMainResult.status === 0) {
  console.log(`[predev] ${branch} already includes the latest origin/main.`);
  process.exit(0);
}

const divergenceResult = runGit(["rev-list", "--left-right", "--count", "HEAD...origin/main"]);
const [aheadRaw, behindRaw] = (divergenceResult.stdout || "").trim().split(/\s+/);
const ahead = Number(aheadRaw || "0");
const behind = Number(behindRaw || "0");

const guidance =
  branch === "main"
    ? behind > 0 && ahead === 0
      ? "Run: git pull --ff-only origin main"
      : "Run: git fetch origin && git rebase origin/main"
    : "Run: git fetch origin && git rebase origin/main";

fail(
  [
    `[predev] ${branch} does not include the latest origin/main.`,
    `Local-only commits: ${ahead}. Missing remote commits: ${behind}.`,
    guidance,
    "If you intentionally need to bypass once, set SKIP_MAIN_SYNC_CHECK=1."
  ].join("\n")
);
