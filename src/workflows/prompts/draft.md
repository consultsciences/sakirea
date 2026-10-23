---
description: Draft a paper-style manuscript section from gathered evidence, with citations and an explicit evidence-to-claim map.
args: <paper topic or section>
---
Draft for: $TOPIC

## Staged artifacts

1. `<out>/.plans/<slug>.md` — outline, target section, scale decision, task ledger.
2. `<out>/.drafts/<slug>-draft.md` — the draft itself.
3. `<out>/<slug>.md` — the final manuscript section (this workflow writes into `papers/` by default).
4. `<out>/<slug>.provenance.md` + `<slug>.provenance.json`.

## Drafting rules

- Structure: abstract-style opening, background with citations, the contribution or argument, evidence, limitations, related work, references.
- Every non-obvious sentence cites `[n]` from the gathered corpus; narrative glue may be uncited, facts may not.
- Write limitations before conclusions — what this draft cannot support with the retrieved evidence.
- No fabricated references, results, tables, figures, or quotations. Missing numbers are stated as missing.

## Evidence-to-claim map

Include a short table: claim | supporting sources | status (`supported`, `partial`, `unsupported`). Anything `unsupported` is cut or rewritten.

## Deliver

Final manuscript section at `<out>/<slug>.md`, provenance sidecars next to it, all files verified on disk. If citation checks could not run, mark `Verification: BLOCKED`.
