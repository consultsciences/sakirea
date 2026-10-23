// Provenance sidecar structure: markdown table, endpoints section, and the
// machine-readable JSON twin.
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildEntries,
	buildProvenance,
	renderProvenanceMarkdown,
	writeProvenance,
	type ProvenanceData,
} from "../src/provenance/sidecar.ts";
import type { SourceResult } from "../src/sources/types.ts";
import { cleanupDir, tempDir } from "./helpers.ts";

const NOW = "2026-01-02T03:04:05.000Z";

const results: SourceResult[] = [
	{
		id: "W1",
		title: "Shared Widget Paper",
		year: 2023,
		authors: ["A One"],
		venue: "Journal of Widgets",
		url: "https://doi.org/10.1000/shared",
		source: "openalex",
		doi: "10.1000/shared",
		endpoint: "https://api.openalex.org/works?search=widgets",
	},
	{
		id: "10.1000/shared",
		title: "Shared Widget Paper",
		year: 2023,
		authors: ["A One"],
		venue: "Journal of Widgets",
		url: "https://www.semanticscholar.org/paper/x",
		source: "semanticscholar",
		doi: "10.1000/shared",
		endpoint: "https://api.semanticscholar.org/graph/v1/paper/search?query=widgets",
	},
	{
		id: "42",
		title: "Only In One Database",
		year: 2021,
		authors: ["B Two"],
		venue: "PeerJ",
		url: "https://pubmed.ncbi.nlm.nih.gov/42/",
		source: "pubmed",
		endpoint: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?term=widgets",
	},
];

const failures = [{ source: "europepmc", error: "HTTP 503 upstream unavailable" }];

function sample(): ProvenanceData {
	return buildProvenance({
		slug: "widget-survey",
		topic: "widget survey",
		workflow: "deepresearch",
		workflowName: "Deep research",
		artifact: "outputs/widget-survey.md",
		mode: "deterministic (no LLM key)",
		model: undefined,
		verification: "Verification: BLOCKED — 1 source(s) failed",
		results,
		failures,
		queried: ["openalex", "semanticscholar", "pubmed", "europepmc"],
		docs: ["https://developers.openalex.org/api-reference/works", "https://api.semanticscholar.org/api-docs/graph"],
		endpoints: [
			"https://api.openalex.org/works?search=widgets",
			"https://api.semanticscholar.org/graph/v1/paper/search?query=widgets",
			"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?term=widgets",
		],
		queriedAt: NOW,
	});
}

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) cleanupDir(dir);
});

describe("provenance entries", () => {
	test("cross-database records are verified, single-database records unverified, failures blocked", () => {
		const entries = buildEntries(results, failures, NOW);
		assert.equal(entries.length, 4);
		const byTitle = new Map(entries.map((entry) => [entry.title, entry.status]));
		assert.equal(byTitle.get("Shared Widget Paper"), "verified");
		assert.equal(byTitle.get("Only In One Database"), "unverified");
		assert.equal(byTitle.get("— retrieval failed —"), "blocked");
		const blocked = entries.find((entry) => entry.status === "blocked");
		assert.equal(blocked?.source, "europepmc");
		for (const entry of entries) {
			assert.ok(entry.queriedAt === NOW, "queried-at recorded per entry");
			assert.ok(["verified", "unverified", "blocked"].includes(entry.status));
		}
	});

	test("title-only records still group across databases", () => {
		const noDoi: SourceResult[] = [
			{ id: "a", title: "Same Title!", year: 2020, authors: [], venue: "V", url: "https://a.test", source: "arxiv" },
			{ id: "b", title: "same   TITLE", year: 2020, authors: [], venue: "V", url: "https://b.test", source: "crossref" },
		];
		const entries = buildEntries(noDoi, [], NOW);
		assert.deepEqual(entries.map((entry) => entry.status), ["verified", "verified"]);
	});
});

