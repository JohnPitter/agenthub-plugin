# Agent Teams V2 — Design Document

## Objetivo

Criar uma engine de execução v2 inspirada no Agent Teams do Claude Code CLI, onde um orquestrador analisa cada task e decide dinamicamente quais agentes invocar, podendo rodá-los em paralelo. A v1 (workflow sequencial) continua funcionando apartada — o usuário escolhe o modo na página de agentes.

## Arquitetura

### Fluxo de Execução

```
1. Task move para "assigned"
   ↓
2. Orchestrator (Tech Lead, Haiku) — TRIAGE
   - Analisa task + lê arquivos-chave do projeto (package.json, estrutura)
   - Classifica: simple | moderate | complex
   - Retorna JSON com plano de fases
   ↓
3. SIMPLE PATH (1 agente, sem Architect)
   - Direto pro dev certo
   - QA leve (Haiku) ou skip
   ↓
4. MODERATE/COMPLEX PATH (multi-fase)

   Fase 1 — Planning
   - Architect cria plano detalhado
   - Resultado vira contexto para próxima fase
   ↓
   Fase 2 — Implementation (paralelo)
   - Cada agente recebe: plano do Architect + task description
   - Cada agente no seu worktree (git) ou tmp folder (local)
   - Se um agente FALHA, só ele é re-executado
   - Socket emite progresso individual
   ↓
   Fase 3 — Merge + Orchestrator Review
   - Merge dos worktrees/tmp folders
   - Orchestrator (Haiku) review rápido
   - Se conflito → resolve ou re-executa agente conflitante
   ↓
   Fase 4 — QA
   - Simple → Haiku ou skip
   - Moderate/Complex → Opus
   - Rejeita com feedback → só re-executa o agente apontado
   ↓
5. RESULTADO FINAL
   - Commit com co-authors
   - PR com resumo: quem fez o quê, tempo de cada um
```

### Triage — Interface do Orchestrator

```typescript
interface TriageResult {
  complexity: "simple" | "moderate" | "complex";
  plan: string;
  phases: {
    agents: string[];       // roles: "architect", "backend_dev", etc.
    parallel: boolean;
    context?: string;       // instrução específica para esta fase
  }[];
  maxTurns: Record<string, number>;
  skipQa: boolean;
}
```

### Worktree Manager — Isolamento Paralelo

**Projetos git:**
```
projeto/
.git/worktrees/
  task-abc-backend_dev/     ← worktree do Backend Dev
  task-abc-frontend_dev/    ← worktree do Frontend Dev
```
- `git worktree add` para cada agente
- Merge sequencial no branch da task
- Conflito → auto-resolve ou re-executa agente
- Cleanup com `git worktree remove`

**Projetos locais (sem git):**
```
~/.agenthub-tasks/
  task-abc/
    backend_dev/            ← cópia isolada
    frontend_dev/           ← cópia isolada
    merged/                 ← resultado final
```
- Copia arquivos modificados para `merged/`
- Conflito de mesmo arquivo → Orchestrator decide

**API:**
```typescript
interface WorktreeManager {
  create(taskId: string, agentRole: string, projectPath: string): Promise<string>;
  merge(taskId: string, agentRoles: string[], projectPath: string): Promise<MergeResult>;
  cleanup(taskId: string): Promise<void>;
}

interface MergeResult {
  success: boolean;
  conflicts: { file: string; agents: string[] }[];
  mergedPath: string;
}
```

### Socket Events V2

```typescript
"v2:triage"          → { taskId, complexity, phases, plan }
"v2:phase_start"     → { taskId, phaseIndex, agents, parallel }
"v2:agent_progress"  → { taskId, agentId, agentRole, status, progress, currentFile, phaseIndex }
"v2:agent_complete"  → { taskId, agentRole, success, result_summary }
"v2:merge"           → { taskId, success, conflicts }
"v2:phase_complete"  → { taskId, phaseIndex, results }
```

### Frontend — Card de Task com Agent Teams

```
┌─────────────────────────────────┐
│ Login com JWT              high │
│ clima-tempo                     │
│                                 │
│ ⚡ Agent Teams (complex)        │
│                                 │
│ Fase 1: Planning ✅             │
│   Architect ████████████ done   │
│                                 │
│ Fase 2: Implementation ⚙️      │
│   Backend Dev  ██████░░░░ 60%   │
│   Frontend Dev ████░░░░░░ 40%   │
│                                 │
│ Fase 3: QA ⏳ aguardando       │
└─────────────────────────────────┘
```

### Seletor de Modo (Página de Agentes)

- Toggle: "Workflow v1" vs "Agent Teams v2"
- v1 ativo → mostra workflow editor
- v2 ativo → esconde editor, mostra descrição do fluxo automático
- Persiste no banco (integrations, type: execution_mode)
- Tasks em andamento continuam no modo que iniciaram

## Arquivos

```
server/src/lib/
  task-executor.ts          ← v1 (intocado)
  task-executor-v2.ts       ← v2 (novo)
  orchestrator.ts           ← Triage + merge + coordenação (novo)
  worktree-manager.ts       ← Cria/merge/limpa worktrees e tmp folders (novo)

server/src/routes/
  tasks.ts                  ← 1 IF: qual executor chamar

web/src/components/agents/
  execution-mode-selector.tsx  ← Toggle v1/v2 (novo)

web/src/routes/
  tasks.tsx                 ← Socket events v2
```

## Princípios

- V1 e V2 coexistem — nenhum arquivo v1 é quebrado
- tasks.ts decide qual executor com base na config do usuário
- Socket events v2 são adicionais (v1 events continuam)
- Retry granular: só re-executa o agente que falhou
- QA adaptativo: Haiku para simples, Opus para complexo
