---
description: Plan a replication of a reported result — and, where the check is runnable from here, execute the smallest decisive test.
args: <result to replicate>
---
Replication target: $TOPIC

## Staged artifacts

1. `<out>/.plans/<slug>.md` — replication plan: claims, required materials, scale decision, task ledger, verification log.
2. `<out>/.drafts/<slug>-draft.md` — evidence and experiment notes (raw outputs only; no conclusions yet).
3. `<out>/<slug>.md` — the replication report.
4. `<out>/<slug>.provenance.md` + `<slug>.provenance.json`.

## Plan

- State the exact reported result: quantity, dataset, baseline, and where it was reported (URL/DOI).
- List what a replication needs: data availability, code availability, compute, environment.
- Decide scope: **full replication**, **partial** (one decisive sub-check), or **blocked** (materials unavailable) — record the decision and why.

## Execute the smallest decisive check

- Prefer the cheapest check that could falsify the claim: recompute from a public table, re-run a tiny configuration, or verify the reported arithmetic.
- Save code, inputs, and raw outputs under `<out>/` before drawing conclusions.
- Treat results cleaner than expected as suspect until re-checked.

## Report

- Plan vs. what ran; exact commands/paths; observed values versus reported values — side by side.
- Status per check: `verified`, `unverified`, `blocked`. Never claim reproduction without the raw artifact pointing to it.
- If nothing could be executed, deliver the plan with `Verification: BLOCKED` and the missing materials listed — still write the artifact.

## Deliver

Report at `<out>/<slug>.md`, provenance sidecars next to it, all files verified on disk.
