# Engine dossier

How each engine of the upstream research agent **Feynman**
(`github.com/Companion-Inc/feynman`, MIT) maps onto a Sakirea module, with the exact
upstream file paths used as evidence, and what was deliberately not ported.

Legend — **status**:

- `reimplemented` — the engine exists in Sakirea with equivalent responsibility.
- `reimplemented (subset)` — the engine exists, but specific upstream behaviours were left out (named in the note).
- `not ported` — out of Sakirea's scope; recorded so the gap is explicit.
- `new` — no upstream equivalent; Sakirea-specific surface.

## 1. Engine map

| # | Upstream engine (evidence: exact upstream file) | Sakirea module | Status | Note |
|---|------------------------------------------------|----------------|--------|------|
| 1 | Unified science-database tool — `extensions/research-tools/science-databases.ts` | `src/sources/index.ts` (`sakirea_science_database_search`) | reimplemented (subset) | Same 8 source ids (`arxiv biorxiv crossref europepmc medrxiv openalex pubmed semanticscholar`), same limit clamp 1..20 default 5, same `sort` values `relevance`/`pub_date`, same 25 s timeout. Upstream's rich query-flag syntax (`openalex_citations:`, `recent_days=`, …) is not ported. |
| 2 | arXiv connector — `extensions/research-tools/science-database-arxiv.ts` | `src/sources/arxiv.ts` + `src/sources/xml.ts` | reimplemented (subset) | Endpoint `https://export.arxiv.org/api/query`, 3 s pacing, 429 retry-once, provenance `{docs, endpoints}`. Upstream resolves **IDs only** (topic search removed there); Sakirea also allows lexical `search_query=all:"…"` and parses the Atom feed with a hand-rolled reader (upstream uses the `fast-xml-parser` dependency). `ArxivTopicQueryError`/`ArxivUnavailableError` fallbacks are not ported. |
| 3 | OpenAlex connector — `extensions/research-tools/science-database-openalex.ts` | `src/sources/openalex.ts` | reimplemented (subset) | Endpoint `https://api.openalex.org/works`, `per-page`, `sort=relevance_score:desc`/`publication_date:desc`, optional `OPENALEX_API_KEY` redacted from recorded endpoints, abstract reconstruction from the inverted index. |
| 4 | OpenAlex exact/semantic filters — `extensions/research-tools/science-database-openalex-exact.ts` | — | not ported | Filter grammar (`openalex_citations:`, `semantic:` prefix) deferred (README roadmap). |
| 5 | PubMed connector — `extensions/research-tools/science-database-pubmed.ts`, `science-database-pubmed-parsers.ts` | `src/sources/pubmed.ts` | reimplemented (subset) | `esearch.fcgi` + `esummary.fcgi` under `https://eutils.ncbi.nlm.nih.gov/entrez/eutils`, join by PMID, DOI from `articleids`, provenance lists both endpoints. `efetch` full-text/XML paths, PMC id-conversion, and citation lookups are not ported. |
| 6 | Preprints connector — `extensions/research-tools/science-database-preprints.ts` | `src/sources/preprints.ts` | reimplemented (subset) | `https://api.biorxiv.org/details/{server}/…` for DOI and date-window queries (60-day default window, local token filter), Europe PMC `SRC:PPR AND PUBLISHER:"bioRxiv"|"medRxiv"` for topic text — verified live against the EPMC API, because the bioRxiv details API has no text search. Funder/publisher/stats subcommands are not ported. |
| 7 | Europe PMC — `extensions/research-tools/science-database-europepmc-fulltext.ts` | `src/sources/europepmc.ts` | reimplemented (subset) | Metadata search over `https://www.ebi.ac.uk/europepmc/webservices/rest/search` (`resultType=lite`); upstream's **full-text section** retrieval is not ported (README roadmap). |
| 8 | Crossref connector (inside `science-databases.ts`) | `src/sources/crossref.ts` | reimplemented | `https://api.crossref.org/works`, `select=` projection, polite-pool `mailto`, 429 surfaced with guidance. |
| 9 | Semantic Scholar connector (inside `science-databases.ts`) | `src/sources/semanticscholar.ts` | reimplemented | `https://api.semanticscholar.org/graph/v1/paper/search` (+ `/bulk` for `sort=pub_date`), abstract trimmed to 600 chars, 429 retried once then reported. |
| 10 | Request pacer — `extensions/research-tools/request-pacer.ts` | `src/sources/pacer.ts` | reimplemented | Same serialized-gap algorithm; Sakirea keys one pacer per host with documented per-host budgets (arXiv 3000 ms, Crossref 1200 ms, OpenAlex/S2 1100 ms, eutils 400 ms …). |
| 11 | Shared HTTP/timeout handling (inline in each connector) | `src/sources/http.ts` | reimplemented | 25 s timeout via `AbortController`, `retry-after` parsing, injectable `fetch` (`setFetch`/`resetFetch`) that makes the test suite network-free. |
| 12 | Web search + page fetch — upstream ships via the `pi-web-access` dependency (`package.json` → `dependencies`) and the tools `web_search`/`fetch_content` (see `.feynman/agents/researcher.md`) | `src/sources/web.ts` | reimplemented | Key-free `web_search` on `https://html.duckduckgo.com/html/?q=…` (result links + snippets, redirect unwrapping) and `fetch_content` (fetch → strip HTML → cap ~50 000 chars). Both return explicit **degraded** envelopes on failure instead of throwing. Upstream's provider routing, recency/domain filters and `includeContent` are not ported. |
| 13 | Hugging Face tools — `extensions/research-tools/huggingface.ts` | `src/sources/huggingface.ts` | reimplemented (subset) | `hf_repo_files`, `hf_repo_read_file` (same blocked-binary extension set, 20 000/60 000-char read caps) on `https://huggingface.co/api`, plus a new key-free `hf_search`; upstream's `hf_dataset_info` is covered by `hf_search` with `kind: "dataset"`. |
| 14 | Model registry — `src/model/registry.ts`, `src/model/catalog.ts`, `src/model/api-key-providers.ts`, `src/model/models-json.ts`, `src/model/commands.ts` (Pi `ModelRuntime`) | `src/model/registry.ts`, `src/model/chat.ts` | reimplemented (subset) | Provider registry (openai, anthropic, openrouter, local Ollama `http://localhost:11434/v1`), `listModels()`/`resolveModel()` with **no key required to list**, defaults `gpt-4o-mini`/`claude-sonnet`. Sakirea uses a static id catalog instead of Pi's `ModelRuntime` + `models.json`, and one OpenAI-compatible `POST /chat/completions` helper. |
| 15 | Agent policy — `.feynman/SYSTEM.md` | `src/agents/SAKIREA.md` | reimplemented | Rewritten in Sakirea's own words, keeping the principles: evidence over fluency, observation ≠ inference, never invent results, cite title/year/URL, degraded `BLOCKED`/`UNVERIFIED` statuses, artifacts on disk rather than chat-only. |
| 16 | Subagent personas — `.feynman/agents/researcher.md`, `verifier.md`, `reviewer.md`, `writer.md` | `src/agents/roles/*.md` + `src/agents/loader.ts` | reimplemented (subset) | Same four roles, same integrity contracts (URL-or-it-didn't-happen, honest statuses, `FATAL/MAJOR/MINOR`, evidence tables). Sakirea's loader runs them as sequential pipeline stages; Pi's `subagent` tool wiring, `thinking: high`, and `async` flags are not ported. |
| 17 | Orchestration / runtime — `src/pi/launch.ts`, `src/pi/runtime.ts`, `src/pi/settings.ts`, `src/pi/packages.ts`, `bin/feynman.js` (wraps the Pi coding agent) | `src/agents/orchestrator.ts` | reimplemented (subset) | One chat-completions call per role step in llm mode; deterministic template synthesis with `mode: deterministic (no LLM key)` when no key exists; per-step errors degrade the artifact instead of aborting. No Pi runtime, no REPL, no background subagents, no RPC. |
| 18 | Workflow prompts — `prompts/deepresearch.md`, `lit.md`, `review.md`, `audit.md`, `replicate.md`, `recipe.md`, `compare.md`, `draft.md`, `autoresearch.md`, `summarize.md` (+ `log.md`) | `src/workflows/prompts/*.md` (10 files) + `src/workflows/registry.ts` | reimplemented (subset) | Same ten workflows with frontmatter (`description`, `args`), same staged artifacts (plan → drafts → final → provenance), same scale decision (direct vs multi-agent), same degraded rule (`Verification: BLOCKED`). `log.md` (session log) is not ported; Sakirea's prompts are rewritten, not copied. |
| 19 | Workflow execution + slug/naming conventions — `AGENTS.md` (§ Output conventions, § File naming) | `src/workflows/runner.ts` | reimplemented | `deriveSlug()` (≤5 words, lowercase-hyphenated, filler words dropped), staged writes `outputs/.plans/<slug>.md` → `outputs/.drafts/<slug>-draft.md` → `outputs/<slug>.md` (or `papers/` for `draft`) → sidecars. |
| 20 | Provenance & verification conventions — `AGENTS.md` (§ Provenance and verification), provenance blocks inside `prompts/deepresearch.md` and `prompts/lit.md` | `src/provenance/sidecar.ts` | reimplemented | `<slug>.provenance.md` + `<slug>.provenance.json`: source table (title, DB, URL/DOI, queried-at, status), `## Endpoints` listing docs + API endpoints actually used (the upstream `{docs, endpoints}` connector metadata concept), tool/model/mode metadata, verification line. |
| 21 | Telemetry — `src/telemetry/posthog.ts` (`posthog-node` in `package.json`), `extensions/research-tools/telemetry.ts` | `src/telemetry/noop.ts` | reimplemented | Deliberate absence: `TELEMETRY_ENABLED = false`, no-op `track`/`flush`, documented contrast with upstream PostHog. |
| 22 | Config & paths — `src/config/paths.ts` (`FEYNMAN_HOME`, `.feynman/`), `src/config/json-file.ts`, `.feynman/settings.json` | `src/config/paths.ts` | reimplemented (subset) | `SAKIREA_HOME` → `settings.json` (`mode`, `model`, `out`, `host`, `port`), corrupt/missing settings degrade to `{}`. |
| 23 | CLI surface — `src/cli.ts`, `metadata/commands.mjs`, `bin/feynman.js` | `src/cli.ts` + `bin/sakirea.mjs` | reimplemented (subset) | Command-style only: topic/workflow run, `sources`, `workflows`, `search`, `serve`, `--help`, `--version`, `--mode`, `--out`. Interactive TUI, slash-command registry, installers, and self-update are not ported. |
| 24 | HTTP API | — | new | Upstream exposes no HTTP server; `src/server.ts` (`node:http`, CORS, 1 MiB body limit, uniform `{error:{code,message}}`) exists so browser apps can call the engines. |
| 25 | Skills — `skills/<name>/SKILL.md` (17 packs) | — | not ported | Out of scope for the engine reimplementation (README roadmap). |
| 26 | Ancillary research tools — `extensions/research-tools/{alpha,alpha-sections,discovery,project,help,current-date,header,ncbi-rate-limit,service-tier,model-error-hint,launch-notice,docx-fallback,project-scaffold,telemetry}.ts` | — | not ported | alphaXiv (`@companion-ai/alpha-hub`, login-gated), scaffolding, UI chrome, and rate-limit hints are outside Sakirea's engine scope. |

## 2. Reverse-engineering evidence

The shipped npm artifact was reverse-engineered with REA (static analysis of the
published package) to ground this mapping. Citations:

| Fact | Value |
|------|-------|
| Parent application-graph Evidence | `ev_9d0149a9061e1f0c2b0cb5c16b94d1546c9287b1c527078df9dd0fc1d33846ee` |
| Summary view Evidence | `ev_8ef9a67756ec43ce82adeb23bab20af0404ac490582137e509e3d6b60a526a67` |
| Artifact SHA-256 | `ca8296fb5dca9efedcb0e234e3ff425b4017c5d0b64f41af93132cb50bb0de0a` |
| Package | `companion-ai-feynman@0.5.56` |
| Tarball | 108 files |
| Parsed JavaScript | 61 files |
| Findings | 895 |
| Request relations | 57 |

The summary view reports 61 parsed JS files, 895 findings, and 57 request
relations across the tarball; those counts are observations of the published
artifact, not of the git checkout.

### Limitations of this evidence

- **Static analysis only.** The Evidence above comes from parsing the shipped
  npm package; no runtime execution, no traffic capture, and no dynamic
  instrumentation of the upstream package was performed or is claimed.
- **Counts describe one build.** The file/finding/relation counts are for
  `companion-ai-feynman@0.5.56` at the artifact digest above; other versions
  will differ.
- **Relationship coverage is bounded by static resolution.** Dynamic dispatch,
  runtime-computed URLs, and code loaded from dependencies outside the tarball
  may not appear in the 57 request relations.
- **The mapping table above is an architectural correspondence, not a
  byte-for-byte port.** Where Sakirea differs (hand-rolled Atom parsing,
  deterministic mode, the HTTP API, no telemetry), the difference is stated in
  the Note column rather than implied.
- The upstream source checkout
  (`_upstream/feynman`, reference copy) was read alongside the artifact to pin
  exact file paths; functional facts mirrored deliberately include endpoint
  URLs, tool names, limit clamps, pacing intervals, and staged-artifact rules.
