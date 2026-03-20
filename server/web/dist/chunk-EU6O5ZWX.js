// src/lib/scanner.ts
import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join, basename } from "path";
var SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
  ".vscode",
  ".idea",
  "__pycache__",
  "target",
  "bin",
  "obj",
  ".output"
]);
function detectStack(projectPath) {
  const stack = [];
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      };
      if (allDeps["typescript"] || existsSync(join(projectPath, "tsconfig.json"))) {
        stack.push("typescript");
      }
      if (allDeps["react"] || allDeps["react-dom"]) stack.push("react");
      if (allDeps["vue"]) stack.push("vue");
      if (allDeps["@angular/core"]) stack.push("angular");
      if (allDeps["next"]) stack.push("nextjs");
      if (allDeps["nuxt"] || allDeps["nuxt3"]) stack.push("nuxt");
      if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) stack.push("svelte");
      if (allDeps["express"]) stack.push("express");
      if (allDeps["fastify"]) stack.push("fastify");
      if (allDeps["nestjs"] || allDeps["@nestjs/core"]) stack.push("nestjs");
      if (allDeps["tailwindcss"]) stack.push("tailwind");
      if (allDeps["prisma"] || allDeps["@prisma/client"]) stack.push("prisma");
      if (allDeps["drizzle-orm"]) stack.push("drizzle");
      if (allDeps["vite"]) stack.push("vite");
      if (stack.length === 0) stack.push("node");
    } catch {
      stack.push("node");
    }
  }
  if (existsSync(join(projectPath, "go.mod"))) stack.push("go");
  if (existsSync(join(projectPath, "Cargo.toml"))) stack.push("rust");
  if (existsSync(join(projectPath, "requirements.txt")) || existsSync(join(projectPath, "pyproject.toml")) || existsSync(join(projectPath, "setup.py"))) {
    stack.push("python");
  }
  if (existsSync(join(projectPath, "pom.xml"))) stack.push("java-maven");
  if (existsSync(join(projectPath, "build.gradle")) || existsSync(join(projectPath, "build.gradle.kts"))) {
    stack.push("java-gradle");
  }
  const hasSln = readdirSync(projectPath).some((f) => f.endsWith(".sln"));
  const hasCsproj = readdirSync(projectPath).some((f) => f.endsWith(".csproj"));
  if (hasSln || hasCsproj) stack.push("dotnet");
  if (existsSync(join(projectPath, "composer.json"))) stack.push("php");
  if (existsSync(join(projectPath, "Gemfile"))) stack.push("ruby");
  return stack;
}
function getGitRemote(projectPath) {
  const gitConfigPath = join(projectPath, ".git", "config");
  if (!existsSync(gitConfigPath)) return null;
  try {
    const content = readFileSync(gitConfigPath, "utf-8");
    const lines = content.split("\n");
    let inOrigin = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '[remote "origin"]') {
        inOrigin = true;
        continue;
      }
      if (trimmed.startsWith("[")) {
        inOrigin = false;
        continue;
      }
      if (inOrigin && trimmed.startsWith("url =")) {
        return trimmed.slice(5).trim();
      }
    }
  } catch {
  }
  return null;
}
function scanWorkspace(workspacePath) {
  if (!existsSync(workspacePath)) return [];
  const results = [];
  let entries;
  try {
    entries = readdirSync(workspacePath);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
    const fullPath = join(workspacePath, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const hasProjectMarker = existsSync(join(fullPath, "package.json")) || existsSync(join(fullPath, "go.mod")) || existsSync(join(fullPath, "Cargo.toml")) || existsSync(join(fullPath, "requirements.txt")) || existsSync(join(fullPath, "pyproject.toml")) || existsSync(join(fullPath, "pom.xml")) || existsSync(join(fullPath, "composer.json")) || existsSync(join(fullPath, "Gemfile")) || existsSync(join(fullPath, ".git"));
    if (!hasProjectMarker) continue;
    results.push({
      name: basename(fullPath),
      path: fullPath,
      stack: detectStack(fullPath),
      gitRemote: getGitRemote(fullPath)
    });
  }
  return results;
}

export {
  scanWorkspace
};
