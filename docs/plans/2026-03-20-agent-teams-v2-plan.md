# Agent Teams V2 — Plano de Implementação

## Ordem de implementação (dependências respeitadas)

### Fase A: Worktree Manager (backend, sem dependências)
**Arquivo:** `server/src/lib/worktree-manager.ts`

1. `create(taskId, agentRole, projectPath)` — cria worktree (git) ou tmp folder (local)
2. `merge(taskId, agentRoles, projectPath)` — merge sequencial dos worktrees ou cópia dos tmp folders
3. `cleanup(taskId)` — remove worktrees e tmp folders
4. Detecção de conflitos no merge com relatório `MergeResult`
5. Para git: `git worktree add`, `git merge --no-ff`, `git worktree remove`
6. Para local: `cpSync` filtrado, diff de arquivos modificados, merge em `merged/`

**Como testar:** Unit test criando worktrees num repo temporário, verificando isolamento e merge.

---

### Fase B: Orchestrator (backend, sem dependências)
**Arquivo:** `server/src/lib/orchestrator.ts`

1. `triage(task, project)` — chama Tech Lead (Haiku) com prompt estruturado, retorna `TriageResult`
   - Prompt inclui: task title/description, package.json do projeto, lista de arquivos raiz, agentes disponíveis
   - Resposta forçada em JSON via system prompt com schema explícito
   - Fallback se JSON inválido: `{ complexity: "moderate", phases: [{ agents: ["backend_dev"], parallel: false }] }`
2. `reviewMerge(mergeResult, taskId)` — Haiku review rápido do merge, retorna se ok ou quais conflitos resolver
3. `routeQa(complexity)` — retorna qual modelo usar no QA (Haiku ou Opus)

**Dependências:** Precisa do Anthropic SDK (já existe), tabela agents (já existe).

**Como testar:** Mock do Claude API, verificar parsing do JSON de triage.

---

### Fase C: Task Executor V2 (backend, depende de A e B)
**Arquivo:** `server/src/lib/task-executor-v2.ts`

1. `executeTaskV2(taskId, io)` — entry point
2. Chama `orchestrator.triage()` para obter plano
3. Loop pelas fases:
   - Fase com `parallel: false` → executa agentes sequencialmente (igual v1)
   - Fase com `parallel: true` → `Promise.all()` dos agentes
   - Cada agente recebe workDir do `worktreeManager.create()`
   - Cada agente roda `query()` do Claude SDK com seu prompt enriquecido
   - Resultado de fase anterior injetado no contexto da próxima fase
4. Após fases de implementação → `worktreeManager.merge()`
5. Se merge falhou → re-executa agente conflitante
6. QA routing via `orchestrator.routeQa()`
7. QA rejeição cirúrgica: parseia qual agente errou, re-executa só ele
8. Socket events v2 emitidos em cada transição

**Tipos:**
```typescript
interface PhaseExecution {
  phaseIndex: number;
  agents: string[];
  parallel: boolean;
  results: Map<string, { success: boolean; result: string; costUsd: number; tokensUsed: number }>;
}
```

**Como testar:** E2E com DISABLE_AUTO_EXECUTE + chamada manual.

---

### Fase D: Rota tasks.ts — Switch v1/v2 (backend, depende de C)
**Arquivo:** `server/src/routes/tasks.ts` (editar)

1. Ler execution_mode da tabela `integrations` (type: "execution_mode")
2. No auto-execute (PATCH status → assigned):
   ```typescript
   const mode = db.select().from(schema.integrations)
     .where(eq(schema.integrations.type, "execution_mode")).get();
   const isV2 = mode?.config === "v2";

   if (isV2) {
     executeTaskV2(task.id, io);
   } else {
     executeTask(task.id, io);
   }
   ```
3. Mesmo padrão no WhatsApp advance_status
4. Endpoint novo: `GET /api/execution-mode` e `PUT /api/execution-mode`

**Como testar:** Alternar entre v1 e v2, verificar que cada executor é chamado.

---

### Fase E: Seletor de Modo no Frontend (frontend, depende de D)
**Arquivo:** `web/src/components/agents/execution-mode-selector.tsx` (novo)

1. Componente com 2 cards clicáveis: "Workflow v1" e "Agent Teams v2"
2. Fetch `GET /api/execution-mode` no mount
3. `PUT /api/execution-mode` ao clicar
4. Quando v1: mostra workflow editor embaixo
5. Quando v2: mostra descrição do fluxo + lista de agentes disponíveis

**Editar:** `web/src/routes/agents.tsx` — adicionar `<ExecutionModeSelector />` acima do workflow editor

**Como testar:** Clicar toggle, verificar que persiste após refresh.

---

### Fase F: Socket Events V2 no Frontend (frontend, depende de C e E)
**Editar:** `web/src/routes/tasks.tsx`

1. Novos listeners no useEffect de socket:
   - `v2:triage` → salva plano no state da task
   - `v2:phase_start` → atualiza fase ativa
   - `v2:agent_progress` → atualiza barra de progresso individual
   - `v2:agent_complete` → marca agente como concluído
   - `v2:merge` → mostra resultado do merge
   - `v2:phase_complete` → avança para próxima fase
2. State novo no card:
   ```typescript
   interface V2Progress {
     complexity: string;
     phases: { agents: string[]; parallel: boolean; status: "pending" | "running" | "done" }[];
     agentProgress: Map<string, { progress: number; status: string; currentFile: string }>;
   }
   ```
3. Renderização condicional: se task tem v2Progress, mostra layout de fases com barras paralelas

**Como testar:** Criar task com v2 ativo, verificar que fases e barras aparecem em tempo real.

---

## Resumo de dependências

```
A (Worktree Manager) ──┐
                       ├──→ C (Executor V2) ──→ D (Route switch) ──→ E (Frontend toggle)
B (Orchestrator) ──────┘                                              ↓
                                                                F (Socket events frontend)
```

A e B podem ser implementados em paralelo.
C depende de A e B.
D depende de C.
E e F dependem de D (e podem ser paralelos entre si).
