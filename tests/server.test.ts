// HTTP API tests: in-process server on port 0, global fetch against it,
// stubbed source connectors (zero network to third parties).
import { after, before, beforeEach, afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, type RunningServer } from "../src/server.ts";
import { VERSION } from "../src/version.ts";
import { jsonResponse, restoreNetwork, tempDir, cleanupDir } from "./helpers.ts";
import { setFetch, resetFetch } from "../src/sources/http.ts";
import { resetPacers } from "../src/sources/pacer.ts";

let server: RunningServer;
const tempDirs: string[] = [];

before(async () => {
	server = await startServer({ host: "127.0.0.1", port: 0 });
});

after(async () => {
	await server.close();
	for (const dir of tempDirs.splice(0)) cleanupDir(dir);
});

beforeEach(() => {
	// Default stub: the three default workflow sources all answer; anything
	// else 500s loudly so a request leak is visible.
	setFetch(async (input) => {
		const url = new URL(String(input));
		if (url.hostname === "api.openalex.org") {
			return jsonResponse({
				results: [
					{
						id: "https://openalex.org/W1",
						title: "Server Fixture Work",
						publication_year: 2022,
						authorships: [{ author: { display_name: "Ada Lovelace" } }],
						primary_location: { source: { display_name: "Fixture Journal" } },
						cited_by_count: 5,
						doi: "https://doi.org/10.5555/server.fixture",
					},
				],
			});
		}
		if (url.hostname === "api.semanticscholar.org") {
			return jsonResponse({
				total: 1,
				data: [
					{
						paperId: "s2-server",
						title: "Server Fixture Work",
						year: 2022,
						authors: [{ name: "Ada Lovelace" }],
						venue: "Fixture Journal",
						citationCount: 5,
						externalIds: { DOI: "10.5555/server.fixture" },
						url: "https://www.semanticscholar.org/paper/s2-server",
					},
				],
			});
		}
		if (url.hostname === "eutils.ncbi.nlm.nih.gov") {
			return jsonResponse({ esearchresult: { count: "0", idlist: [] } });
		}
		return jsonResponse({ error: `no stub for ${url.hostname}` }, 500);
	});
});

afterEach(() => {
	restoreNetwork();
	resetFetch();
	resetPacers();
});

function url(path: string): string {
	return `${server.url}${path}`;
}

interface ErrorShape {
	error: { code: string; message: string };
}

