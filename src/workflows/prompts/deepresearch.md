---
description: Run a thorough, source-heavy investigation on a topic and produce a durable research brief with inline citations.
args: <topic>
---
Investigate the topic: $TOPIC

## Required artifacts (staged — never pre-create a later stage)

Every run leaves these on disk, in order:

1. `<out>/.plans/<slug>.md` — plan: key questions, evidence needed, scale decision, task ledger, verification log, decision log.
2. `<out>/.drafts/<slug>-draft.md` — evidence notes and the pre-citation draft.
3. `<out>/<slug>.md` — the final brief.
4. `<out>/<slug>.provenance.md` and `<out>/<slug>.provenance.json` — provenance sidecars.

The slug comes from the topic: lowercase, hyphenated, filler words dropped, at most 5 words.

## Scale decision (make it in the plan, before gathering)

- Narrow "what is X" questions and work answerable in a handful of lookups → **direct**: one lead pass, no researcher fan-out.
- Direct comparison of 2–3 items → two researcher passes.
- Broad survey or multi-faceted topic → three or four researcher passes.
- Do not inflate an explainer into a survey.

## Gather

- Minimum three distinct queries in direct mode, covering definition/history, mechanism, and current usage.
- Prefer abstracts, official docs, and metadata; read full text only for the papers the conclusions depend on.
- Record the exact queries used in the draft file.
- If a source fails, record the failure and continue: another index usually answers.

## Draft

Write the brief yourself: executive summary, findings by theme, evidence-backed caveats, open questions. No invented sources, numbers, tables, or benchmarks.

## Cite and verify

- Sweep the draft: every claim, number, or comparison maps to a URL, a research note, or captured output; otherwise remove or downgrade it.
- Mark inferences as inferences.
- If verification could not be completed, write `Verification: BLOCKED` and list the missing checks.

## Deliver

Write the final brief to `<out>/<slug>.md`, then the provenance sidecars next to it (sources consulted, endpoints used, per-source status, tool/mode/model). Verify all required files exist before finishing — never end with chat-only prose.
