---
name: B2B Sales & Outreach
description: Bundled revenue team that pairs a Sales Lead with an outbound SDR to discover leads, craft outreach sequences, and qualify pipeline.
schema: agentcompanies/v1
slug: b2b-sales
category: sales
key: paperclipai/bundled/sales/b2b-sales
manager: agents/sales-lead/AGENTS.md
includes:
  - agents/sdr/AGENTS.md
  - projects/sales-pipeline/PROJECT.md
defaultInstall: false
recommendedForCompanyTypes:
  - b2b
  - saas
  - agency
  - sales
tags:
  - sales
  - outbound
  - sdr
  - pipeline
requiredSkills:
  - paperclipai/bundled/paperclip-operations/task-planning
  - paperclipai/bundled/paperclip-operations/issue-triage
---

# B2B Sales & Outreach

A drop-in sales pod for companies that want an autonomous outbound and lead qualification engine.

## Contents

- `SalesLead` — Revenue manager and team root. Analyzes ideal customer profiles (ICP), orchestrates campaigns, and qualifies sales opportunities.
- `SDR` — Outbound Sales Representative. Discovers leads, writes personalized cold outreach copy, and logs prospect responses.
- `sales-pipeline` project — the rolling CRM/pipeline backlog this pod works against.
- `weekly-pipeline-review` routine — recurring Sales Lead check-in to inspect qualification velocity and pipeline health.

## Skill rationale

- `task-planning` lets the Sales Lead turn campaign goals into clear lead research and outreach assignments.
- `issue-triage` keeps prospect inquiries and pipeline updates prioritized.
