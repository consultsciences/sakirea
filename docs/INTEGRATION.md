# Integrating Sakirea into a web app

Sakirea runs as a small standalone HTTP service. Your app talks to it with plain
`fetch` — no npm dependency, no build changes, no impact when it is absent.

```
your app ──fetch──▶ sakirea serve (127.0.0.1:4599) ──▶ arXiv / OpenAlex / PubMed /
                                                        Europe PMC / bioRxiv / medRxiv /
                                                        Crossref / Semantic Scholar / web
```

Reference implementations live in the four `consultsciences` apps that already
use this contract: `clinical-dojo` (node:http), `pharmaiq-evidence` (Express/TS),
`catalystiq` and `regsignal` (Express/ESM).

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `SAKIREA_URL` | `http://127.0.0.1:4599` | Base URL of the Sakirea service. Empty ⇒ disabled. |
| `SAKIREA_DISABLED` | — | `1` disables all proxied routes regardless of URL. |
| `SAKIREA_TIMEOUT_MS` | `30000` | Timeout for search/sources/workflows-list calls. |
| `SAKIREA_WORKFLOW_TIMEOUT_MS` | `180000` | Timeout for full workflow runs (they stage artifacts). |
| `SAKIREA_OUTPUT_DIR` | `<app>/outputs/research` | Where workflow artifacts + provenance sidecars are written (on the Sakirea host). |

Start the service:

```powershell
node <path-to-sakirea>/bin/sakirea.mjs serve           # 127.0.0.1:4599
node <path-to-sakirea>/bin/sakirea.mjs serve --port 5001 --host 0.0.0.0
```

## The five-route contract

Every route except `/config` answers `503 {error:{code,message}}` with code
`sakirea_disabled` (service intentionally off) or `sakirea_unavailable`
(fetch failed / timed out). The app must remain fully functional without
Sakirea.

| Route | Body | Success | Failure codes |
| --- | --- | --- | --- |
| `GET /api/research/config` | — | `{ok:true, enabled, url, outputDir}` (never fails) | — |
| `GET /api/research/sources` | — | `{ok:true, sources:[{id,docs,endpoints}]}` | `sakirea_disabled`, `sakirea_unavailable` |
| `GET /api/research/workflows` | — | `{ok:true, workflows:[{id,description,agents,outputDir}]}` | same |
| `POST /api/research/search` | `{source,query,limit?,sort?}` | Sakirea search envelope + provenance | + `bad_request` (400), `sakirea_upstream_error` (502) |
| `POST /api/research/workflows/:id/run` | `{topic,mode?}` | `{slug,artifactPath,provenancePath,status,…}` | + `bad_request` (400), `sakirea_upstream_error` (502) |

Validation (app-side, before proxying):

- `source` ∈ `arxiv, biorxiv, crossref, europepmc, medrxiv, openalex, pubmed, semanticscholar`
- `query` non-empty, ≤ 500 chars; `limit` integer 1..20 (default 5); `sort` ∈ `relevance, pub_date`
- workflow `id` ∈ `deepresearch, lit, review, audit, replicate, recipe, compare, draft, autoresearch, summarize`
- `topic` 3..300 chars; `mode` ∈ `deterministic, llm` (optional)

A workflow run is synchronous and can take up to
`SAKIREA_WORKFLOW_TIMEOUT_MS`; `artifactPath`/`provenancePath` are absolute
paths on the **Sakirea host** — when Sakirea runs on the same machine they are
directly readable by the app.

## Client skeleton (zero dependencies)

```js
// lib/sakirea.mjs
const URL_ = process.env.SAKIREA_URL ?? "http://127.0.0.1:4599";
const OFF = process.env.SAKIREA_DISABLED === "1" || !URL_;

async function call(path, { method = "GET", body, timeout = 30_000 } = {}) {
  if (OFF) throw { code: "sakirea_disabled", message: "Sakirea integration disabled" };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(URL_ + path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw { code: json?.error?.code ?? "sakirea_upstream_error", message: json?.error?.message ?? `sakirea ${res.status}` };
    return json;
  } catch (e) {
    if (e?.code) throw e;
    throw { code: "sakirea_unavailable", message: String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

export const sakireaConfig = () =>
  OFF ? { ok: true, enabled: false, url: null, outputDir: null }
      : { ok: true, enabled: true, url: URL_, outputDir: process.env.SAKIREA_OUTPUT_DIR ?? null };
export const sakireaSources    = () => call("/api/sources");
export const sakireaWorkflows  = () => call("/api/workflows");
export const sakireaSearch     = (q) => call("/api/search", { method: "POST", body: q });
export const sakireaRunWorkflow = (id, q) =>
  call(`/api/workflows/${encodeURIComponent(id)}/run`, {
    method: "POST", body: q, timeout: Number(process.env.SAKIREA_WORKFLOW_TIMEOUT_MS ?? 180_000),
  });
```

## Integration checklist

1. Add the client module and the five routes behind the app's existing
   middleware (auth / rate limiting / error shape) — match the app's error
   response convention, keeping the machine `code` field.
2. Gate everything on `SAKIREA_URL`/`SAKIREA_DISABLED`; expose
   `/api/research/config` so the UI can render a disabled state.
3. Add the env vars to `.env.example`, `outputs/` to `.gitignore`.
4. Offline tests only: disabled contract (503 + code), proxy passthrough
   against a local stub HTTP server, validation → 400, upstream 500 → 502.
5. Document the section in the app README with curl examples and the
   "works fully without Sakirea" statement.

## Related

- Skill tooling (validation, catalog, installer) lives in
  [consultsciences/sakirea-skills](https://github.com/consultsciences/sakirea-skills);
  install project skills into an app with
  `sakirea-skills install <name> --target project`.
- Engine provenance and the reverse-engineering dossier:
  [ENGINE-DOSSIER.md](../ENGINE-DOSSIER.md).
