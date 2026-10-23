// End-to-end deterministic pipeline: plan → draft → artifact → provenance,
// written into a temp directory with SAKIREA_HOME overridden. No network: the
// source connectors are stubbed; no LLM key is present in these tests.
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runWorkflow, DEFAULT_SOURCES } from "../src/workflows/runner.ts";
import type { ProvenanceData } from "../src/provenance/sidecar.ts";
import { jsonResponse, restoreNetwork, tempDir, cleanupDir } from "./helpers.ts";
import { setFetch, resetFetch } from "../src/sources/http.ts";
import { resetPacers } from "../src/sources/pacer.ts";

const tempDirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function stashEnv(keys: string[]): void {
	for (const key of keys) savedEnv[key] = process.env[key];
}

function clearLlmKeys(): void {
	for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SAKIREA_MODEL"]) {
		delete process.env[key];
	}
}

function fixtureRoutes(): Record<string, (url: URL) => Response> {
	return {
		"api.semanticscholar.org": () =>
			jsonResponse({
				total: 2,
				data: [
					{
						paperId: "s2-shared",
						title: "Shared Widget Paper",
						year: 2023,
						authors: [{ name: "Ada Lovelace" }],
						venue: "Journal of Widgets",
						citationCount: 42,
						externalIds: { DOI: "10.1000/shared" },
						abstract: "Widgets, revisited.",
						url: "https://www.semanticscholar.org/paper/s2-shared",
					},
					{
						paperId: "s2-only",
						title: "Only On Semantic Scholar",
						year: 2021,
						authors: [{ name: "Grace Hopper" }],
						venue: "NeurIPS",
						citationCount: 7,
						externalIds: {},
						abstract: "Only here.",
						url: "https://www.semanticscholar.org/paper/s2-only",
					},
				],
			}),
		"api.openalex.org": () =>
			jsonResponse({
				results: [
					{
						id: "https://openalex.org/W999",
						doi: "https://doi.org/10.1000/shared",
						title: "Shared Widget Paper",
						publication_year: 2023,
						authorships: [{ author: { display_name: "Ada Lovelace" } }],
						primary_location: { source: { display_name: "Journal of Widgets" } },
						cited_by_count: 40,
					},
				],
			}),
		"eutils.ncbi.nlm.nih.gov": (url) => {
			if (url.pathname.endsWith("/esearch.fcgi")) {
				return jsonResponse({ esearchresult: { count: "0", idlist: [] } });
			}
			return jsonResponse({ result: {} });
		},
	};
}

function stubRoutes(routes: Record<string, (url: URL) => Response>): void {
	setFetch(async (input) => {
		const url = new URL(String(input));
		const route = routes[url.hostname];
		return route ? route(url) : jsonResponse({ error: `no stub for ${url.hostname}` }, 500);
	});
}

afterEach(() => {
	restoreNetwork();
	resetFetch();
	resetPacers();
	clearLlmKeys();
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	for (const dir of tempDirs.splice(0)) cleanupDir(dir);
	if (process.env.SAKIREA_HOME && !savedEnv.SAKIREA_HOME) delete process.env.SAKIREA_HOME;
	else process.env.SAKIREA_HOME = savedEnv.SAKIREA_HOME;
});

