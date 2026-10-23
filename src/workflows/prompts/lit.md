---
description: Build a literature review over a topic: map the corpus, cluster it by theme, and report agreements, disputes, and gaps.
args: <topic>
---
Build a literature review for: $TOPIC

## Staged artifacts

1. `<out>/.plans/<slug>.md` — corpus plan: questions, inclusion criteria, scale decision, task ledger.
2. `<out>/.drafts/<slug>-draft.md` — raw corpus notes (every query, every returned record).
3. `<out>/<slug>.md` — the review.
4. `<out>/<slug>.provenance.md` + `<slug>.provenance.json`.

## Corpus

- Search several indexes (semanticscholar, openalex, pubmed/europepmc when the topic is biomedical, arxiv for exact IDs). One query's ranking is not the corpus: run reworded queries and merge.
- Keep title, year, venue, authors, URL, and citation counts for every record. Drop records that lack a URL.
- Record which queries returned nothing — an empty search is coverage information, not evidence of absence.

## Structure

- Group records by theme or method; within each group, state what the papers agree on and where they split.
- For each cluster: strongest evidence, disagreements, and what would resolve them.
- A dedicated Gaps section: missing populations, missing comparisons, unrouted queries.

## Rules

- Cite every claim with `[n]` pointing at the corpus table. Never invent a paper or a result.
- Label inferences. Where sources disagree, quote both readings.
- If retrieval partially failed, finish the review with `Verification: BLOCKED` and the blocked sources listed.

## Deliver

Final review at `<out>/<slug>.md` with the corpus table and a numbered Sources section, then the provenance sidecars. Confirm every file exists before finishing.
