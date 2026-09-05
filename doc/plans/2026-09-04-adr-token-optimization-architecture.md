# ADR: Arquitetura de Gestão de Contexto e Otimização de Tokens no Control Plane (v2)

- **Data:** 2026-09-05 (Revisão v2.1) / 2026-09-04 (v1 Inicial)
- **Status:** Proposta Aprovada em Direção (v2.1)
- **Decisores:** Core Architecture Team, AI Systems Team
- **Documento Relacionado:** [RFC: Framework Integral de Otimização e Governança de Tokens (v2)](./2026-09-04-rfc-token-optimization-framework.md)

---

## 1. Contexto e Delimitação da Arquitetura

O Paperclip não realiza chamadas diretas a APIs de completação de LLM para resolução de tarefas de código. Ele atua como um **Control Plane**, delegando a execução de comandos, ferramentas e loops de raciocínio a engines e CLIs externas (Claude Code, OpenAI Codex, Cursor, Opencode, Pi) por meio do **Agent Client Protocol (ACP)** e de adaptadores especializados (`server/src/adapters/` e `packages/adapters/*`).

### 1.1. O que já está implementado e em produção no codebase
A auditoria técnica confirma que blocos estruturais de eficiência já existem no repositório:
1. **Rota Inbox-Lite:** [`server/src/routes/agents.ts#L3680`](../../server/src/routes/agents.ts#L3680) (`GET /api/agents/me/inbox-lite`) já entrega payloads enxutos com os campos essenciais de triagem.
2. **Paginação Incremental de Comentários:** [`server/src/routes/issues.ts#L11760-L11765`](../../server/src/routes/issues.ts#L11760-L11765) já suporta `?after=<commentId>&order=asc`.
3. **Injeção de Deltas no Wake Context:** [`skills/paperclip/SKILL.md#L22,L72`](../../skills/paperclip/SKILL.md#L22,L72) já empurra novos comentários diretamente via `PAPERCLIP_WAKE_PAYLOAD_JSON`, instruindo os agentes a não realizarem requisições HTTP redundantes para a thread de comentários.
4. **Model Tiering por Função:** [`server/src/services/built-in-agents.ts#L418`](../../server/src/services/built-in-agents.ts#L418) já isola a persona built-in `Summarizer` utilizando `claude-haiku-4-5` para tarefas leves de síntese operacional.
5. **Isolamento Pervasivo via Git Worktrees:** [`server/src/services/execution-workspaces.ts`](../../server/src/services/execution-workspaces.ts) e [`server/src/services/execution-workspace-policy.ts`](../../server/src/services/execution-workspace-policy.ts) já providenciam isolamento completo de arquivos e branches por tarefa.
6. **Preservação de Sessões em Heartbeats:** [`server/src/services/heartbeat.ts#L5169-L5188`](../../server/src/services/heartbeat.ts#L5169-L5188) (linha 5169 no HEAD atual; ~4031 em versões anteriores) reutiliza `resumeSessionParams` para wakes de temporizador com escopo de tarefa.
7. **Reconhecimento de Context Management Nativo:** [`packages/adapter-utils/src/session-compaction.ts#L51-L65`](../../packages/adapter-utils/src/session-compaction.ts#L51-L65) classifica `claude_local` e `codex_local` com `nativeContextManagement: "confirmed"`, desabilitando resets arbitrários por threshold de tokens.
8. **Tetos de Turnos e Timeouts:** [`packages/adapter-utils/src/agent-defaults.ts#L27-L32`](../../packages/adapter-utils/src/agent-defaults.ts#L27-L32) e [`packages/adapters/claude-local/src/server/execute.ts#L205-L247`](../../packages/adapters/claude-local/src/server/execute.ts#L205-L247) limitam timeout a 600s, turnos a 40 e restringem o prompt pelo orçamento de caracteres (`capAgentPromptToCharBudget`).

---

## 2. Decisões Arquiteturais (v2)

### D1: Fronteira de Invocação vs. Execução Interna da CLI
O Paperclip **não** tentará reescrever ou interceptar prompts conversacionais internos que a CLI do Claude Code ou Codex envia para o modelo de linguagem. O papel do Paperclip restringe-se a:
* Entregar payloads de inicialização enxutos (`wakePrompt`, `renderedBootstrapPrompt`).
* Preservar sessões de tarefas em heartbeats contínuos ([`heartbeat.ts#L5169-L5188`](../../server/src/services/heartbeat.ts#L5169-L5188)), viabilizando que a CLI externa aproveite o *Prompt Caching* na API do provedor subjacente.
* Aplicar tetos de turnos (`DEFAULT_AGENT_MAX_TURNS = 40`) e timeouts (`DEFAULT_AGENT_TIMEOUT_SEC = 600`) via [`agent-defaults.ts`](../../packages/adapter-utils/src/agent-defaults.ts).

### D2: Validação de Adoção de Rotas Incrementais Existentes (Inbox-Lite & Delta Wakes)
Fica estabelecido que o Paperclip **não precisa recriar** rotas incrementais de comentários ou tarefas, pois elas já estão em produção. A decisão foca em:
* Auditar a telemetria do skill do Paperclip para assegurar que os agentes estejam de fato consumindo `PAPERCLIP_WAKE_PAYLOAD_JSON` e `inbox-lite`, evitando invocações desnecessárias da rota legada `/inbox` e fetches completos de comentários.

### D3: Adoção do RTK (Rust Token Killer) via Hooks de Pré-Execução nos Adaptadores
Fica aprovada a integração do binário **RTK** nos adaptadores de execução local (`claude-local`, `codex-local`):
* O adaptador configura o hook de pré-execução de comandos Bash (`PreToolUse` no Claude Code).
* Comandos frequentes como `git status`, `npm test`, `pytest` e `cargo check` têm suas saídas limpas e resumidas pelo RTK antes de entrar no contexto do modelo, reduzindo de 60% a 90% o ruído de terminal.
* Caso a saída pós-RTK ainda exceda 8 KB / 200 linhas, aplica-se o offloading para artefatos em disco (`doc/AGENT-ARTIFACTS.md`).

### D4: Integração do CodeGraph via MCP Runtime Slots Gerenciados
Fica aprovado o provisionamento do **CodeGraph** como uma ferramenta MCP nativamente suportada na arquitetura de *Tools & Access* ([`doc/plans/2026-06-05-agent-access-mcp-runtime-slots-adr.md`](./2026-06-05-agent-access-mcp-runtime-slots-adr.md)):
* O CodeGraph analisa a árvore sintática (AST via *tree-sitter*) do repositório em SQLite local.
* O agente utiliza o servidor MCP para consultar dependências, chamadas e tipos de forma cirúrgica, eliminando loops de dezenas de `grep` e `cat` na fase de exploração do código.

### D5: Padronização das Skills Caveman e Cost-Reducer no Catálogo do Paperclip
Fica aprovada a criação de duas bundled skills oficiais em [`packages/skills-catalog/`](../../packages/skills-catalog/):
1. **`concise-mode` (Caveman Mode):** Diretrizes comportamentais que instruem o agente a eliminar preâmbulos, cortesias e saudações, produzindo respostas técnicas hiper-densas (economia de 60% a 75% em tokens de saída).
2. **`cost-guard` (Cost-Reducer):** Regras de higiene que alertam o agente caso ele realize leituras redundantes de arquivos já inspecionados ou execute comandos sem progresso.

### D6: Manutenção do Tiering Baseado em Papel e Proibição de Downgrade Dinâmico
Fica vetado o rebaixamento automático e dinâmico de modelos em agentes de código no meio de uma tarefa. O tiering opera por *design de papel*:
* Agentes de suporte e triagem usam modelos econômicos (`claude-haiku-4-5`, conforme [`server/src/services/built-in-agents.ts#L418`](../../server/src/services/built-in-agents.ts#L418)).
* Agentes de engenharia mantêm modelos de fronteira (`claude-sonnet-4-6`, `gpt-5.6-codex`).
* A transição entre níveis ocorre exclusivamente por *Hand-off* formal de reatribuição da issue.

### D7: Proibição de Cache Semântico em Ações de Código & Adoção de Cache Exato
Fica estritamente **proibido** o uso de similaridade de cosseno de embeddings (>0.96) em ações mutáveis de código.
* Caching no Paperclip será restrito a consultas de leitura idempotentes do Control Plane, utilizando chave criptográfica exata:
  `Key = SHA-256(canonicalPayload + gitHeadSha + schemaVersion + companyId)`

---

## 3. Consequências

### Positivas
* **Sem Retrabalho:** Reconhecer que `inbox-lite` e deltas de comentários já estão prontos poupa um sprint inteiro de desenvolvimento redutivo.
* **Segurança para Engenharia de Software:** A proibição de compactação destrutiva e de cache semântico em código elimina o risco de quebras de compilação ou regressões funcionais.
* **Foco no Ecossistema:** Implementação ágil nas Fases 1, 3 e 4 (Caveman, RTK, CodeGraph) com retorno de 60-80% de economia direta na ponta.

### Riscos e Mitigações
* **Dependência Externa do Binário RTK:** O RTK precisa estar instalado na máquina host. *Mitigação:* O adaptador verifica a presença do RTK e faz fallback gracioso para execução direta com truncamento nativo do Paperclip.
* **Custo de CPU na Indexação do CodeGraph:** *Mitigação:* A indexação da AST roda assincronamente em background durante o provisionamento da worktree.

---

## 4. Invariantes de Conformidade

Toda implementação deve respeitar:
1. Os limites em [`packages/adapter-utils/src/agent-defaults.ts`](../../packages/adapter-utils/src/agent-defaults.ts).
2. A política de isolamento de workspaces em [`server/src/services/execution-workspaces.ts`](../../server/src/services/execution-workspaces.ts).
3. A supervisão de slots de ferramentas em [`doc/plans/2026-06-05-agent-access-mcp-runtime-slots-adr.md`](./2026-06-05-agent-access-mcp-runtime-slots-adr.md).
