---
description: Produce a critical, evidence-bounded review of a paper, claim, or line of work — strengths, weaknesses, and verdict.
args: <subject>
---
Review: $SUBJECT

## Staged artifacts

1. `<out>/.plans/<slug>.md` — what must be checked, scale decision, task ledger.
2. `<out>/.drafts/<slug>-draft.md` — review notes with evidence.
3. `<out>/<slug>.md` — the review.
4. `<out>/<slug>.provenance.md` + `<slug>.provenance.json`.

## What the review must cover

- **Claim map**: what the work actually claims, separated into central and peripheral.
- **Evidence quality**: are the claims supported by the cited records? Single-source critical claims are flagged.
- **Method soundness**: design, baselines, evaluation, and anything checkable from available sources.
- **Novelty context**: prior work the subject builds on or ignores (only from retrieved sources).
- **Reproducibility**: what would be needed to reproduce it, and what is missing.

## Rules

- Verdict vocabulary: `PASS`, `PASS WITH NOTES`, `BLOCKED` — assigned only after the checks are listed.
- Never assert that something was checked when it was not; write `blocked` or `unverified` instead.
- Every criticism names its evidence: quote or `[n]` citation.
- No invented citations, metrics, or reviewer credentials.

## Deliver

Review at `<out>/<slug>.md`, provenance sidecars next to it, all files verified on disk.
