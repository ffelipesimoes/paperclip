# Relatório de melhorias do upstream — `paperclipai/paperclip`

> Gerado em 2026-06-23. Alvo de sync escolhido: **`v2026.618.0`** (release estável, 2026-06-18).
> Base comum atual: `1266954a4` (2026-04-20). **Gap: 452 commits.**
> Decisão de contexto: **o adapter `w3du-local` será removido** → não há customização a preservar, o fork pode adotar o upstream integralmente.

## TL;DR

Como o `w3du-local` será descartado, a adoção é **trivial**: alinhar `master` com a tag `v2026.618.0` e remover o pacote `w3du-local` + seus 7 pontos de registro. Sem conflitos de customização para resolver (eles desaparecem junto com o adapter).

São **~2 meses de evolução** do produto. Abaixo está o catálogo completo das melhorias, agrupado por tema e priorizado. Os itens 🔴 são "trazer sem pensar"; 🟡 são alto valor; ⚪ são contextuais/cosméticos.

---

## 1. 🔒 Segurança & isolamento multi-tenant 🔴

O bloco mais importante. Várias correções de isolamento entre empresas/tenants e de vazamento de credenciais.

- **Per-company JWT signing keys** para isolamento multi-tenant (#5864)
- **`company_id` FK nas tabelas de plugin** para isolamento de tenant (#5865)
- **Harden same-company CEO authorization** (#8276) + cobertura de rotas de role de segurança (#4589, #4586)
- **Isolar config remota das credenciais locais** — `claude_local` (#7676) e **guard `codex_local` contra chave OpenAI compartilhada** (#8272)
- **Redação de segredos**: senhas/tokens removidos de logs de erro HTTP (#8013); redação de comentários de issue deletados (#7554)
- **Parar de vazar `process.env` do host** nas probes SSH remotas de Pi (#5275) e OpenCode (#5274); strip de env herdado em execução SSH (#5142)
- **Sanitizar envs de execução remota na fronteira** (#5325)
- **`TRUST_PROXY` com CIDR list + subnets nomeadas** (#5872)
- **better-auth 1.4.18 → 1.6.20** (#8464) e outros bumps de segurança (aws-sdk, esbuild, i18next)
- Secrets provider vaults + import remoto (#5429); resolver secret refs antes das probes de sandbox (#8256)
- Harden de runtime de plugin (#6547), backups de DB não-system (#4960), Cloudflare sandbox (#5967)

## 2. 🧩 Novos adapters & modelos 🟡

O upstream ganhou adapters que não temos (o `w3du-local` morre, esses entram no lugar):

- **`grok_local`** built-in (#6087)
- **`cursor_cloud`** — Cursor SDK + Cloud Agents API v1 (#5664)
- **`acpx-local`** runtime (#4893) + ACPX-Claude seamless (#6590)
- **Routing por env (gateway)** — relevante se você for plugar provider próprio sem escrever adapter:
  - `codex_local` via `PAPERCLIP_CODEX_PROVIDERS` config.toml (#7919)
  - `pi_local` via `PAPERCLIP_PI_PROVIDERS` models.json (#7920)
  - `opencode_local` custom providers + small/cheap model (#7837)
- **Override externo de built-ins** (#7394) — permite customizar adapters sem fork
- Novos modelos: **Claude Fable 5 e Mythos 5** no seletor (#7826), GPT-5.5 no Codex local (#5575)
- Robustez: claude refusal → `errorCode` (#8314), recover de `previous_message_id` 400 (#5972), gemini token-overflow como fresh-session (#4932)

## 3. ☁️ Sandbox providers self-hostable & execução remota 🟡

Vários providers de sandbox novos + hardening de execução remota:

- **Kubernetes self-hostable** (3 estágios: plugin #5790, integração #7938, imagens de runtime #7934)
- **Modal** (#6245), **Daytona** (#5580 + lease reuse #8513), **Cloudflare** (#5687), **exe.dev** (#5688), **Novita** (#7595) providers
- **SSH environment support** (#4358) + UX de config exe.dev (#7025)
- **Environments instance-scoped** (#8375) + índice único parcial p/ dedup de sandbox (#8247)
- Hardening de probes/timeouts/sync remoto (#5685, #5444, #5922); workspace diff viewer plugin (#6071)
- Bridge de callback de sandbox para acesso à API em ambiente remoto (#4801)

## 4. 🔁 Confiabilidade do runtime (heartbeat, recovery, routines, blockers, watchdog) 🔴

O grosso dos 101 `fix:` — correções de confiabilidade que valem por si só:

- **Heartbeat**: evitar coalescing de zombie runs + reap no startup (#1731); liberar lock de execução em reassignment (#5110); limpar locks órfãos ao finalizar run (#4318); não reusar `sessionId` em troca de adapter (#4109)
- **Recovery**: pular recovery de issue stranded quando há wake pendente (#4854); retry streaks por causa de falha (#7031); bound em loops de productivity review (#4948)
- **Routines**: suprimir ticks agendados com projeto pausado (#7502); detectar variáveis com underscore markdown-escaped (#8056); histórico de revisão + restore (#5285); env secrets (#6212)
- **Task watchdog** — control plane novo (#8339)
- **Blockers/DAG**: heartbeat blocker-aware (#4157, já na base), guards de decomposição de plano exact-once (#6831)
- Approval service idempotency, retry-now recovery (#5426)

## 5. 🖥️ UI / UX 🟡

- **NUX rework** (atrás de flag `enableConferenceRoomChat`) — onboarding em cápsula, conference-room chat, composer unificado (#8000)
- **Sidebar rail colapsável + takeover panes** (#7824); Information Architecture + refresh visual (#7543)
- **Routine detail page** redesenhada (#7848); blocked inbox attention view (#5603)
- **Tema**: `prefers-color-scheme` para novos visitantes (#5873) + toggle na auth page (#5874)
- **i18n runtime** (#6058); página de company artifacts (#7621); busca de company (#5293)
- **Mobile**: org chart nav (#4127, já na base), board flows (#6550)
- Issue Output UI / artifact playback (#10168), thumbnails de vídeo (#7667), kanban escalável p/ colunas grandes (#5309), sub-issue navigation ordenada (#5938)
- Diversos fixes de scroll/PWA/toast (#8071, #8041, #1931)

## 6. 🗄️ DB, migrations & performance ⚪🟡

- Cache de `Intl.DateTimeFormat` por timezone no cron stepper (#8033)
- Split de migration Issue→Task (#7651), snapshots de migration faltantes
- Backups de DB expandidos para schemas não-system (#4859/#4960)
- Speed up do CI/PR critical path (#5147, #6137); load de company skill detail (#4380)
- Bump postgres 3.4.8 → 3.4.9 (#7567)

## 7. 📊 Observability, evals & custos ⚪

- **OpenTelemetry opt-in** (auto-instrumentation) (#3735)
- Item de Feedback no menu de conta (#7854) — captura para evals
- Cancelamento de interação de workflow + resumo de custos por issue (#4862)
- Guard de uso de modelo de recovery barato (#6371)

## 8. 🛠️ Plugins, SDK & dev tooling ⚪

- **commitperclip**: gates automáticos de qualidade + segurança em PR (#6469), dedup-search (#7632)
- Teams catalog extraction (#7550); skills CLI + catalog management (#6782)
- Document annotations & comments (#6733); resource membership controls (#6677)
- Issue forms YAML (bug/feature/adapter) (#7575); bumps de GitHub Actions

---

## Priorização sugerida

| Prioridade | Temas | Justificativa |
|---|---|---|
| 🔴 **Trazer já** | §1 Segurança · §4 Confiabilidade do runtime | Correções que afetam isolamento de dados e estabilidade de execução — valem independente do uso. |
| 🟡 **Alto valor** | §2 Adapters · §3 Sandbox self-hostable · §5 UI | Capacidades novas. Adapters/sandbox importam se você roda execução self-hosted; UI melhora o produto. |
| ⚪ **Contextual** | §6 DB/perf · §7 Observability · §8 Tooling | Vêm de brinde no sync; ative o que usar (ex.: OTel só se tiver coletor). |

## Como aplicar (w3du removido → adoção limpa)

1. Branch de integração a partir de `master`.
2. `git merge v2026.618.0` (ou rebase). Como o `w3du-local` será removido, **remova o pacote e seus registros** em vez de resolver os conflitos — os 7 pontos de toque deixam de conflitar:
   - `packages/adapters/w3du-local/` (deletar)
   - `ui/src/adapters/w3du-local/` (deletar)
   - tirar `w3du_local` de: `server/src/adapters/registry.ts`, `builtin-adapter-types.ts`, `ui/src/adapters/registry.ts`, `adapter-display-registry.ts`, `packages/shared/src/constants.ts`, `server/package.json`, `Dockerfile`
3. `pnpm install` (regenerar lockfile) + `pnpm build` + testes.
4. Smoke test do app contra a versão alvo.

> Observação: como **todos** os 452 commits passam a ser aplicáveis (sem customização a preservar), a forma mais simples e correta é adotar a árvore inteira da tag `v2026.618.0`, não cherry-pick. Este relatório serve para você saber *o que ganha* e em que ordem validar.