describe("HTTP API", () => {
	test("GET /api/health", async () => {
		const response = await fetch(url("/api/health"));
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("access-control-allow-origin"), "*");
		const payload = (await response.json()) as { ok: boolean; name: string; version: string };
		assert.deepEqual(payload, { ok: true, name: "sakirea", version: VERSION });
	});

	test("OPTIONS preflight answers 204 with CORS headers", async () => {
		const response = await fetch(url("/api/search"), { method: "OPTIONS" });
		assert.equal(response.status, 204);
		assert.equal(response.headers.get("access-control-allow-origin"), "*");
		assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
		assert.match(response.headers.get("access-control-allow-headers") ?? "", /content-type/);
	});

	test("GET /api/sources lists connectors with docs and endpoints", async () => {
		const response = await fetch(url("/api/sources"));
		assert.equal(response.status, 200);
		const payload = (await response.json()) as { sources: Array<{ id: string; docs: string; endpoints: string[] }> };
		assert.equal(payload.sources.length, 8);
		const ids = payload.sources.map((source) => source.id).sort();
		assert.deepEqual(ids, ["arxiv", "biorxiv", "crossref", "europepmc", "medrxiv", "openalex", "pubmed", "semanticscholar"]);
		for (const source of payload.sources) {
			assert.ok(source.docs.startsWith("https://"));
			assert.ok(source.endpoints.length > 0);
		}
	});

	test("GET /api/workflows lists ten workflows with agents and args", async () => {
		const response = await fetch(url("/api/workflows"));
		assert.equal(response.status, 200);
		const payload = (await response.json()) as {
			workflows: Array<{ id: string; agents: string[]; outputDir: string; args: string }>;
		};
		assert.equal(payload.workflows.length, 10);
		const draft = payload.workflows.find((workflow) => workflow.id === "draft");
		assert.equal(draft?.outputDir, "papers");
		const deep = payload.workflows.find((workflow) => workflow.id === "deepresearch");
		assert.deepEqual(deep?.agents, ["researcher", "verifier", "reviewer", "writer"]);
		assert.equal(deep?.args, "<topic>");
	});

	test("POST /api/search returns normalized results", async () => {
		const response = await fetch(url("/api/search"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ source: "openalex", query: "server fixture", limit: 3 }),
		});
		assert.equal(response.status, 200);
		const payload = (await response.json()) as {
			source: string;
			returned: number;
			limit: number;
			results: Array<{ id: string; title: string; citations: number }>;
			provenance: { docs: string; endpoints: string[]; queriedAt: string };
		};
		assert.equal(payload.source, "openalex");
		assert.equal(payload.limit, 3);
		assert.equal(payload.returned, 1);
		assert.equal(payload.results[0]?.id, "W1");
		assert.equal(payload.results[0]?.citations, 5);
		assert.ok(payload.provenance.endpoints[0]?.includes("api.openalex.org"));
		assert.ok(!Number.isNaN(Date.parse(payload.provenance.queriedAt)));
	});

	test("POST /api/search validates its body", async () => {
		const missing = await fetch(url("/api/search"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ source: "openalex" }),
		});
		assert.equal(missing.status, 400);
		assert.deepEqual((await missing.json()) as ErrorShape, {
			error: { code: "bad_request", message: '"query" must be a non-empty string.' },
		});

		const badJson = await fetch(url("/api/search"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});
		assert.equal(badJson.status, 400);
		const badPayload = (await badJson.json()) as ErrorShape;
		assert.equal(badPayload.error.code, "bad_request");

		const unknownSource = await fetch(url("/api/search"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ source: "google-scholar", query: "x" }),
		});
		assert.equal(unknownSource.status, 400);
		assert.match(((await unknownSource.json()) as ErrorShape).error.message, /Unknown source/);
	});

	test("upstream failures map to 502 upstream_error", async () => {
		setFetch(async () => jsonResponse({ error: "down" }, 503));
		const response = await fetch(url("/api/search"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ source: "openalex", query: "anything" }),
		});
		assert.equal(response.status, 502);
		assert.equal(((await response.json()) as ErrorShape).error.code, "upstream_error");
	});

	test("unknown routes return the uniform 404 shape", async () => {
		const response = await fetch(url("/api/nope"));
		assert.equal(response.status, 404);
		const payload = (await response.json()) as ErrorShape;
		assert.equal(payload.error.code, "not_found");
		assert.match(payload.error.message, /GET \/api\/nope/);

		const run = await fetch(url("/api/workflows/notaworkflow/run"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ topic: "anything" }),
		});
		assert.equal(run.status, 404);
		assert.equal(((await run.json()) as ErrorShape).error.code, "not_found");
	});

	test("oversized bodies are rejected with 413", async () => {
		const response = await fetch(url("/api/search"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ source: "openalex", query: "x".repeat(1_100_000) }),
		});
		assert.equal(response.status, 413);
		assert.equal(((await response.json()) as ErrorShape).error.code, "payload_too_large");
	});

	test("POST /api/workflows/:id/run writes artifact and provenance", async () => {
		const outputDir = tempDir("sakirea-server-run");
		tempDirs.push(outputDir);
		const response = await fetch(url("/api/workflows/summarize/run"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ topic: "Server Fixture Work", outputDir, mode: "deterministic" }),
		});
		assert.equal(response.status, 200);
		const payload = (await response.json()) as {
			slug: string;
			artifactPath: string;
			provenancePath: string;
			status: string;
			mode: string;
		};
		assert.equal(payload.slug, "server-fixture-work");
		assert.equal(payload.status, "completed");
		assert.equal(payload.mode, "deterministic");
		assert.ok(existsSync(payload.artifactPath));
		assert.ok(existsSync(payload.provenancePath));
		assert.ok(payload.artifactPath.startsWith(outputDir));
		const artifact = readFileSync(payload.artifactPath, "utf8");
		assert.match(artifact, /deterministic \(no LLM key\)/);
		assert.match(artifact, /## Sources/);
	});

	test("run without a topic is a 400", async () => {
		const response = await fetch(url("/api/workflows/lit/run"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ mode: "deterministic" }),
		});
		assert.equal(response.status, 400);
		assert.equal(((await response.json()) as ErrorShape).error.code, "bad_request");
	});
});