describe("provenance sidecar files", () => {
	test("markdown carries the sources table, statuses, and endpoint documentation", () => {
		const data = sample();
		const markdown = renderProvenanceMarkdown(data);
		assert.match(markdown, /^# Provenance: widget survey/m);
		assert.match(markdown, /\*\*Mode:\*\* deterministic \(no LLM key\)/);
		assert.match(markdown, /\*\*Verification:\*\* Verification: BLOCKED/);
		assert.match(markdown, /\*\*Sources consulted:\*\* openalex, semanticscholar, pubmed, europepmc/);
		assert.match(markdown, /\*\*Sources accepted:\*\* 3/);
		assert.match(markdown, /\*\*Sources blocked:\*\* 1/);
		assert.match(markdown, /\| Title \| Source DB \| URL \/ DOI \| Queried at \| Status \|/);
		assert.match(markdown, /\| Shared Widget Paper \| openalex \| https:\/\/doi\.org\/10\.1000\/shared \| .* \| verified \|/);
		assert.match(markdown, /\| Only In One Database \| pubmed \| .* \| unverified \|/);
		assert.match(markdown, /\| — retrieval failed — \| europepmc \| — \| .* \| blocked \|/);
		assert.match(markdown, /## Endpoints/);
		assert.match(markdown, /### Documentation/);
		assert.match(markdown, /https:\/\/developers\.openalex\.org\/api-reference\/works/);
		assert.match(markdown, /### API endpoints used/);
		assert.match(markdown, /https:\/\/api\.openalex\.org\/works\?search=widgets/);
		assert.match(markdown, /## Status legend/);
	});

	test("writes both sidecar files next to the artifact", () => {
		const dir = tempDir("sakirea-provenance");
		tempDirs.push(dir);
		const data = sample();
		const { mdPath, jsonPath } = writeProvenance(dir, "widget-survey", data);
		assert.equal(mdPath, join(dir, "widget-survey.provenance.md"));
		assert.equal(jsonPath, join(dir, "widget-survey.provenance.json"));
		assert.ok(existsSync(mdPath));
		assert.ok(existsSync(jsonPath));

		const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as ProvenanceData;
		assert.equal(parsed.schema, "sakirea.provenance.v1");
		assert.equal(parsed.slug, "widget-survey");
		assert.equal(parsed.tool, "sakirea_science_database_search");
		assert.match(parsed.sakireaVersion, /^\d+\.\d+\.\d+/);
		assert.equal(parsed.entries.length, 4);
		assert.equal(parsed.sourcesAccepted, 3);
		assert.equal(parsed.sourcesBlocked, 1);
		assert.equal(parsed.workflow, "deepresearch");
		assert.ok(parsed.endpoints.length === 3);
		assert.ok(parsed.docs.length === 2);
	});

	test("an empty run still writes a valid sidecar", () => {
		const dir = tempDir("sakirea-provenance-empty");
		tempDirs.push(dir);
		const data = buildProvenance({
			slug: "nothing",
			topic: "nothing",
			workflow: "lit",
			workflowName: "Literature review",
			artifact: "outputs/nothing.md",
			mode: "deterministic (no LLM key)",
			model: undefined,
			verification: "Verification: BLOCKED — no records were retrieved",
			results: [],
			failures: [{ source: "openalex", error: "timed out" }],
			queried: ["openalex"],
			docs: ["https://developers.openalex.org/api-reference/works"],
			endpoints: ["https://api.openalex.org/works"],
			queriedAt: NOW,
		});
		const { jsonPath } = writeProvenance(dir, "nothing", data);
		const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as ProvenanceData;
		assert.equal(parsed.entries.length, 1);
		assert.equal(parsed.entries[0]?.status, "blocked");
		const markdown = readFileSync(join(dir, "nothing.provenance.md"), "utf8");
		assert.match(markdown, /\| — retrieval failed — \| openalex \| — \| .* \| blocked \|/);
		assert.match(markdown, /\*\*Sources accepted:\*\* 0/);
	});
});
