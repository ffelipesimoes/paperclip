# RFC: Framework Integral de Otimização e Governança de Tokens (v2)

- **Status:** Proposta Revisada e Aprovada em Direção (v2.1 — Correção de Baseline de Endpoints Incrementais)
- **Data:** 2026-09-05 (Revisão v2.1) / 2026-09-04 (v1 Inicial)
- **Área:** Agent Orchestration, Control Plane, Adapter Layer, MCP Runtime Slots & Inference Billing
- **Autores:** Core Architecture Team, AI Systems Team & Antigravity
- **Documento Relacionado:** [ADR: Arquitetura de Gestão de Contexto e Otimização de Tokens no Control Plane (v2)](./2026-09-04-adr-token-optimization-architecture.md)

---

## 1. Resumo Executivo e Contexto da Revisão

Esta versão consolida a proposta à luz da **realidade arquitetural do Paperclip** e das ferramentas consagradas pela comunidade de agentes (Claude Code, Cursor, OpenAI Codex CLI):

1. **O Paperclip é um Control Plane, não um cliente direto de LLM:** O Paperclip não formula chamadas diretas de `messages.create` nem mantém o histórico multi-turn das conversas de LLM. A execução das tarefas de código é delegada a CLIs e engines de agentes externos via **Agent Client Protocol (ACP)** ou processos locais gerenciados através da camada `server/src/adapters/` e dos pacotes `packages/adapters/*`.
2. **Reconhecimento das Rotas Incrementais Já Existentes:** Conforme auditado no código, o Paperclip **já possui** em produção:
   * `GET /api/agents/me/inbox-lite` ([`server/src/routes/agents.ts#L3680`](../../server/src/routes/agents.ts#L3680)).
   * Paginação incremental via `?after=<commentId>&order=asc` ([`server/src/routes/issues.ts#L11760-L11765`](../../server/src/routes/issues.ts#L11760-L11765)).
   * Injeção direta de deltas no wake context via `PAPERCLIP_WAKE_PAYLOAD_JSON` ([`skills/paperclip/SKILL.md#L22,L72`](../../skills/paperclip/SKILL.md#L22,L72)), que elimina a necessidade de chamadas de API na maioria dos wakes de comentários.
   * *Ação:* A antiga Fase 2 de "implementar rotas delta" é reclassificada como **trabalho já concluído**, sendo substituída por uma fase de **auditoria de telemetria e garantia de adoção** pelos agentes.
3. **Trabalho Genuinamente Novo Focado no Ecossistema:** A energia de implementação é direcionada para as Fases 1, 3 e 4:
   * **Caveman Mode & Cost-Reducer (Fase 1):** Novas bundled skills oficiais em `@paperclipai/skills-catalog` para cortar prolixidade e fiscalizar leituras redundantes.
   * **RTK - Rust Token Killer (Fase 3):** Hook de pré-execução de comandos Bash no adapter local para podar 60-90% do ruído de terminal (`git status`, `npm test`, etc.).
   * **CodeGraph (Fase 4):** Template e provisionamento de slot MCP no workspace para navegação estruturada via AST (Tree-sitter + SQLite), eliminando loops cegos de `grep`/`find`.
4. **Critérios Objetivos de Segurança:** Preservação estrita de código (sem compactação destrutiva), manutenção de tiering por papel (sem downgrade dinâmico oculto em engenharia) e rejeição taxativa de cache semântico para ações mutáveis de código.

---

## 2. A Camada de Indireção do Paperclip: Onde Cada Ferramenta Atua

A relação entre o Control Plane (Paperclip Server), a camada de adaptadores e o ambiente de execução da CLI externa é estruturada em três níveis bem delimitados:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        NÍVEL 1: PAPERCLIP CONTROL PLANE (SERVER)                       │
│                                                                                        │
│  - Orquestração de Heartbeats e Agendamentos (`server/src/services/heartbeat.ts`)       │
│  - Gestão de Sessões (`resumeSessionParams`, `sessionReused`)                          │
│  - Isolamento de Espaço de Trabalho em Git Worktrees (`execution-workspaces.ts`)       │
│  - Governança de Permissões, Tetos de Turnos e Timeouts (`agent-defaults.ts`)          │
│  - Descoberta e Provisionamento de Slots MCP (`doc/plans/2026-06-05-*-adr.md`)         │
│  - Entrega de Deltas: `PAPERCLIP_WAKE_PAYLOAD_JSON` e `/inbox-lite` (JÁ EM PRODUÇÃO)  │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Payload de Invocação & Runtime Config
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   NÍVEL 2: CAMADA DE ADAPTADORES (packages/adapters/*)                  │
│                                                                                        │
│  - `claude-local`, `codex-local`, `cursor-local`, `opencode-local`, etc.               │
│  - Injeção de Hooks de Pré-Execução no Workspace (ex.: RTK no PreToolUse de Bash)      │
│  - Montagem de Variáveis de Ambiente e Gateway Sessions                                │
│  - Conexão com Servidores MCP Gerenciados (CodeGraph via MCP Stdio/HTTP)               │
│  - Aplicação de Orçamento de Caracteres no Prompt de Inicialização                     │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Processo CLI / Sessão ACP
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│             NÍVEL 3: AGENTE EXTERNO / CLI RUNNER (Claude Code, Codex, Cursor)          │
│                                                                                        │
│  - Loop de raciocínio multi-turn e tool-calling nativo                                 │
│  - Execução de comandos filtrados pelo RTK                                             │
│  - Consultas de símbolos e dependências via MCP CodeGraph                              │
│  - Aplicação das instruções de concisão (Caveman & Cost-Reducer Skills)                │
│  - Gestão nativa de contexto (`nativeContextManagement: "confirmed"`)                  │
│  - Prompt Caching de baixo nível na API da LLM (Anthropic / OpenAI)                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Mapeamento das Capacidades Já Existentes no Codebase

Tabela atualizada discriminando o que **já existe e está operacional** no repositório:

| Capacidade | Localização no Repositório | Descrição da Implementação Atual |
|---|---|---|
| **Rota Inbox-Lite** (Pilar 7) | [`server/src/routes/agents.ts#L3680`](../../server/src/routes/agents.ts#L3680) | **Já em produção:** Devolve payload enxuto com `id`, `identifier`, `title`, `status`, `priority`, `updatedAt`, `activeRun`, evitando dumps pesados. |
| **Paginação Incremental de Comentários** (Pilar 2) | [`server/src/routes/issues.ts#L11760-L11765`](../../server/src/routes/issues.ts#L11760-L11765) | **Já em produção:** Suporta `?after=<commentId>&order=asc` e `?afterCommentId=...`. |
| **Injeção de Delta no Wake Context** (Pilar 2) | [`skills/paperclip/SKILL.md#L22,L72`](../../skills/paperclip/SKILL.md#L22,L72) | **Já em produção:** `PAPERCLIP_WAKE_PAYLOAD_JSON` injeta novos comentários direto no wake, orientando o agente a não chamar a API a menos que precise de histórico amplo. |
| **Model Tiering** (Pilar 5) | [`server/src/services/built-in-agents.ts#L418`](../../server/src/services/built-in-agents.ts#L418) | **Já em produção:** Agente embutido `Summarizer` já configurado nativamente com `claude-haiku-4-5`, separado dos agentes de engenharia. |
| **Isolamento via Worktrees** (Pilar 9) | [`server/src/services/execution-workspaces.ts`](../../server/src/services/execution-workspaces.ts), [`server/src/services/execution-workspace-policy.ts`](../../server/src/services/execution-workspace-policy.ts) | **Já em produção:** Estratégia `git_worktree` implementada com reconciliação de branches e quarentena de alterações não comitadas. |
| **Preservação de Sessões** (Pilar 1) | [`server/src/services/heartbeat.ts#L5169-L5188`](../../server/src/services/heartbeat.ts#L5169-L5188) | **Já em produção:** `shouldResetTaskSessionForWake` (linha 5169 no HEAD atual; ~4031 no release anterior): reutiliza `resumeSessionParams` para wakes de temporizador com escopo de tarefa. |
| **Context Management Nativo** (Pilar 2) | [`packages/adapter-utils/src/session-compaction.ts#L51-L65`](../../packages/adapter-utils/src/session-compaction.ts#L51-L65) | **Já em produção:** `claude_local` e `codex_local` têm `nativeContextManagement: "confirmed"`, desativando rotação forçada por contagem de tokens. |
| **Tetos de Turnos e Timeouts** (Pilares 4 e 8) | [`packages/adapter-utils/src/agent-defaults.ts#L27-L32`](../../packages/adapter-utils/src/agent-defaults.ts#L27-L32), [`packages/adapters/claude-local/src/server/execute.ts#L205-L247`](../../packages/adapters/claude-local/src/server/execute.ts#L205-L247) | **Já em produção:** `DEFAULT_AGENT_TIMEOUT_SEC = 600`, `DEFAULT_AGENT_MAX_TURNS = 40`, e limitador `capAgentPromptToCharBudget`. |
| **Truncamento de Saídas de Run** (Pilar 4) | [`server/src/services/heartbeat-run-summary.ts#L6-L8`](../../server/src/services/heartbeat-run-summary.ts#L6-L8) | **Já em produção:** Constantes estritas: `HEARTBEAT_RUN_RESULT_SUMMARY_MAX_CHARS = 500`, `HEARTBEAT_RUN_RESULT_OUTPUT_MAX_CHARS = 4_096`, `HEARTBEAT_RUN_SAFE_RESULT_JSON_MAX_BYTES = 64 * 1024`. |
| **Infraestrutura de MCP Slots** (Pilar 3) | [`doc/plans/2026-06-05-agent-access-mcp-runtime-slots-adr.md`](./2026-06-05-agent-access-mcp-runtime-slots-adr.md) | **Já em produção:** Gateway de acesso governado e supervisão de slots de execução MCP para agentes. |

---

## 4. Os 10 Pilares Técnicos Revisitados com o Trabalho Efetivo

### Pilar 1: Otimização de Prefixo & Reuso de Sessão no Control Plane
* **Fronteira:** O Paperclip não formula os prompts de baixo nível da LLM, mas garante **estabilidade byte-a-byte** no payload inicial entregue ao adapter (`renderedBootstrapPrompt` e `joinPromptSections`).
* **Ação:** Manter instruções estáveis no início do payload de bootstrap e preservar a sessão de tarefa existente em wakes de continuação ([`heartbeat.ts#L5169-L5188`](../../server/src/services/heartbeat.ts#L5169-L5188)), viabilizando que a CLI externa aproveite o *Prompt Caching* na API do provedor (Anthropic/OpenAI) através do argumento `--resume` ou handle ACP persistido.

### Pilar 2: Adoção Plena de Deltas de Comentários e Validação de Telemetria
* **Diagnóstico Atual:** O Paperclip já possui paginação incremental (`?after=`) e injeção de deltas via `PAPERCLIP_WAKE_PAYLOAD_JSON`.
* **Trabalho Efetivo:** Em vez de construir novas rotas, o objetivo é auditar e garantir a **aderência dos agentes**:
  1. Monitorar a taxa de uso do `PAPERCLIP_WAKE_PAYLOAD_JSON` vs. quedas em `fallbackFetchNeeded`.
  2. Ajustar os testes de conformidade do skill para assegurar que agentes não invoquem `GET /api/issues/:id/comments` de forma desnecessária quando o payload de wake já contiver o batch completo dos novos comentários.

### Pilar 3: Navegação Estruturada de Código via MCP CodeGraph (Trabalho Novo)
* **Problema:** Agentes gastam dezenas de chamadas de `grep`, `find_by_name` e `view_file` para entender relacionamentos e dependências, saturando o contexto rapidamente.
* **Solução Especializada (CodeGraph):**
  1. Integrar o **CodeGraph** como um *Tool Application* gerenciado no catálogo de ferramentas do Paperclip ([`doc/plans/2026-06-05-agent-access-mcp-runtime-slots-adr.md`](./2026-06-05-agent-access-mcp-runtime-slots-adr.md)).
  2. O CodeGraph analisa a árvore sintática (via *tree-sitter*) e armazena relações de classes, chamadas, tipos e imports em SQLite local.
  3. O agente realiza consultas estruturadas (*"quais métodos chamam ` realizationExecutionWorkspace `?"*), eliminando a leitura sequencial de dezenas de arquivos.

### Pilar 4: Interceptação e Poda de Comandos via RTK - Rust Token Killer (Trabalho Novo)
* **Problema:** Saídas volumosas de comandos de terminal (`git status`, `git diff`, `npm test`, linters) despejam milhares de linhas no contexto da CLI.
* **Solução Especializada (RTK):**
  1. Configurar os adaptadores locais (`claude-local`, `codex-local`) para habilitar o **RTK** como hook de pré-execução de comandos Bash (`PreToolUse` hook no Claude Code).
  2. O binário leve do RTK intercepta comandos do desenvolvedor/agente e poda o ruído antes de devolver o resultado ao modelo (ex.: `git status` reduzido a modificações essenciais; `vitest` resumido aos blocos com falha).
  3. **Offloading do Paperclip:** Se a saída pós-RTK ainda exceder 8 KB ou 200 linhas, o adaptador descarrega o dump para um artefato no workspace ([`doc/AGENT-ARTIFACTS.md`](../../doc/AGENT-ARTIFACTS.md)), fornecendo apenas um slice e o caminho do arquivo.

### Pilar 5: Model Tiering com Critérios Determinísticos por Papel
* **Critério Estrito:** Proibição de rebaixamento dinâmico de modelo em tarefas de implementação de código.
* **Ação no Control Plane:**
  1. **Tiering por Design de Persona:** Manter e ampliar o padrão de [`server/src/services/built-in-agents.ts#L418`](../../server/src/services/built-in-agents.ts#L418):
     * *Tier 1 (Econômico):* `Summarizer`, `Issue Triage`, `PR Description Reviewer`, `Dependency Auditor` usam modelos leves (`claude-haiku-4-5`, `gpt-4o-mini`, `gemini-1.5-flash`).
     * *Tier 2 (Fronteira):* `Software Engineer`, `Architect`, `Security Auditor` usam modelos topo de linha (`claude-sonnet-4-6`, `claude-opus-4-6`, `gpt-5.6-codex`).
  2. **Escalada Determinística:** Quando um agente de triagem (Tier 1) rotula uma issue como complexa ou pronta para implementação, ele emite um *Hand-off* de reatribuição para um agente Tier 2, sem que haja degradação da qualidade da escrita do código.

### Pilar 6: RAG Dinâmico e Chunking Estruturado em Docs da Empresa
* **Fronteira:** Busca de documentação e wiki interna gerenciada pelo Paperclip.
* **Ação:** Chunks semânticos indexados com re-ranking dinâmico, fornecendo no máximo os 3 a 5 fragmentos mais relevantes em vez de carregar arquivos markdown inteiros de especificações arquiteturais.

### Pilar 7: Adoção Universal de Endpoints Enxutos (`inbox-lite`)
* **Diagnóstico Atual:** `GET /api/agents/me/inbox-lite` já existe em [`server/src/routes/agents.ts#L3680`](../../server/src/routes/agents.ts#L3680).
* **Trabalho Efetivo:** Assegurar que todas as rotinas em segundo plano e scripts operacionais de agentes usem `/inbox-lite` como rota padrão de checagem de tarefas, eliminando o tráfego da rota completa `/inbox`.

### Pilar 8: Redução de Tokens de Saída via Caveman Mode & Limites de Turnos (Trabalho Novo)
* **Problema:** Tokens de saída custam até 5x mais que tokens de entrada e aumentam a latência agregada da rodada.
* **Solução Especializada (Caveman Mode):**
  1. Empacotar no catálogo de skills ([`packages/skills-catalog/`](../../packages/skills-catalog/)) a skill **`concise-mode` (Caveman)**.
  2. Instruir o agente a responder estritamente com dados técnicos essenciais, eliminando saudações, desculpas, preâmbulos e explicações didáticas desnecessárias ("Me fix bug in line 42. Tests green.").
  3. **Governança de Turnos:** Monitorar o teto de turnos (`DEFAULT_AGENT_MAX_TURNS = 40`) e emitir avisos preventivos no log de atividades quando o agente atingir 80% do limite.

### Pilar 9: Isolamento de Exploração Pesada em Worktrees e Sub-Issues
* **Fronteira:** Já pervasivo via [`server/src/services/execution-workspaces.ts`](../../server/src/services/execution-workspaces.ts).
* **Mecanismo:** Tarefas com grande carga exploratória (ex.: auditoria de segurança em 500 dependências) devem ser despachadas como sub-issues para agentes subordinados rodando em worktrees efêmeras. O agente pai recebe apenas o relatório executivo final e o commit gerado.

### Pilar 10: Auditoria com Cost-Reducer & Proibição de Cache Semântico em Código (Trabalho Novo)
* **Critério Estrito:** Proibição taxativa de cache de similaridade de embeddings (cosseno) para execuções de comandos ou código.
* **Solução Especializada (Cost-Reducer Skill):**
  1. Inclusão da skill **`token-cost-guard`** (Cost-Reducer): regras operacionais que alertam o agente caso ele execute comandos redundantes ou re-leia arquivos que já inspecionou no mesmo turno.
  2. **Cache do Control Plane Estritamente Exato:** Caching apenas em leituras puras do servidor utilizando endereçamento por conteúdo:
     `Key = SHA-256(canonicalPayload + gitHeadSha + schemaVersion + companyId)`

---

## 5. Matriz de Integração: Componentes do Paperclip vs. Ferramentas do Ecossistema

| Ferramenta / Capacidade | Onde se Conecta no Paperclip | Status | Papel na Redução de Tokens |
|---|---|---|---|
| **`inbox-lite` & Delta Comments** | `server/src/routes/agents.ts#L3680` e `server/src/routes/issues.ts#L11760` | **Já em Produção** | Elimina recarregamento de históricos de comentários e payloads inflados. |
| **`PAPERCLIP_WAKE_PAYLOAD_JSON`** | `skills/paperclip/SKILL.md#L22,L72` | **Já em Produção** | Injeta novos comentários direto no wake context sem requisições HTTP. |
| **Caveman Mode (`concise-mode`)** | Bundled Skill em `packages/skills-catalog/` | **Trabalho Novo** | Reduz 60-75% dos tokens de saída eliminando preâmbulos e cortesias no raciocínio. |
| **Cost-Reducer (`cost-guard`)** | Bundled Skill em `packages/skills-catalog/` | **Trabalho Novo** | Previne re-leituras redundantes e loops de exploração sem progresso. |
| **RTK (Rust Token Killer)** | Hook `PreToolUse` nos adaptadores (`packages/adapters/claude-local`, etc.) | **Trabalho Novo** | Poda 60-90% de ruído em comandos de terminal antes de entrar no contexto da CLI. |
| **CodeGraph** | *Tool Application* / *MCP Runtime Slot* gerenciado em `server/src/services/` | **Trabalho Novo** | Elimina loops caros de `grep`/`find`, substituindo por consultas cirúrgicas à AST. |

---

## 6. Plano de Entrega Fatiado (Phased Delivery)

O plano foi ajustado para focar estritamente no trabalho genuinamente novo:

1. **Fase 1: Bundled Skills de Eficiência no Catálogo (`packages/skills-catalog`) — [NOVO]**
   * Criar a skill `concise-mode` (baseada no Caveman) para supressão de prolixidade em saídas.
   * Criar a skill `cost-guard` (baseada no Cost-Reducer) com boas práticas de inspeção econômica.
2. **Fase 2: Auditoria e Validação de Telemetria de Adoção de `inbox-lite` e `WAKE_PAYLOAD` — [AUDITORIA / TELEMETRIA]**
   * Medir a taxa de adoção real das rotas `inbox-lite` e dos deltas de `PAPERCLIP_WAKE_PAYLOAD_JSON`.
   * Verificar se agentes ainda caem desnecessariamente em `fallbackFetchNeeded` e corrigir instruções na skill `paperclip`.
3. **Fase 3: Integração do RTK na Camada de Adaptadores — [NOVO]**
   * Adicionar suporte opcional de hook de pré-execução de bash nos adaptadores locais para interceptação transparente com RTK.
4. **Fase 4: Modelo de Aplicação MCP do CodeGraph via Tools & Access — [NOVO]**
   * Configurar manifesto padrão para provisionamento supervisionado do servidor MCP do CodeGraph em projetos com repositórios médios/grandes.
