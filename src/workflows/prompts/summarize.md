---
description: Summarize one research source — paper, report, repository, or URL — into a structured, source-faithful summary.
args: <source: title, URL, or identifier>
---
Summarize: $TOPIC

## Staged artifacts

1. `<out>/.plans/<slug>.md` — what the summary must cover; slug derives from the source (title or URL domain), ≤5 words.
2. `<out>/.drafts/<slug>-draft.md` — notes taken from the retrieved record and any fetched text.
3. `<out>/<slug>.md` — the summary.
4. `<out>/<slug>.provenance.md` + `<slug>.provenance.json`.

## Source handling

- Retrieve the source first (identifier lookup, then URL fetch). Nothing is summarized from memory.
- If only metadata and an abstract were retrievable, the summary says so and covers metadata-level content only.
- If the source could not be retrieved, write the artifact with `Verification: BLOCKED` and the retrieval error — still deliver.

## Output shape

- Header: title, authors, year, venue, identifier/URL, retrieval status.
- Key claims (3–7 bullets, each traceable to the source text you actually read).
- Technical hinges: the 2–4 decisions the source turns on.
- Limitations the source itself flags.
- Follow-up questions (3).
- Sources: the single source, plus any corroborating record.

## Rules

- No outside knowledge beyond what was retrieved; no invented context about authors or labs.
- Keep quotes short and exact; paraphrases stay faithful.

## Deliver

Summary at `<out>/<slug>.md`, provenance sidecars next to it, all files verified on disk.
