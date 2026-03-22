import { execFileSync } from "child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  type Dirent,
} from "fs";
import { basename, dirname, join, relative } from "path";
import { homedir } from "os";

const TAG = "[WorktreeManager]";
const BASE_DIR = join(homedir(), "Projects", ".agenthub-tasks");
const LOCAL_TIMEOUT = 10_000;
const REMOTE_TIMEOUT = 60_000;

export interface MergeResult {
  success: boolean;
  conflicts: { file: string; agents: string[] }[];
  mergedPath: string;
}

/**
 * Check if project is a git repo.
 */
export function isGitProject(projectPath: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: projectPath,
      timeout: LOCAL_TIMEOUT,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create an isolated workspace for an agent.
 * - Git projects: creates a git worktree.
 * - Non-git projects: copies project to a temp folder.
 */
export function createWorkspace(
  taskId: string,
  agentRole: string,
  projectPath: string
): string {
  const workDir = join(BASE_DIR, taskId, agentRole);

  if (isGitProject(projectPath)) {
    return createGitWorktree(taskId, agentRole, projectPath, workDir);
  }

  return createCopyWorkspace(projectPath, workDir);
}

/**
 * Merge all agent workspaces back.
 * - Git projects: merge each worktree branch into the task branch sequentially.
 * - Non-git projects: copy modified files into a merged folder with conflict detection.
 */
export function mergeWorkspaces(
  taskId: string,
  agentRoles: string[],
  projectPath: string
): MergeResult {
  const mergedPath = join(BASE_DIR, taskId, "_merged");

  if (isGitProject(projectPath)) {
    return mergeGitWorkspaces(taskId, agentRoles, projectPath, mergedPath);
  }

  return mergeNonGitWorkspaces(taskId, agentRoles, projectPath, mergedPath);
}

/**
 * Cleanup all workspaces for a task.
 * - Git projects: remove worktrees and delete branches.
 * - Non-git projects: remove the task folder.
 */
export function cleanupWorkspaces(
  taskId: string,
  projectPath: string
): void {
  const taskDir = join(BASE_DIR, taskId);
  const isGit = isGitProject(projectPath);

  if (isGit) {
    cleanupGitWorktrees(taskId, taskDir, projectPath);
  }

  if (existsSync(taskDir)) {
    try {
      rmSync(taskDir, { recursive: true, force: true });
      console.info(`${TAG} Cleaned up task directory: ${taskDir}`);
    } catch (err) {
      console.error(`${TAG} Failed to remove task directory ${taskDir}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function branchName(taskId: string, agentRole: string): string {
  return `task/${taskId.slice(0, 12)}-${agentRole}`;
}

function gitExec(
  args: string[],
  cwd: string,
  timeout: number = LOCAL_TIMEOUT
): string {
  return execFileSync("git", args, {
    cwd,
    timeout,
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();
}

function shouldExclude(src: string): boolean {
  const name = basename(src);
  return name === "node_modules" || name === ".git";
}

function createGitWorktree(
  taskId: string,
  agentRole: string,
  projectPath: string,
  workDir: string
): string {
  const branch = branchName(taskId, agentRole);

  try {
    mkdirSync(dirname(workDir), { recursive: true });

    // Clean up stale branch/worktree from previous failed execution
    try { gitExec(["worktree", "remove", workDir, "--force"], projectPath); } catch { /* may not exist */ }
    try { gitExec(["branch", "-D", branch], projectPath); } catch { /* may not exist */ }
    if (existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }

    // Create worktree with a new branch based on HEAD
    gitExec(
      ["worktree", "add", "-b", branch, workDir, "HEAD"],
      projectPath
    );

    console.info(
      `${TAG} Created git worktree for ${agentRole} at ${workDir} (branch: ${branch})`
    );
    return workDir;
  } catch (err) {
    console.error(
      `${TAG} Failed to create git worktree for ${agentRole}:`,
      err
    );
    throw err;
  }
}

function createCopyWorkspace(projectPath: string, workDir: string): string {
  try {
    mkdirSync(workDir, { recursive: true });

    cpSync(projectPath, workDir, {
      recursive: true,
      filter: (src: string) => !shouldExclude(src),
    });

    console.info(`${TAG} Created copy workspace at ${workDir}`);
    return workDir;
  } catch (err) {
    console.error(`${TAG} Failed to create copy workspace at ${workDir}:`, err);
    throw err;
  }
}

function mergeGitWorkspaces(
  taskId: string,
  agentRoles: string[],
  projectPath: string,
  _mergedPath: string
): MergeResult {
  const conflicts: MergeResult["conflicts"] = [];
  const taskBranch = `task/${taskId.slice(0, 12)}`;

  try {
    // Create and checkout a task branch for merging
    try {
      gitExec(["branch", taskBranch, "HEAD"], projectPath);
    } catch {
      // Branch may already exist — that is fine
    }

    gitExec(["checkout", taskBranch], projectPath);

    for (const role of agentRoles) {
      const branch = branchName(taskId, role);

      try {
        const result = gitExec(
          ["merge", "--no-ff", branch, "-m", `Merge ${role} work`],
          projectPath,
          REMOTE_TIMEOUT
        );
        console.info(`${TAG} Merged branch ${branch}: ${result}`);
      } catch (err) {
        console.error(`${TAG} Merge conflict on branch ${branch}:`, err);

        // Collect conflicted files
        try {
          const diffOutput = gitExec(
            ["diff", "--name-only", "--diff-filter=U"],
            projectPath
          );
          const conflictedFiles = diffOutput
            .split("\n")
            .filter((f) => f.length > 0);

          for (const file of conflictedFiles) {
            const existing = conflicts.find((c) => c.file === file);
            if (existing) {
              existing.agents.push(role);
            } else {
              conflicts.push({ file, agents: [role] });
            }
          }
        } catch (diffErr) {
          console.error(
            `${TAG} Failed to list conflicted files:`,
            diffErr
          );
        }

        // Abort the failed merge so subsequent merges can proceed
        try {
          gitExec(["merge", "--abort"], projectPath);
        } catch {
          // Abort may fail if there is no merge in progress
        }
      }
    }

    return {
      success: conflicts.length === 0,
      conflicts,
      mergedPath: projectPath,
    };
  } catch (err) {
    console.error(`${TAG} Git merge workflow failed:`, err);
    return { success: false, conflicts, mergedPath: projectPath };
  }
}

function mergeNonGitWorkspaces(
  taskId: string,
  agentRoles: string[],
  projectPath: string,
  mergedPath: string
): MergeResult {
  const conflicts: MergeResult["conflicts"] = [];

  // Track file -> agents that modified it
  const fileModifications = new Map<string, string[]>();

  try {
    // Start with a clean copy of the original project
    mkdirSync(mergedPath, { recursive: true });
    cpSync(projectPath, mergedPath, {
      recursive: true,
      filter: (src: string) => !shouldExclude(src),
    });

    // Collect original file mtimes for comparison
    const originalMtimes = collectMtimes(projectPath);

    for (const role of agentRoles) {
      const agentDir = join(BASE_DIR, taskId, role);

      if (!existsSync(agentDir)) {
        console.error(`${TAG} Agent workspace not found: ${agentDir}`);
        continue;
      }

      const agentMtimes = collectMtimes(agentDir);

      agentMtimes.forEach((agentMtime, relativePath) => {
        const originalMtime = originalMtimes.get(relativePath);

        // File is new or was modified (mtime differs from original)
        const isModified =
          originalMtime === undefined || agentMtime > originalMtime;

        if (!isModified) {
          return;
        }

        const agents = fileModifications.get(relativePath);
        if (agents) {
          agents.push(role);
        } else {
          fileModifications.set(relativePath, [role]);
        }

        // Copy modified file into merged folder (last writer wins for now)
        const srcFile = join(agentDir, relativePath);
        const destFile = join(mergedPath, relativePath);
        mkdirSync(dirname(destFile), { recursive: true });
        cpSync(srcFile, destFile);
      });
    }

    // Detect conflicts: files modified by 2+ agents
    fileModifications.forEach((agents, file) => {
      if (agents.length > 1) {
        conflicts.push({ file, agents });
      }
    });

    console.info(
      `${TAG} Non-git merge complete. ${fileModifications.size} file(s) merged, ${conflicts.length} conflict(s).`
    );

    return {
      success: conflicts.length === 0,
      conflicts,
      mergedPath,
    };
  } catch (err) {
    console.error(`${TAG} Non-git merge failed:`, err);
    return { success: false, conflicts, mergedPath };
  }
}

function collectMtimes(dir: string): Map<string, number> {
  const mtimes = new Map<string, number>();

  function walk(current: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }

      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = statSync(fullPath);
          const relativePath = relative(dir, fullPath);
          mtimes.set(relativePath, stat.mtimeMs);
        } catch {
          // Skip files we cannot stat
        }
      }
    }
  }

  walk(dir);
  return mtimes;
}

function cleanupGitWorktrees(
  taskId: string,
  taskDir: string,
  projectPath: string
): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(taskDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue;
    }

    const agentRole = entry.name;
    const worktreePath = join(taskDir, agentRole);
    const branch = branchName(taskId, agentRole);

    // Remove worktree
    try {
      gitExec(
        ["worktree", "remove", worktreePath, "--force"],
        projectPath
      );
      console.info(`${TAG} Removed worktree: ${worktreePath}`);
    } catch (err) {
      console.error(
        `${TAG} Failed to remove worktree ${worktreePath}:`,
        err
      );
    }

    // Delete branch
    try {
      gitExec(["branch", "-D", branch], projectPath);
      console.info(`${TAG} Deleted branch: ${branch}`);
    } catch (err) {
      console.error(`${TAG} Failed to delete branch ${branch}:`, err);
    }
  }

  // Also clean up the task merge branch
  const taskBranch = `task/${taskId.slice(0, 12)}`;
  try {
    gitExec(["branch", "-D", taskBranch], projectPath);
  } catch {
    // May not exist
  }
}
