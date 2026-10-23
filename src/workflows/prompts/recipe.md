---
description: Produce a source-backed experimental or training recipe — data, method, hyperparameters, compute, and implementation pointers.
args: <task, model, or result>
---
Recipe for: $TOPIC

## Staged artifacts

1. `<out>/.plans/<slug>.md` — recipe outline, scale decision, task ledger.
2. `<out>/.drafts/<slug>-draft.md` — candidate recipes with evidence.
3. `<out>/<slug>.md` — the recipe.
4. `<out>/<slug>.provenance.md` + `<slug>.provenance.json`.

## Per candidate recipe, capture only what a source states

- Paper or source, with date and URL.
- Exact reported result and benchmark (quote the number and where it appears).
- Dataset: name, size, split, URL, license, access constraints — checked, or marked unverified.
- Method and hyperparameters: optimizer, learning rate, schedule, epochs/steps, batch size, model/checkpoint, loss, metric.
- Compute: hardware, runtime, or cost **only when stated**.
- Implementation grounding: repo path, script/class names, command pattern — only after a retrieval returned them.
- Verification status: `verified`, `unverified`, `blocked`.

## Rules

- Rank candidates by feasibility and result quality; say which axis drove the ranking.
- Do not describe a dataset as usable unless availability and format were checked, or say the check is missing.
- Missing hyperparameters become `unknown (not stated in source)` — never plausible defaults presented as facts.

## Deliver

Recipe at `<out>/<slug>.md` (ordered steps, then the evidence table and Sources), provenance sidecars next to it, all files verified on disk.
