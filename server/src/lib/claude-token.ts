import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export function getClaudeToken(): string | null {
  const credPath = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credPath)) return null;
  try {
    const raw = readFileSync(credPath, "utf-8");
    const data = JSON.parse(raw);
    return data?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}
