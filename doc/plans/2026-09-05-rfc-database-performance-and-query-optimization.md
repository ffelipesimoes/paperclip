# RFC: Otimização de Performance, Consultas e Arquitetura de Banco de Dados

- **Status:** Proposta Refinada (Ready for Implementation)
- **Data:** 2026-09-05
- **Área:** Database Layer, Drizzle ORM, API Performance, Connection Pooling & Service Orchestration
- **Autores:** Core Architecture Team & Antigravity

---

## 1. Resumo Executivo

Com o aumento da densidade de agentes autônomos, execuções de *heartbeat* paralelas, tarefas distribuídas e tráfego de API no Paperclip, o subsistema de persistência (PostgreSQL via Drizzle ORM) tornou-se o principal gargalo de escalabilidade e latência da aplicação.

A análise do código-fonte e a revisão técnica consolidada identificaram os pontos críticos de intervenção:
1. **Write Amplification em Leituras:** Atualizações síncronas de `last_used_at` em cada requisição autenticada de agentes ou diretoria.
2. **Query Fan-out Severo:** Listagens elementares de issues disparando mais de 10 queries simultâneas e navegações iterativas em grafo.
3. **Varredura Massiva Recorrente no Scheduler:** Reconstrução completa do feed de atenção a cada 30 segundos em `runRetentionSweep`.
4. **Invalidação de Índices:** Uso de `COALESCE(...)` em campos JSONB de `heartbeat_runs` que impede o uso de índices B-tree.
5. **Índices Compostos Ausentes:** Tabelas de alto volume (`activity_log`, `cost_events`, `issue_thread_interactions`, `decisions`) sem índices de cobertura temporal por empresa.
6. **Consultas N+1 e Cascata Sequencial:** Cálculos de orçamentos e dashboards com múltiplas queries individuais não batched e serializadas com `await`.

Esta RFC detalha a implementação das melhorias organizadas em **6 Pilares Técnicos** e um **Roteiro de Implementação Priorizado**, balanceando segurança, risco e impacto imediato.

---

## 2. Diagnóstico Detalhado e Arquivos Afetados

