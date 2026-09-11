# RFC: Otimização de Sessões, Governança de Contexto e Eficiência de Tokens no Control Plane

- **Status:** Proposta Técnica para Implementação
- **Data:** 2026-09-11
- **Área:** Core Control Plane, Heartbeat Orchestration, Adapters Runtime, MCP Runtime, Skills Catalog
- **Autores:** Core Engineering Team, AI Architecture Team & Antigravity (Google DeepMind)
- **Documentos Relacionados:**
  - [`doc/plans/2026-09-04-rfc-token-optimization-framework.md`](./2026-09-04-rfc-token-optimization-framework.md)
  - [`doc/plans/2026-09-04-adr-token-optimization-architecture.md`](./2026-09-04-adr-token-optimization-architecture.md)
  - [`doc/plans/2026-06-05-agent-access-mcp-runtime-slots-adr.md`](./2026-06-05-agent-access-mcp-runtime-slots-adr.md)
  - [`doc/AGENT-ARTIFACTS.md`](../AGENT-ARTIFACTS.md)

---

## 1. Resumo Executivo e Justificativa da Delimitação

Este RFC estabelece o **plano técnico executável** para eliminar o desperdício estrutural de tokens e otimizar o ciclo de sessões no Paperclip.

### Por Que Esta RFC Exclui o AI Gateway Externo?
Conforme validado na auditoria arquitetural:
1. **O Paperclip é estritamente um Control Plane:** O Paperclip gerencia governança organizacional (organogramas, orçamentos mensais em centavos, atribuição atômica de tarefas, isolamento de worktrees e trilhas de auditoria). Ele não deve incorporar lógica de balanceamento de carga de rede, rotação de quotas ou algoritmos de failover de chaves de API.
2. **Desacoplamento Limpo:** O Paperclip já suporta nativamente o direcionamento de tráfego para proxies e gateways compatíveis via `ANTHROPIC_BASE_URL` e `OPENAI_BASE_URL` (conforme documentado em [`packages/shared/src/types/adapter-registry.ts#L26-L29`](../../packages/shared/src/types/adapter-registry.ts#L26-L29) com o Bifrost in-cluster).
3. **Foco Cirúrgico no Código do Paperclip:** O objetivo desta RFC é sanar as ineficiências **internas** do Paperclip — despertares vazios, perdas espúrias de sessão no `--resume`, saídas ruidosas de terminal, prolixidade em respostas e loops cegos de exploração —, alcançando entre **60% e 80% de redução no consumo de tokens** sem depender de soluções de proxy.

---

## 2. Mapa Arquitetural das Intervenções

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CAMADA 1: CORE SCHEDULER & WATCHDOG                            │
│  [Pilar 1] tickTimers: Supressão de Despertares Vazios (Empty Inbox Wakes)             │
│  [Pilar 2] task-watchdogs: Disjuntor (Circuit Breaker) de Falta de Progresso           │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Enfileiramento de Wake Context Enxuto
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CAMADA 2: RUNTIME DOS ADAPTADORES                              │
│  [Pilar 3] Estabilização de Sessão Persistente (--resume no Claude & Codex)            │
│  [Pilar 4] Hook RTK (Rust Token Killer): Poda de Saídas de Terminal no PreToolUse      │
│  [Pilar 7] Contexto Head/Tail & workingSummary em Tarefas Longas                       │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Sessão da CLI / Execução ACP
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CAMADA 3: ECOSSISTEMA DE SKILLS & MCP                           │
│  [Pilar 5] Bundled Skill concise-mode (Caveman Mode): Supressão de Prolixidade         │
│  [Pilar 6] Bundled Skill cost-guard (Cost-Reducer): Prevenção de Re-leituras           │
│  [Pilar 8] Slot MCP CodeGraph: Navegação AST Estruturada vs. Loops de Grep             │
│  [Pilar 9] Fiscalização de Deltas: Consumo Estrito de PAPERCLIP_WAKE_PAYLOAD_JSON      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Especificação Detalhada dos 9 Pilares de Ação

---

### Pilar 1: Supressão de Despertares Vazios (Empty Inbox Wakes) no Agendador de Heartbeats

#### Problema e Diagnóstico
Em [`server/src/services/heartbeat.ts#L26118-L26160`](../../server/src/services/heartbeat.ts#L26118-L26160), a consulta que verifica a existência de issues elegíveis (`inArray(issues.status, ["todo", "in_progress"])`) é executada **apenas** quando há um `cutoff` de migração ativo. Em operação padrão (`cutoff === null`), qualquer agente com `intervalSec > 0` é acordado periodicamente pelo timer, independentemente de ter ou não tarefas a executar.

Como consequência de [`server/src/services/heartbeat.ts#L5185-L5188`](../../server/src/services/heartbeat.ts#L5185-L5188), wakes de timer não-escopados forçam a invalidação da sessão (`shouldResetTaskSessionForWake === true`), fazendo com que o agente inicialize uma sessão nova, consuma o prompt completo de inicialização e faça `GET /api/agents/me/inbox-lite` apenas para descobrir que não há trabalho pendente, consumindo tokens a cada ciclo de ociosidade.

#### Solução Proposta
Condicionar a geração de wakes do tipo `heartbeat_timer` no nível do PostgreSQL dentro de `tickTimers`:
1. Antes de invocar `claimDueTimerHeartbeat` e `enqueueWakeup`, verificar se o agente possui ao menos uma issue em status acionável (`todo` ou `in_progress`) ou alguma revisão pendente.
2. Agentes com fila vazia têm seu `lastHeartbeatAt` atualizado de forma leve no banco sem instanciar o processo do adaptador nem consumir tokens de LLM.
3. Exceção explícita: permitir wakes periódicos sem issues apenas para agentes cujo papel declarado exija rotinas autônomas de monitoramento ou que possuam a flag de configuração `runtimeConfig.heartbeat.wakeWhenIdle: true`.

#### Arquivos e Alterações Concretas
* [`server/src/services/heartbeat.ts`](../../server/src/services/heartbeat.ts):
  * Modificar a função `tickTimers` para incluir checagem padrão de backlog via query direta em `issues`.
  * Respeitar `wakeWhenIdle` em `agent.runtimeConfig`.
* [`server/src/__tests__/heartbeat-timer-empty-inbox.test.ts`](../../server/src/__tests__/):
  * Teste unitário comprovando que agente ocioso não enfileira `agentWakeupRequests` quando `wakeWhenIdle` não estiver ativado.

---

### Pilar 2: Disjuntor (Circuit Breaker) de Falta de Progresso no Watchdog

#### Problema e Diagnóstico
Atualmente, o Paperclip conta primordialmente com o teto de turnos (`DEFAULT_AGENT_MAX_TURNS = 40`) e o limite financeiro mensal (`budgetMonthlyCents`). Se um agente entrar em loop repetitivo de raciocínio ou falhas semânticas na mesma issue, ele consome dezenas de turnos e múltiplos heartbeats até esgotar o saldo financeiro, sem que o sistema intervenha precocemente.

#### Solução Proposta
Expandir o serviço de watchdog em [`server/src/services/task-watchdogs.ts`](../../server/src/services/task-watchdogs.ts):
1. **Contador de Runs Estagnados:** Monitorar execuções consecutivas na mesma issue (`agent_task_sessions` / `heartbeat_runs`).
2. **Gatilho de Disjuntor (Stalled Loop):** Se um agente atingir **3 runs consecutivos** em uma issue sem:
   - Mudar o status da issue;
   - Produzir novos commits na worktree da tarefa;
   - Publicar um artefato ou resumo funcional substantivo (`workingSummary`).
3. **Ação Automática:** O watchdog marca o agente com pausa de governança preventiva (`pauseReason: "stalled_loop"`), emite um evento de log de atividade (`activity_log`) e abre uma solicitação de intervenção humana no painel do Paperclip.

#### Arquivos e Alterações Concretas
* [`packages/shared/src/constants.ts`](../../packages/shared/src/constants.ts):
  * Adicionar `"stalled_loop"` ao tipo `PauseReason`.
* [`server/src/services/task-watchdogs.ts`](../../server/src/services/task-watchdogs.ts):
  * Implementar heurística de detecção de ausência de progresso baseada no diff de commits do worktree e histórico recente de comentários da issue.
* [`server/src/__tests__/task-watchdogs-stalled-loop.test.ts`](../../server/src/__tests__/):
  * Teste automatizado validando o desarme preventivo após 3 runs infrutíferos.

---

### Pilar 3: Estabilização e Preservação de Sessões Persistentes (`--resume`)

#### Problema e Diagnóstico
Os adaptadores [`claude-local`](../../packages/adapters/claude-local/src/server/execute.ts) e [`codex-local`](../../packages/adapters/codex-local/src/server/execute.ts) já suportam sessões incrementais via argumento `--resume <sessionId>`. Contudo, sessões válidas são frequentemente descartadas silenciosamente (caindo em *fresh session*) devido a:
- Invalidação estrita de formato de UUID em saídas intermediárias de logs;
- Flutuações na ordenação ou composição das chaves de servidores MCP (`runtimeSessionMcpServerMismatch`);
- Oscilação do diretório de trabalho (`effectiveExecutionCwd` vs `runtimeSessionCwd`) em reconciliações de worktree.

A perda de sessão força a re-execução de todo o ciclo de bootstrap, descartando os benefícios de reaproveitamento do estado interno da LLM.

#### Solução Proposta
1. **Estabilização de Metadados de Sessão:** Normalizar e ordenar deterministicamente a assinatura de servidores MCP e ferramentas antes de persistir em `agentTaskSessions.sessionParamsJson`.
2. **Preservação de CWD em Worktrees:** Garantir que tarefas atreladas a uma worktree persistam o caminho canônico exato entre heartbeats sucessivos.
3. **Telemetria de Resumo de Sessão:** Emitir métricas de execução estruturadas (`session.resumed`, `session.fresh`, `session.resume_rejected_reason`) no log de eventos do run (`heartbeat_run_events`) para permitir observabilidade clara da taxa de reuso.

#### Arquivos e Alterações Concretas
* [`packages/adapters/claude-local/src/server/execute.ts`](../../packages/adapters/claude-local/src/server/execute.ts):
  * Tornar tolerante o casamento de CWD quando a worktree referenciar o mesmo branch da tarefa.
  * Padronizar a checagem de UUID de sessão.
* [`packages/adapters/codex-local/src/server/execute.ts`](../../packages/adapters/codex-local/src/server/execute.ts):
  * Alinhar lógica de preservação idêntica ao `claude-local`.
* [`packages/adapter-utils/src/session-compaction.ts`](../../packages/adapter-utils/src/session-compaction.ts):
  * Garantir compatibilidade de políticas de compactação.

---

### Pilar 4: Filtragem e Poda de Comandos de Terminal via Hook RTK (Rust Token Killer)

#### Problema e Diagnóstico
Agentes de engenharia executam com frequência ferramentas de terminal como `git status`, `git diff`, `npm test`, `pytest`, `cargo check` e linters. As saídas brutas desses comandos costumam gerar entre 500 e 5.000 linhas de texto, inundando a janela de contexto da CLI externa e forçando processamento desnecessário nas rodadas seguintes.

#### Solução Proposta
Adotar o padrão **RTK (Rust Token Killer)** aprovado no RFC arquitetural:
1. **Hook de Pré-Execução (PreToolUse):** Nos adaptadores locais, interceptar comandos bash/terminal antes de devolver o resultado ao modelo.
2. **Resumo Inteligente:** O RTK filtra o ruído, preservando exclusivamente:
   - `git status`: lista compacta de arquivos modificados/não-rastreados;
   - `test / check`: apenas as falhas de asserção e stack traces relevantes, suprimindo listagens de testes que passaram com sucesso.
3. **Offloading de Segurança (Artefatos):** Caso a saída filtrada ainda exceda **8 KB ou 200 linhas**, descarregar o conteúdo bruto para um arquivo de artefato no workspace gerenciado ([`doc/AGENT-ARTIFACTS.md`](../AGENT-ARTIFACTS.md)), retornando ao modelo apenas um trecho sumarizado e o caminho local do arquivo.

#### Arquivos e Alterações Concretas
* [`packages/adapters/claude-local/src/server/execute.ts`](../../packages/adapters/claude-local/src/server/execute.ts):
  * Configurar interceptor de pré-execução de bash no subprocesso.
* [`packages/adapters/codex-local/src/server/execute.ts`](../../packages/adapters/codex-local/src/server/execute.ts):
  * Adicionar suporte similar para o runtime do Codex.
* [`packages/adapter-utils/src/rtk-filter.ts`](../../packages/adapter-utils/):
  * Utilitário TypeScript com suporte a fallback gracioso: caso o binário RTK não esteja instalado no host, o adaptador utiliza heurísticas de truncamento de texto puro sem quebrar a execução.

---

### Pilar 5: Bundled Skill `concise-mode` (Caveman Mode) no Catálogo

#### Problema e Diagnóstico
Tokens de saída (geração) possuem custo significativamente mais alto que tokens de entrada (até 3x a 5x a depender do modelo) e adicionam latência direta à execução. Agentes baseados em CLIs modernas tendem a produzir explicações didáticas, saudações formais, desculpas em retentativas e preâmbulos em excesso antes de executar as ferramentas.

#### Solução Proposta
Criar e distribuir oficialmente a skill **`concise-mode`** no pacote [`@paperclipai/skills-catalog`](../../packages/skills-catalog/):
1. **Diretrizes Comportamentais de Resposta:**
   - Proibição estrita de saudações ("Olá!", "Entendido, vou começar agora...").
   - Proibição de narração de etapas óbvias de leitura de arquivo.
   - Respostas de raciocínio densas e técnicas ("Fix applied at line 124. Running tests.").
2. **Ativação Simples:** Permitir que empresas ou agentes específicos vinculem a skill `concise-mode` a seus perfis operacionais com impacto imediato de 60% a 75% de economia em tokens de saída.

#### Arquivos e Alterações Concretas
* [`packages/skills-catalog/catalog/bundled/concise-mode/SKILL.md`](../../packages/skills-catalog/):
  * Criação do arquivo de definição da skill conforme o padrão do catálogo.
* [`packages/skills-catalog/generated/catalog.json`](../../packages/skills-catalog/generated/catalog.json):
  * Regeneração do manifesto oficial do catálogo via `pnpm --filter @paperclipai/skills-catalog catalog:manifest`.

---

### Pilar 6: Bundled Skill `cost-guard` (Cost-Reducer)

#### Problema e Diagnóstico
Comportamento comum em agentes autônomos em tarefas complexas é a re-inspeção cíclica: o agente lê um arquivo de 500 linhas no início do turno, executa duas ferramentas e, três turnos depois, lê novamente o mesmo arquivo na íntegra sem que ele tenha sido modificado no disco.

#### Solução Proposta
Criar a skill **`cost-guard`** focada em disciplina de leitura e execução:
1. **Regras de Eficiência de Ferramenta:**
   - Proibir re-leitura de arquivos cujo conteúdo já foi carregado na sessão ativa, a menos que uma ferramenta de escrita ou comando git tenha alterado o arquivo.
   - Orientar o uso de visualizações parciais (`view_file` com `StartLine` e `EndLine`) em vez de carregar arquivos inteiros.
   - Alertar sobre padrões de comando idênticos falhando em repetição.

#### Arquivos e Alterações Concretas
* [`packages/skills-catalog/catalog/bundled/cost-guard/SKILL.md`](../../packages/skills-catalog/):
  * Criação do manifesto da skill com as regras de higiene e conservação de contexto.
* Atualização do manifesto do catálogo (`catalog:manifest`).

---

### Pilar 7: Enforçamento de `workingSummary` e Head/Tail Truncation em Issues Longas

#### Problema e Diagnóstico
Quando uma sessão precisa ser reiniciada (por expiração de tempo, troca de agente ou recuperação de processo), o Paperclip reconstrói o contexto da issue. Se a issue acumulou dezenas de comentários, discussões e tentativas passadas, esse histórico textual bruto volta a ser despejado no prompt, reintroduzindo o problema de inflação de contexto inicial.

#### Solução Proposta
1. **Campo `workingSummary` em `executionState`:**
   - Utilizar a coluna existente [`issues.execution_state`](../../packages/db/src/schema/issues.ts#L61) (JSONB) para persistir o resumo funcional consolidado da tarefa (`workingSummary`).
   - Ao finalizar cada run com sucesso, o agente/harness grava um resumo executivo de 2 a 3 frases: o que foi concluído, o que falta e qual o estado atual do código.
2. **Visão Head/Tail em Fresh Runs:**
   - Em [`packages/adapter-utils/src/server-utils.ts`](../../packages/adapter-utils/src/server-utils.ts) (`renderPaperclipWakePrompt`), quando a sessão for limpa (`resumedSession === false`) e o histórico de comentários for longo:
     - **Head:** Brief original e meta da issue;
     - **Body:** O `workingSummary` mais recente da tarefa;
     - **Tail:** Apenas os 2 últimos comentários ou deltas de revisão pendentes.

#### Arquivos e Alterações Concretas
* [`packages/shared/src/types/issue.ts`](../../packages/shared/src/types/issue.ts):
  * Adicionar tipagem para `executionState.workingSummary`.
* [`packages/adapter-utils/src/server-utils.ts`](../../packages/adapter-utils/src/server-utils.ts):
  * Ajustar `renderPaperclipWakePrompt` para priorizar `workingSummary` e aplicar corte Head/Tail no histórico.
* [`server/src/services/heartbeat-run-summary.ts`](../../server/src/services/heartbeat-run-summary.ts):
  * Garantir extração de resumo funcional na finalização do run.

---

### Pilar 8: Navegação de Código Estruturada via Slot MCP CodeGraph

#### Problema e Diagnóstico
Em repositórios médios ou grandes, agentes gastam entre 10 e 30 turnos navegando cegamente com `grep_search`, `find_by_name` e leituras sequenciais de arquivos para descobrir definições de tipos, imports e quem chama determinada função, queimando dezenas de milhares de tokens antes de escrever uma linha de código.

#### Solução Proposta
Acelerar a disponibilização do **CodeGraph** como um *MCP Runtime Slot* gerenciado no Paperclip:
1. **Indexação Local via AST:** O CodeGraph utiliza `tree-sitter` para parsear os arquivos do projeto e armazena os nós (classes, funções, interfaces, imports) em um SQLite local dentro do workspace gerenciado.
2. **Consultas Estruturadas:** O agente utiliza ferramentas MCP como `get_symbol_definitions`, `find_references` e `trace_dependencies`.
3. **Eliminação de Loops de Busca:** A navegação ocorre de forma cirúrgica com 1 chamada de ferramenta em vez de 15 chamadas iterativas de grep.

#### Arquivos e Alterações Concretas
* [`doc/plans/2026-06-05-agent-access-mcp-runtime-slots-adr.md`](./2026-06-05-agent-access-mcp-runtime-slots-adr.md):
  * Utilizar a especificação de *MCP Runtime Slots* já aprovada para empacotar o template do CodeGraph.
* [`server/src/services/mcp-slots/`](../../server/src/services/):
  * Configurar o provisionamento do servidor CodeGraph durante a inicialização de `executionWorkspaces` do tipo `git_worktree`.

---

### Pilar 9: Fiscalização de Deltas de Wake (`PAPERCLIP_WAKE_PAYLOAD_JSON`)

#### Problema e Diagnóstico
A infraestrutura de entrega de deltas (`PAPERCLIP_WAKE_PAYLOAD_JSON` e paginação incremental `?after=`) já está completamente implementada no servidor ([`server/src/routes/agents.ts#L3680`](../../server/src/routes/agents.ts#L3680) e [`server/src/routes/issues.ts#L11760`](../../server/src/routes/issues.ts#L11760)). No entanto, agentes descalibrados frequentemente ignoram os comentários já entregues no payload do wake e executam requisições redundantes a `GET /api/issues/:id/comments`.

#### Solução Proposta
1. **Enrijecimento das Instruções Operacionais:**
   - Atualizar [`skills/paperclip/SKILL.md`](../../skills/paperclip/SKILL.md) com diretiva explícita: proibir requisições HTTP para a thread de comentários a menos que a flag `fallbackFetchNeeded` venha marcada como `true`.
2. **Avaliação Automatizada de Conformidade:**
   - Atualizar a suíte de avaliação com Promptfoo ([`evals/promptfoo/prompts/heartbeat-system.txt`](../../evals/promptfoo/prompts/heartbeat-system.txt)) para penalizar e falhar execuções que façam fetch da lista completa de comentários quando o wake context já continha os deltas.

#### Arquivos e Alterações Concretas
* [`skills/paperclip/SKILL.md`](../../skills/paperclip/SKILL.md):
  * Reforço nas etapas de triagem e leitura de atribuições.
* [`evals/promptfoo/tests/release-gates.yaml`](../../evals/promptfoo/tests/release-gates.yaml):
  * Adicionar asserção validando que o agente não aciona a rota completa de comentários em wakes padrão.

---

## 4. Matriz de Impacto e Métricas de Sucesso

| Pilar de Ação | Camada de Atuação | Tipo de Economia | Redução Estimada de Tokens |
|---|---|---|---|
| **1. Supressão de Wakes Vazios** | Server (`heartbeat.ts`) | Entrada e Saída | **100% dos tokens de agentes ociosos** eliminados |
| **2. Watchdog Circuit Breaker** | Server (`task-watchdogs.ts`) | Entrada e Saída | **Corte imediato** de loops após o 3º run estagnado |
| **3. Estabilização de `--resume`** | Adapters (`execute.ts`) | Entrada | **70% a 90%** de reuso de sessão contínua |
| **4. Hook RTK de Terminal** | Adapters / Runtime | Entrada | **60% a 90%** do ruído de `git`/testes podado |
| **5. Skill `concise-mode`** | Catalog (`skills-catalog`) | Saída (Completion) | **60% a 75%** dos tokens de resposta reduzidos |
| **6. Skill `cost-guard`** | Catalog (`skills-catalog`) | Entrada | Elimina até **40%** de re-leituras redundantes |
| **7. Contexto Head/Tail** | Adapter Utils (`server-utils`) | Entrada | Estabiliza bootstrap de tarefas longas em **<2.000 tokens** |
| **8. Slot MCP CodeGraph** | MCP Runtime / Workspace | Entrada e Turnos | Reduz de **15-20 turnos de busca para 1-2 consultas** |
| **9. Fiscalização de Deltas** | Skills / Prompt Contract | Entrada e Tráfego | Elimina **100%** das chamadas de API redundantes a comentários |

---

## 5. Plano de Entrega Fatiado (Phased Rollout)

### Fase 1: Agendamento & Wakes (Ganhos Imediatos no Core)
* **Escopo:** Pilares 1 (Supressão de Wakes Vazios) e 2 (Watchdog Circuit Breaker).
* **Meta:** Estancar o consumo fantasma em instâncias com múltiplos agentes configurados.
* **Verificação:** Testes de integração em `heartbeat.test.ts` e `task-watchdogs.test.ts`.

### Fase 2: Bundled Skills de Eficiência no Catálogo
* **Escopo:** Pilares 5 (`concise-mode`) e 6 (`cost-guard`).
* **Meta:** Publicar as duas skills no catálogo oficial `@paperclipai/skills-catalog` sem alterar o core da plataforma.
* **Verificação:** Execução de `pnpm --filter @paperclipai/skills-catalog catalog:check` e testes de manifest.

### Fase 3: Camada de Adaptadores & Sessões
* **Escopo:** Pilares 3 (Estabilização de `--resume`) e 4 (Hook RTK de Terminal).
* **Meta:** Elevar a retenção de sessão para >90% e impedir que logs de testes e git saturem a memória dos modelos.
* **Verificação:** Testes dos adaptadores `claude-local` e `codex-local` cobrindo `--resume` e poda de comandos.

### Fase 4: Contexto de Tarefas & MCP
* **Escopo:** Pilares 7 (`workingSummary` / Head-Tail), 8 (MCP CodeGraph) e 9 (Fiscalização de Deltas).
* **Meta:** Garantir navegação estruturada de repositórios e enxugamento do ciclo de vida de issues longas.
* **Verificação:** Suíte de release-gates do Promptfoo e testes de worktree execution.

---

## 6. Riscos, Invariantes e Mitigações

1. **Invariante de Isolamento de Worktree:**
   - *Risco:* A reutilização persistente de sessão misturar estados entre branches diferentes.
   - *Mitigação:* O adaptador **nunca** reaproveita uma sessão se o ID da tarefa ou a worktree associada tiver mudado (`effectiveExecutionCwd !== runtimeSessionCwd`).
2. **Preservação de Código e Testes:**
   - *Risco:* A poda de comandos pelo RTK suprimir detalhes cruciais de erros de compilação.
   - *Mitigação:* O RTK é estritamente aditivo em falhas: qualquer linha correspondente a erros de asserção, traces ou códigos de saída não-zero é preservada integralmente. Saídas que excederem o limite são preservadas em disco como artefatos de workspace.
3. **Ausência de Ferramentas no Host (Fallback Gracioso):**
   - *Risco:* O binário do RTK ou do CodeGraph não estar instalado na máquina do usuário.
   - *Mitigação:* O Paperclip valida a presença do executável no PATH antes da execução; caso ausente, executa o comando normal com os limites padrão de caracteres já presentes no Paperclip.

---

## 7. Plano de Verificação Técnica

Para cada fase de implementação, devem ser executadas as suítes locais pertinentes:

```sh
# Verificação de tipos e conformidade geral
pnpm -r typecheck

# Suíte de testes unitários e de integração do Paperclip
pnpm test:run

# Conformidade do catálogo de skills
pnpm --filter @paperclipai/skills-catalog catalog:check

# Validação do design system e gates de UI (quando aplicável)
pnpm check:token-gates

# Build completo dos pacotes
pnpm build
```
