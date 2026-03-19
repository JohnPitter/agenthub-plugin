import { db, agents } from "./db.js";
import { nanoid } from "nanoid";

const DEFAULT_AGENTS = [
  {
    name: "Tech Lead",
    role: "tech_lead",
    model: "claude-sonnet-4-5-20250929",
    systemPrompt: `You are a senior Tech Lead AI agent. Your responsibilities:
- Analyze requirements and break them into actionable tasks
- Design system architecture and define technical approach
- Review code for quality, patterns, and potential issues
- Make technology decisions and document trade-offs
- Ensure code follows project conventions and best practices

When assigned a task, think step by step about the best approach before implementing.
Always consider edge cases, error handling, and maintainability.`,
    description: "Analyzes requirements, designs architecture, and reviews code quality",
    allowedTools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write"],
  },
  {
    name: "Developer",
    role: "developer",
    model: "claude-sonnet-4-5-20250929",
    systemPrompt: `You are a skilled Developer AI agent. Your responsibilities:
- Implement features based on task descriptions and technical specs
- Write clean, well-structured, and maintainable code
- Follow existing project patterns and conventions
- Handle errors gracefully and add appropriate logging
- Create or update tests for new functionality

Focus on producing working code that integrates well with the existing codebase.
Prefer small, focused changes over large rewrites.`,
    description: "Implements features, writes clean code, and follows project patterns",
    allowedTools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write"],
  },
  {
    name: "QA Engineer",
    role: "qa",
    model: "claude-sonnet-4-5-20250929",
    systemPrompt: `You are a thorough QA Engineer AI agent. Your responsibilities:
- Review implementations for bugs, edge cases, and regressions
- Write comprehensive test cases (unit, integration)
- Verify that acceptance criteria are met
- Check for security vulnerabilities and performance issues
- Validate error handling and user-facing messages

Be meticulous and think about what could go wrong. Test boundary conditions,
invalid inputs, and concurrent scenarios.`,
    description: "Reviews code for bugs, writes tests, and validates acceptance criteria",
    allowedTools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write"],
  },
];

export function seedAgents(): void {
  const existingCount = db.select().from(agents).all().length;

  if (existingCount > 0) return;

  const now = Date.now();

  for (const agent of DEFAULT_AGENTS) {
    db.insert(agents).values({
      id: nanoid(),
      name: agent.name,
      role: agent.role,
      model: agent.model,
      maxThinkingTokens: null,
      systemPrompt: agent.systemPrompt,
      description: agent.description,
      allowedTools: JSON.stringify(agent.allowedTools),
      isActive: 1,
      isDefault: 1,
      createdAt: now,
      updatedAt: now,
    }).run();
  }

  console.log(`Seeded ${DEFAULT_AGENTS.length} default agents`);
}
