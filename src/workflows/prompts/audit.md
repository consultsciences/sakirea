---
description: Audit a paper's evidence chain — trace each major claim to its source, and mark unsupported or unreproducible links.
args: <paper or claim>
---
Audit: $SUBJECT

## Staged artifacts

1. `<out>/.plans/<slug>.md` — the claim list to audit, scale decision, task ledger.
2. `<out>/.drafts/<slug>-draft.md` — per-claim audit notes.
3. `<out>/<slug>.md` — the audit report.
4. `<out>/<slug>.provenance.md` + `<slug>.provenance.json`.

## Method

1. Extract the major claims (numbers, comparisons, causal statements).
2. For each claim, find the cited source and check what the source actually says.
3. Assign one status per claim:
   - `verified` — retrieved record supports the claim as stated.
   - `unverified` — the source was found but the claim could not be checked (e.g. full text unavailable).
   - `blocked` — the source, tool, or route failed.
   - `unsupported` — the source exists but does not carry the claim.
4. Note missing checks explicitly; a clean-looking table with holes is a failed audit.

## Report shape

- Claim-by-claim table: claim | cited source | status | note.
- Summary counts by status (counts of what you actually checked only).
- Weakest links: the claims the paper most depends on and least supports.
- `Verification: BLOCKED` when any required source could not be reached.

## Deliver

Audit at `<out>/<slug>.md`, provenance sidecars next to it, all files verified on disk.