### 2.1. Write-Amplification no Middleware de Autenticação
* **Localização:** [`server/src/middleware/auth.ts:341-343`](file:///Users/felipesimoes/DEV/paperclip/server/src/middleware/auth.ts#L341-L343) e [`server/src/services/board-auth.ts:149-151`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/board-auth.ts#L149-L151)
* **Mecanismo:** A cada chamada à API contendo `Bearer <token>`, executa-se síncronamente:
  ```ts
  await db.update(agentApiKeys).set({ lastUsedAt: new Date() }).where(eq(agentApiKeys.id, key.id));
  await db.update(boardApiKeys).set({ lastUsedAt: new Date() }).where(eq(boardApiKeys.id, id));
  ```
* **Impacto:** Gera writes no banco em rotas de leitura pura (`GET`), sobrecarregando o WAL e concorrendo com transações de negócio.

### 2.2. Query Fan-out e Agregações em `issues.service.list`
* **Localização:** [`server/src/services/issues.ts:5567-5609`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/issues.ts#L5567-L5609)
* **Mecanismo:** Ao listar uma página de issues, executam-se dezenas de queries em paralelo, incluindo duas consultas analíticas pesadas com `MAX(createdAt)` sobre `issue_comments` e `activity_log` para calcular o `last_activity_at`.

### 2.3. Carga Cíclica no Scheduler (`runRetentionSweep`)
* **Localização:** [`server/src/index.ts:1177-1193`](file:///Users/felipesimoes/DEV/paperclip/server/src/index.ts#L1177-L1193) e [`server/src/services/decision-retention.ts:343`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/decision-retention.ts#L343)
* **Mecanismo:** O cron interno chama `attentionService.list(company.id, { all: true, allowUnscopedAll: true })` a cada 30 segundos para cada empresa ativa. A função percorre mais de 15 tabelas e reconstrói o feed inteiro, mesmo quando nada mudou.

### 2.4. Invalidação de Índices por `COALESCE` em JSONB
* **Localização:** [`server/src/services/issues.ts:2865-2875`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/issues.ts#L2865-L2875)
* **Mecanismo:**
  ```ts
  inArray(
    sql<string>`coalesce(${heartbeatRuns.contextSnapshot} ->> 'issueId', ${heartbeatRuns.contextSnapshot} ->> 'taskId')`,
    reviewIds,
  )
  ```
  O PostgreSQL não utiliza o índice de expressão `(company_id, (context_snapshot ->> 'issueId'))` devido ao encapsulamento em `COALESCE(...)`.

### 2.5. Índices Ausentes em Tabelas com Volume Expressivo
* **`activity_log`** ([`activity_log.ts`](file:///Users/felipesimoes/DEV/paperclip/packages/db/src/schema/activity_log.ts)): Sem índice cobrindo `(company_id, entity_type, entity_id, created_at DESC)`.
* **`cost_events`** ([`cost_events.ts`](file:///Users/felipesimoes/DEV/paperclip/packages/db/src/schema/cost_events.ts)): Sem índice cobrindo `(company_id, project_id, occurred_at)`.
* **`issue_thread_interactions`** ([`issue_thread_interactions.ts`](file:///Users/felipesimoes/DEV/paperclip/packages/db/src/schema/issue_thread_interactions.ts)): Sem índice em `(company_id, status, updated_at DESC)`.
* **`decisions`** ([`decisions.ts`](file:///Users/felipesimoes/DEV/paperclip/packages/db/src/schema/decisions.ts)): Sem índice em `(company_id, status, updated_at DESC)`.

### 2.6. Consultas N+1 e Cascata Sequencial
* **`budgets.ts`** ([`budgets.ts:630-647`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/budgets.ts#L630-L647)): `rows.map(buildPolicySummary)` executando queries individuais de escopo e agregação de custo por política.
* **`dashboard.ts`** ([`dashboard.ts:30-186`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/dashboard.ts#L30-L186)): 7 consultas pesadas encadeadas em sequência com `await`, somando as latências individuais.

---

## 3. Especificação Técnica dos Pilares

### Pilar 1: Debounce de Escritas de Auth e Cache L1 (Baixo Risco)
1. **Buffer em Memória para `lastUsedAt`:**
   * **Arquivos:** [`server/src/middleware/auth.ts:341-343`](file:///Users/felipesimoes/DEV/paperclip/server/src/middleware/auth.ts#L341-L343) e [`server/src/services/board-auth.ts:150`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/board-auth.ts#L150)
   * **Implementação:** Substituir o `await db.update(...).set({ lastUsedAt })` síncrono por um buffer em memória (`Map<keyId, number>`).
   * **Estratégia:** Gravar no banco apenas se o intervalo desde a última gravação for superior a **5 minutos** (300.000 ms), ou disparar em lote em background a cada 60s. O endpoint de API não aguarda essa gravação.
2. **Cache L1 em Memória para Metadados Estáticos:**
   * **Implementação:** Cache simples com TTL de 60s (ou invalidação por evento de mutação) para:
     * `instanceSettingsService.getGeneral()` e `getExperimental()`
     * `companyPrefix(db, companyId)`

---

### Pilar 2: Criação de Novos Índices Compostos (Baixo Risco)
1. **Atualização dos Schemas Drizzle:**
   * Atualizar os arquivos em `packages/db/src/schema/*.ts` antes de gerar a migração para evitar drift de schema:
     * `packages/db/src/schema/activity_log.ts`:
       ```ts
       companyEntityCreatedIdx: index("activity_log_company_entity_created_idx").on(
         table.companyId,
         table.entityType,
         table.entityId,
         table.createdAt.desc(),
       ),
       ```
     * `packages/db/src/schema/cost_events.ts`:
       ```ts
       companyProjectOccurredIdx: index("cost_events_company_project_occurred_idx").on(
         table.companyId,
         table.projectId,
         table.occurredAt,
       ),
       ```
     * `packages/db/src/schema/issue_thread_interactions.ts`:
       ```ts
       companyStatusUpdatedIdx: index("issue_thread_interactions_company_status_updated_idx").on(
         table.companyId,
         table.status,
         table.updatedAt.desc(),
       ),
       ```
     * `packages/db/src/schema/decisions.ts`:
       ```ts
       companyStatusUpdatedIdx: index("decisions_company_status_updated_idx").on(
         table.companyId,
         table.status,
         table.updatedAt.desc(),
       ),
       ```
2. **Geração e Aplicação de Migração Concorrente:**
   * Rodar `pnpm db:generate`.
   * Ajustar o arquivo de migração para utilizar `CREATE INDEX CONCURRENTLY` fora de bloco de transação, respeitando a checklist de migrações de [`doc/DATABASE.md`](file:///Users/felipesimoes/DEV/paperclip/doc/DATABASE.md#L157-L169).

---

### Pilar 3: Substituição de `COALESCE` por Cláusulas `OR` (Baixo Risco com Sanity Check)
1. **Sanity Check Prévio:**
   * Executar antes no banco para validar se há conflito entre as chaves:
     ```sql
     SELECT count(*) 
     FROM heartbeat_runs 
     WHERE context_snapshot->>'issueId' IS NOT NULL 
       AND context_snapshot->>'taskId' IS NOT NULL 
       AND context_snapshot->>'issueId' != context_snapshot->>'taskId';
     ```
   * Se o resultado for `0`, confirma-se que a semântica de `COALESCE` pode ser substituída com segurança por um predicado `OR`.
2. **Reescrita em `server/src/services/issues.ts:2865-2875`:**
   * Seguir o precedente idêntico já consolidado em [`task-watchdogs.ts:963-966`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/task-watchdogs.ts#L963-L966):
     ```ts
     or(
       inArray(sql`${heartbeatRuns.contextSnapshot}->>'issueId'`, reviewIds),
       inArray(sql`${heartbeatRuns.contextSnapshot}->>'taskId'`, reviewIds),
     )
     ```
   * O PostgreSQL passa a utilizar os índices `company_ctx_issue_created_idx` e `company_ctx_task_created_idx` via plano *BitmapOr*.

---

### Pilar 4: Otimização de Consultas, Batching e Desnormalização

#### 4a. Desnormalização de `last_activity_at` em `issues` (Médio Risco)
* **Objetivo:** Eliminar as duas queries analíticas com `MAX(createdAt)` sobre `issue_comments` e `activity_log` na listagem de issues.
* **Modelagem:**
  * Adicionar a coluna `last_activity_at timestamp with time zone` à tabela `issues`, com índice `(company_id, last_activity_at DESC)`.
* **Estratégia de Sincronização:**
  * **Via Trigger no Banco** (recomendado para consistência infalível): Criar triggers em `issue_comments` e `activity_log` que executem:
    ```sql
    UPDATE issues SET last_activity_at = NEW.created_at WHERE id = NEW.issue_id;
    ```
  * **Alternativa de Aplicação:** Centralizar a gravação em um helper único obrigatório em todas as mutações de comentários e logs.
* **Backfill:** Script de migração para preencher `last_activity_at = coalesce(updated_at, created_at)` nas linhas históricas existentes.

#### 4b. Batching em `budgets.ts` (Baixo Risco)
* **Arquivo:** [`server/src/services/budgets.ts:629`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/budgets.ts#L629) (`overview`)
* **Implementação:** Substituir `Promise.all(rows.map(buildPolicySummary))` por:
  1. Extração dos IDs únicos de agentes e projetos referenciados nas políticas.
  2. Duas queries em lote: `SELECT FROM agents WHERE id IN (...)` e `SELECT FROM projects WHERE id IN (...)`.
  3. Uma query agregada de custo utilizando `GROUP BY agent_id` e `GROUP BY project_id` cobrindo o período da janela.

#### 4c. Paralelização de Queries em `dashboard.ts` (Baixo Risco)
* **Arquivo:** [`server/src/services/dashboard.ts:29-187`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/dashboard.ts#L29-L187) (`summary`)
* **Implementação:**
  * Manter a query de `companies` primeiro (necessária para lançar 404 se a empresa não existir).
  * Agrupar todas as queries subsequentes independentes em um único `Promise.all`:
    ```ts
    const [agentRows, taskRows, pendingApprovals, spendRow, runActivityRows, budgetOverview] = await Promise.all([
      db.select(...).from(agents).where(...).groupBy(agents.status),
      db.select(...).from(issues).where(...).groupBy(issues.status),
      db.select(...).from(approvals).where(...),
      db.select(...).from(costEvents).where(...),
      db.execute(sql`WITH RECURSIVE recovered_runs ...`),
      budgets.overview(companyId),
    ]);
    ```

---

### Pilar 5: Scheduler Incremental Redesenhado e Governança de Transações

#### 5a. Redesenho da Varredura Incremental de Retenção
* **Arquivos:** [`server/src/index.ts:1176`](file:///Users/felipesimoes/DEV/paperclip/server/src/index.ts#L1176) (`runRetentionSweep`) e [`server/src/services/decision-retention.ts:343`](file:///Users/felipesimoes/DEV/paperclip/server/src/services/decision-retention.ts#L343) (`autoArchive`)
* **Ajuste Importante:** A tabela `decision_retention` **não** possui colunas `status` ou `expires_at`. Ela rastreia itens por `source_activity_at`, `archived_at` e a flag `keep`.
* **Fluxo Redesenhado:**
  1. O cron consulta `decision_retention` apenas para identificar itens candidatos:
     ```sql
     SELECT source_kind, source_id
     FROM decision_retention
     WHERE company_id = ?
       AND archived_at IS NULL
       AND keep = false
       AND source_activity_at < (NOW() - INTERVAL '7 days') -- ou janela configurada
     LIMIT 100;
     ```
  2. O sistema recalcula o estado ao vivo (via `attentionService`) **apenas para esse subconjunto pequeno** de candidatos, em vez de carregar o feed inteiro da empresa.
  3. Isso preserva 100% da integridade da lógica de `autoArchive` e elimina a reconstrução pesada de dezenas de tabelas a cada 30 segundos.

#### 5b. Governança da Transação em `decisions.ts` (Decisão de Arquitetura)
* **Arquivo:** [`server/src/routes/decisions.ts:79-83`](file:///Users/felipesimoes/DEV/paperclip/server/src/routes/decisions.ts#L79-L83)
* **Diretriz:** **Manter** o bloco `db.transaction(..., { isolationLevel: "repeatable read" })`.
* **Justificativa:** O nível `repeatable read` é estritamente necessário para garantir que o snapshot do feed permaneça consistente durante o cálculo de integridade do `manifestHash`. Remover essa transação introduziria condições de corrida.
* **Estratégia de Otimização:** O alívio do tempo de retenção do lock será obtido tornando a consulta do `attentionService.list()` ordens de grandeza mais rápida através dos Pilares 2 e 3, e não pela redução do nível de isolamento.

---

### Pilar 6: Ajuste de Pool de Conexões (Zero Code)
* **Implementação:** Configuração no `.env` do servidor para produção:
  ```env
  DATABASE_POOL_MAX=25
  DATABASE_IDLE_TIMEOUT_SECONDS=60
  DATABASE_CONNECT_TIMEOUT_SECONDS=10
  ```
* As opções já são suportadas nativamente por [`packages/db/src/client.ts:89-100`](file:///Users/felipesimoes/DEV/paperclip/packages/db/src/client.ts#L89-L100).

---

## 4. Roteiro de Implementação e Prioridades

```
┌─────────────────────────────────────────────────────────────┐
│ ETAPA 1 (Prioridade Imediata - Rápido, Seguro e Baixo Risco)│
│ • Pilar 1: Bufferização de lastUsedAt e Cache L1           │
│ • Pilar 2: Novos índices compostos (schema + migration)     │
│ • Pilar 3: Sanity check e troca de COALESCE por OR          │
│ • Pilar 6: Configuração de pool sizing no ambiente          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ ETAPA 2 (Otimizações de Serviços - Baixo Risco)             │
│ • Pilar 4b: Batching em budgets.overview                    │
│ • Pilar 4c: Paralelização Promise.all em dashboard.summary  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ ETAPA 3 (Estabilidade do Scheduler - Alto Impacto)          │
│ • Pilar 5a: Redesenho incremental do runRetentionSweep       │
│   (candidatos em decision_retention + live check focal)     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ ETAPA 4 (Desnormalização Estrutural - Médio Risco)          │
│ • Pilar 4a: Coluna last_activity_at em issues + Trigger     │
│   no banco + Script de backfill                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Critérios de Validação e Aceite

1. **Testes e Verificação:**
   * Execução de `pnpm -r typecheck` sem erros de compilação.
   * `pnpm db:generate` e verificação com `pnpm check:migrations`.
   * Suíte completa de testes unitários e de integração (`pnpm test:run`).
2. **Métricas de Performance Esperadas:**
   * Queda de **40% a 60%** no volume de writes/segundo em momentos de pico de atividade dos agentes.
   * Redução de latência P95 do endpoint `/api/companies/:companyId/issues` para **< 30ms**.
   * Eliminação dos picos periódicos de CPU a cada 30 segundos no PostgreSQL.
