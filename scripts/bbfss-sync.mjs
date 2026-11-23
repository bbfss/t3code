#!/usr/bin/env node
/**
 * Upstream sync & patch helper for the bbfss/t3code fork.
 *
 * Branch contract:
 *   - `main`  : clean fast-forward mirror of upstream `pingdotgg/t3code:main` (never commit bbfss edits here)
 *   - `bbfss` : long-lived fork mainline carrying bbfss customizations
 *
 * Usage:
 *   node scripts/bbfss-sync.mjs [--push] [--rebase] [--export-patch] [--dry-run]
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

const UPSTREAM_REMOTE = "upstream";
const UPSTREAM_URL = "https://github.com/pingdotgg/t3code.git";
const UPSTREAM_BRANCH = "main";
const FORK_BRANCH = "bbfss";
const GENERATED_ROUTE_TREE = "apps/web/src/routeTree.gen.ts";

const args = new Set(NodeProcess.argv.slice(2));
const shouldPush = args.has("--push");
const useRebase = args.has("--rebase");
const exportPatch = args.has("--export-patch");
const dryRun = args.has("--dry-run");

if (args.has("--help") || args.has("-h")) {
  console.log(
    [
      "Usage: node scripts/bbfss-sync.mjs [options]",
      "",
      "Options:",
      "  --push          Push updated main and bbfss branches to origin",
      "  --rebase        Rebase bbfss onto updated main instead of merging",
      "  --export-patch  Export commits in main..HEAD into bbfss-patches/ via git format-patch",
      "  --dry-run       Print git commands without executing them",
    ].join("\n"),
  );
  NodeProcess.exit(0);
}

function run(command, commandArgs, options = {}) {
  const printable = `${command} ${commandArgs.join(" ")}`;
  if (dryRun) {
    console.log(`[dry-run] ${printable}`);
    return { status: 0, stdout: "", stderr: "" };
  }
  const result = NodeChildProcess.spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (!options.allowFailure && result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : "";
    throw new Error(`Command failed (${result.status}): ${printable}${detail}`);
  }
  return result;
}

function capture(command, commandArgs, allowFailure = false) {
  return run(command, commandArgs, { capture: true, allowFailure });
}

function ensureCleanWorktree() {
  if (dryRun) return;
  const status = capture("git", ["status", "--porcelain"]).stdout.trim();
  if (status.length > 0) {
    throw new Error(
      "Working tree has uncommitted changes. Commit or stash them before syncing upstream.",
    );
  }
}

function ensureUpstreamRemote() {
  const existing = capture("git", ["remote", "get-url", UPSTREAM_REMOTE], true);
  if (existing.status !== 0) {
    console.log(`Adding remote '${UPSTREAM_REMOTE}' -> ${UPSTREAM_URL}`);
    run("git", ["remote", "add", UPSTREAM_REMOTE, UPSTREAM_URL]);
  }
}

function exportPatchSeries() {
  const outDir = NodePath.resolve("bbfss-patches");
  if (!dryRun) {
    NodeFS.rmSync(outDir, { recursive: true, force: true });
    NodeFS.mkdirSync(outDir, { recursive: true });
  }
  run("git", ["format-patch", "-o", outDir, `${UPSTREAM_BRANCH}..HEAD`]);
  console.log(`Exported bbfss patch series to ${outDir}`);
}

function main() {
  const startBranch = dryRun
    ? FORK_BRANCH
    : capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();

  if (exportPatch) {
    exportPatchSeries();
    return;
  }

  ensureCleanWorktree();
  ensureUpstreamRemote();

  console.log(`1/4 Fetching ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}...`);
  run("git", ["fetch", UPSTREAM_REMOTE, UPSTREAM_BRANCH]);

  console.log(`2/4 Fast-forwarding local '${UPSTREAM_BRANCH}'...`);
  const hasLocalMain = dryRun || capture("git", ["rev-parse", "--verify", UPSTREAM_BRANCH], true).status === 0;
  if (hasLocalMain) {
    run("git", ["checkout", UPSTREAM_BRANCH]);
    run("git", ["merge", "--ff-only", `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`]);
  } else {
    run("git", ["checkout", "-b", UPSTREAM_BRANCH, `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`]);
  }

  console.log(`3/4 Updating '${FORK_BRANCH}' from '${UPSTREAM_BRANCH}'...`);
  run("git", ["checkout", FORK_BRANCH]);
  const updateArgs = useRebase
    ? ["rebase", UPSTREAM_BRANCH]
    : ["merge", "--no-edit", UPSTREAM_BRANCH];
  const updateResult = run("git", updateArgs, { allowFailure: true });

  if (!dryRun && updateResult.status !== 0) {
    const conflicts = capture("git", ["diff", "--name-only", "--diff-filter=U"])
      .stdout.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (conflicts.length === 1 && conflicts[0] === GENERATED_ROUTE_TREE) {
      console.log(
        `Only generated file '${GENERATED_ROUTE_TREE}' conflicted. Taking upstream copy; run web build/dev once to regenerate routeTree.gen.ts, then stage and complete the merge/rebase.`,
      );
      run("git", ["checkout", "--theirs", GENERATED_ROUTE_TREE]);
    } else {
      console.error("\nUpstream sync paused with conflicts in:");
      for (const file of conflicts) {
        console.error(`  - ${file}`);
      }
      console.error(
        "\nAll bbfss code is isolated under apps/web/src/bbfss/. Resolve the thin hook points above and continue.",
      );
    }
    NodeProcess.exit(1);
  }

  if (shouldPush) {
    console.log("4/4 Pushing updated branches to origin...");
    run("git", ["push", "origin", UPSTREAM_BRANCH]);
    run("git", ["push", ...(useRebase ? ["--force-with-lease"] : []), "origin", FORK_BRANCH]);
  } else {
    console.log("4/4 Sync complete locally. Re-run with --push to push main and bbfss to origin.");
  }

  if (startBranch && startBranch !== FORK_BRANCH && startBranch !== UPSTREAM_BRANCH) {
    console.log(`Note: you started on '${startBranch}'. Current branch is '${FORK_BRANCH}'.`);
  }
}

main();
