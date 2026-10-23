---
description: Run an iterative research loop — generate questions, gather evidence, verify, refine — until the artifact stops improving.
args: <topic>
---
Research loop for: $TOPIC

## Staged artifacts

1. `<out>/.plans/<slug>.md` — live plan: question queue, task ledger, verification log, decision log (update it every round).
2. `<out>/.drafts/<slug>-round-N.md` — notes per round.
3. `<out>/<slug>.md` — the final artifact after the last round.
4. `<out>/<slug>.provenance.md` + `<slug>.provenance.json` — including per-round coverage.

## Loop

Round structure (repeat until the stop condition):

1. **Generate** 2–4 answerable questions the current artifact cannot answer. Rank by how much an answer would change the conclusion.
2. **Gather** evidence for the top questions — one query angle per question, reworded if empty.
3. **Verify**: attach `verified` / `unverified` / `blocked` to each new claim; record failures.
4. **Refine**: update the artifact and the plan ledger; drop answered questions, keep blocked ones with their reason.

Stop when: no question remains that evidence could plausibly answer, two consecutive rounds add nothing new, or a hard round/time budget is hit. Record which condition fired.

## Rules

- Every round writes to disk before the next begins; the plan file is the working memory.
- Never carry a claim forward without its source URL.
- If several rounds are blocked on the same missing capability, finish with `Verification: BLOCKED` and the missing capability named.

## Deliver

Final artifact at `<out>/<slug>.md` with a Round summary section, provenance sidecars next to it, all files verified on disk.
