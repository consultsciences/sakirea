---
description: Compare 2–3 named items on shared dimensions, with an evidence cell for every claim.
args: <item A> vs <item B> [vs <item C>]
---
Compare: $TOPIC

## Staged artifacts

1. `<out>/.plans/<slug>.md` — items, comparison dimensions, scale decision (one researcher pass per item when in doubt), task ledger.
2. `<out>/.drafts/<slug>-draft.md` — draft notes, one section per item.
3. `<out>/<slug>.md` — the comparison.
4. `<out>/<slug>.provenance.md` + `<slug>.provenance.json`.

## Rules for the comparison table

- Choose dimensions first (from the question being asked), then gather per item — do not let one item's marketing shape the axes.
- Every cell carries evidence: `[n]` citation, `n/a`, or `not established`. Empty cells are not zero.
- Same metric, same conditions, or the cell says the numbers are not comparable.
- Date every row: comparisons rot; state the retrieval date.

## Report shape

- One-paragraph verdict with its confidence level and what would change it.
- The comparison table with an evidence column.
- Per-item evidence sections (strengths, weaknesses, what each is for).
- Disagreements and gaps; open questions.

## Deliver

Comparison at `<out>/<slug>.md`, provenance sidecars next to it, all files verified on disk. If a source for one item failed, the verdict carries `Verification: BLOCKED`.