describe("deterministic pipeline", () => {
	test("writes plan, draft, artifact, and both provenance sidecars", async () => {
		stashEnv(["SAKIREA_HOME", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SAKIREA_MODEL"]);
		clearLlmKeys();
		const home = tempDir("sakirea-home");
		const outputDir = tempDir("sakirea-out");
		tempDirs.push(home, outputDir);
		process.env.SAKIREA_HOME = home;
		stubRoutes(fixtureRoutes());

		const result = await runWorkflow({
			topic: "widget algorithms",
			workflowId: "deepresearch",
			mode: "auto", // no keys anywhere -> deterministic
			outputDir,
			sources: DEFAULT_SOURCES,
		});

		assert.equal(result.slug, "widget-algorithms");
		assert.equal(result.mode, "deterministic");
		assert.equal(result.status, "completed");
		assert.equal(result.resultsCount, 3);

		// staged artifacts, in order and all on disk
		assert.ok(existsSync(result.planPath), "plan");
		assert.ok(existsSync(result.draftPath), "draft");
		assert.ok(existsSync(result.artifactPath), "artifact");
		assert.ok(existsSync(result.provenancePath), "provenance.md");
		assert.ok(existsSync(result.provenanceJsonPath), "provenance.json");
		assert.equal(result.planPath, join(outputDir, ".plans", "widget-algorithms.md"));
		assert.equal(result.draftPath, join(outputDir, ".drafts", "widget-algorithms-draft.md"));
		assert.equal(result.artifactPath, join(outputDir, "widget-algorithms.md"));

		const artifact = readFileSync(result.artifactPath, "utf8");
		assert.match(artifact, /^# widget algorithms/m);
		assert.match(artifact, /\*\*Mode:\*\* deterministic \(no LLM key\)/);
		assert.match(artifact, /\*\*Workflow:\*\* deepresearch — Deep research/);
		assert.match(artifact, /\*\*Verification:\*\* UNVERIFIED/);
		assert.match(artifact, /## Evidence/);
		assert.match(artifact, /## Findings/);
		assert.match(artifact, /## Sources/);
		assert.match(artifact, /Shared Widget Paper/);
		assert.match(artifact, /https:\/\/www\.semanticscholar\.org\/paper\/s2-shared/);
		assert.match(artifact, /\[1\]/);

		const plan = readFileSync(result.planPath, "utf8");
		assert.match(plan, /^# Plan: widget algorithms/m);
		assert.match(plan, /## Key questions/);
		assert.match(plan, /## Task ledger/);
		assert.match(plan, /## Verification log/);
		assert.match(plan, /## Decision log/);
		assert.match(plan, /## Run outcome/);
		assert.match(plan, /Records retrieved: 3/);
		assert.match(plan, /Verification: UNVERIFIED/);

		const draft = readFileSync(result.draftPath, "utf8");
		assert.match(draft, /## Retrieved records/);
		assert.match(draft, /Queries issued:/);

		const provenance = JSON.parse(readFileSync(result.provenanceJsonPath, "utf8")) as ProvenanceData;
		assert.equal(provenance.slug, "widget-algorithms");
		assert.equal(provenance.mode, "deterministic (no LLM key)");
		assert.equal(provenance.sourcesAccepted, 3);
		assert.equal(provenance.sourcesBlocked, 0);
		assert.deepEqual(provenance.sourcesConsulted.sort(), [...DEFAULT_SOURCES].sort());
		const shared = provenance.entries.filter((entry) => entry.title === "Shared Widget Paper");
		assert.equal(shared.length, 2);
		assert.ok(shared.every((entry) => entry.status === "verified"), "cross-database record verified");
		assert.ok(provenance.entries.some((entry) => entry.title === "Only On Semantic Scholar" && entry.status === "unverified"));
		assert.ok(provenance.endpoints.some((endpoint) => endpoint.includes("api.openalex.org")));
		assert.ok(provenance.docs.some((docs) => docs.includes("europepmc") || docs.includes("semanticscholar")));

		const markdown = readFileSync(result.provenancePath, "utf8");
		assert.match(markdown, /\| Title \| Source DB \| URL \/ DOI \| Queried at \| Status \|/);
		assert.match(markdown, /## Endpoints/);
		assert.match(markdown, /### API endpoints used/);
	});

	test("a fully failed retrieval degrades to BLOCKED instead of crashing", async () => {
		stashEnv(["SAKIREA_HOME", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SAKIREA_MODEL"]);
		clearLlmKeys();
		const outputDir = tempDir("sakirea-out-degraded");
		tempDirs.push(outputDir);
		setFetch(async () => {
			throw Object.assign(new Error("network down in test"), { name: "TypeError" });
		});

		const result = await runWorkflow({
			topic: "nothing responds",
			workflowId: "lit",
			mode: "deterministic",
			outputDir,
		});

		assert.equal(result.status, "degraded");
		assert.equal(result.resultsCount, 0);
		assert.equal(result.failures.length, DEFAULT_SOURCES.length);
		assert.ok(existsSync(result.artifactPath));
		assert.ok(existsSync(result.provenanceJsonPath));

		const artifact = readFileSync(result.artifactPath, "utf8");
		assert.match(artifact, /\*\*Verification:\*\* BLOCKED/);
		assert.match(artifact, /## Coverage Status/);
		assert.match(artifact, /Blocked sources \(\d+\)/);
		assert.match(artifact, /network down in test/);

		const provenance = JSON.parse(readFileSync(result.provenanceJsonPath, "utf8")) as ProvenanceData;
		assert.equal(provenance.sourcesAccepted, 0);
		assert.equal(provenance.sourcesBlocked, DEFAULT_SOURCES.length);
		assert.ok(provenance.entries.every((entry) => entry.status === "blocked"));
		assert.match(provenance.verification, /BLOCKED/);
	});

	test("partial failures mark the run degraded but keep the evidence", async () => {
		stashEnv(["SAKIREA_HOME", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SAKIREA_MODEL"]);
		clearLlmKeys();
		const outputDir = tempDir("sakirea-out-partial");
		tempDirs.push(outputDir);
		const routes = fixtureRoutes();
		stubRoutes(routes);
		setFetch(async (input) => {
			const url = new URL(String(input));
			if (url.hostname === "eutils.ncbi.nlm.nih.gov") {
				return jsonResponse({ error: "NCBI down" }, 503);
			}
			const route = routes[url.hostname];
			return route ? route(url) : jsonResponse({ error: `no stub for ${url.hostname}` }, 500);
		});

		const result = await runWorkflow({
			topic: "widget algorithms",
			workflowId: "audit",
			mode: "deterministic",
			outputDir,
		});

		assert.equal(result.status, "degraded");
		assert.equal(result.resultsCount, 3);
		assert.equal(result.failures.length, 1);
		assert.equal(result.failures[0]?.source, "pubmed");

		const artifact = readFileSync(result.artifactPath, "utf8");
		assert.match(artifact, /\*\*Verification:\*\* BLOCKED — 1 source\(s\) failed/);
		assert.match(artifact, /`pubmed`/);

		const provenance = JSON.parse(readFileSync(result.provenanceJsonPath, "utf8")) as ProvenanceData;
		assert.equal(provenance.sourcesBlocked, 1);
		assert.equal(provenance.sourcesAccepted, 3);
		assert.ok(provenance.entries.some((entry) => entry.status === "blocked" && entry.source === "pubmed"));
	});

	test("rejects an empty topic", async () => {
		await assert.rejects(() => runWorkflow({ topic: "   " }), /non-empty topic/);
	});

	test("the draft workflow writes into papers/ by default", async () => {
		stashEnv(["SAKIREA_HOME", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SAKIREA_MODEL"]);
		clearLlmKeys();
		const cwd = process.cwd();
		const sandbox = tempDir("sakirea-papers");
		tempDirs.push(sandbox);
		try {
			stubRoutes(fixtureRoutes());
			// no outputDir -> workflow default; run from a sandbox cwd so nothing
			// is written into the repo checkout
			process.chdir(sandbox);
			const result = await runWorkflow({ topic: "draftable widgets", workflowId: "draft", mode: "deterministic" });
			assert.equal(result.artifactPath, join(sandbox, "papers", "draftable-widgets.md"));
			assert.ok(existsSync(result.artifactPath));
		} finally {
			process.chdir(cwd);
		}
	});
});
