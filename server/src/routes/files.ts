import { Router } from "express";
import { db, projects } from "../db.js";
import { eq } from "drizzle-orm";
import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, resolve, relative, extname } from "path";

const router: ReturnType<typeof Router> = Router();

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo",
  "coverage", ".cache", ".vscode", ".idea", "__pycache__",
  "target", "bin", "obj", ".output", ".nuxt", ".svelte-kit",
  ".parcel-cache", ".vercel", ".netlify",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".mp3", ".mp4", ".avi", ".mov", ".wav", ".ogg",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".sqlite", ".db",
]);

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  size?: number;
}

function buildFileTree(dirPath: string, rootPath: string, depth: number = 0, maxDepth: number = 5): FileNode[] {
  if (depth > maxDepth) return [];

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];

  for (const entry of entries.sort()) {
    if (entry.startsWith(".") && depth === 0 && entry !== ".env.example") continue;
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dirPath, entry);
    const relativePath = relative(rootPath, fullPath).replace(/\\/g, "/");

    try {
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        const children = buildFileTree(fullPath, rootPath, depth + 1, maxDepth);
        nodes.push({
          name: entry,
          path: relativePath,
          type: "directory",
          children,
        });
      } else {
        nodes.push({
          name: entry,
          path: relativePath,
          type: "file",
          size: stat.size,
        });
      }
    } catch {
      continue;
    }
  }

  return nodes;
}

// GET /projects/:id/files — get file tree
router.get("/projects/:id/files", (req, res) => {
  const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }

  if (!existsSync(project.path)) {
    res.status(404).json({ error: "project directory not found on disk" });
    return;
  }

  const maxDepth = parseInt(req.query.depth as string) || 5;
  const tree = buildFileTree(project.path, project.path, 0, Math.min(maxDepth, 10));
  res.json(tree);
});

// GET /projects/:id/files/content — get file content
router.get("/projects/:id/files/content", (req, res) => {
  const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }

  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: "path query parameter is required" });
    return;
  }

  // Path traversal protection
  const resolvedPath = resolve(project.path, filePath);
  const normalizedRoot = resolve(project.path);

  if (!resolvedPath.startsWith(normalizedRoot)) {
    res.status(403).json({ error: "path traversal not allowed" });
    return;
  }

  if (!existsSync(resolvedPath)) {
    res.status(404).json({ error: "file not found" });
    return;
  }

  try {
    const stat = statSync(resolvedPath);

    if (stat.isDirectory()) {
      res.status(400).json({ error: "path is a directory, not a file" });
      return;
    }

    // Don't serve very large files
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    if (stat.size > MAX_FILE_SIZE) {
      res.status(413).json({ error: "file too large", size: stat.size, maxSize: MAX_FILE_SIZE });
      return;
    }

    const ext = extname(resolvedPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      res.json({
        path: filePath,
        binary: true,
        size: stat.size,
        extension: ext,
      });
      return;
    }

    const content = readFileSync(resolvedPath, "utf-8");
    res.json({
      path: filePath,
      content,
      size: stat.size,
      extension: ext,
    });
  } catch {
    res.status(500).json({ error: "failed to read file" });
  }
});

export default router;
