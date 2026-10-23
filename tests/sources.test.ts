// Sources engine normalization: fixtures for arXiv Atom, OpenAlex JSON, and
// the PubMed esearch + esummary pair, plus envelope/provenance and limit rules.
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { getConnector, listConnectors, scienceDatabaseSearch } from "../src/sources/index.ts";
import { setFetch, resetFetch, HttpError } from "../src/sources/http.ts";
import { resetPacers } from "../src/sources/pacer.ts";
import { jsonResponse, restoreNetwork, textResponse } from "./helpers.ts";

const ARXIV_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title>ArXiv Query: search_query=all:"widget algorithms"</title>
  <entry>
    <id>http://arxiv.org/abs/2401.12345v2</id>
    <updated>2024-02-02T00:00:00Z</updated>
    <published>2024-01-15T00:00:00Z</published>
    <title>A Test Paper on Widget
      Algorithms</title>
    <summary>We study widget algorithms &amp; their limits.</summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <category term="cs.DS" scheme="http://arxiv.org/schemas/atom"/>
    <primary_category term="cs.DS" scheme="http://arxiv.org/schemas/atom"/>
    <link href="http://arxiv.org/abs/2401.12345v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2401.12345v2" rel="related" type="application/pdf"/>
    <arxiv:doi>10.1234/test.5678</arxiv:doi>
    <arxiv:comment>10 pages</arxiv:comment>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2402.99999v1</id>
    <published>2023-11-02T00:00:00Z</published>
    <updated>2023-11-02T00:00:00Z</updated>
    <title>Second Widget Paper</title>
    <summary>Another abstract.</summary>
    <author><name>Grace Hopper</name></author>
    <link href="http://arxiv.org/abs/2402.99999v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`;

const OPENALEX_JSON = {
	meta: { count: 1 },
	results: [
		{
			id: "https://openalex.org/W4309876123",
			doi: "https://doi.org/10.1000/xyz123",
			title: "Widget Algorithms Revisited",
			display_name: "Widget Algorithms Revisited",
			publication_year: 2023,
			publication_date: "2023-05-01",
			cited_by_count: 42,
			authorships: [
				{ author: { display_name: "Grace Hopper" } },
				{ author: { display_name: "Alan Turing" } },
			],
			primary_location: { source: { display_name: "Journal of Widgets" } },
			abstract_inverted_index: { widget: [0], algorithms: [1], revisited: [2] },
		},
	],
};

const ESEARCH_JSON = {
	esearchresult: {
		count: "1",
		retmax: "1",
		idlist: ["35486828"],
		querytranslation: "widget[Title/Abstract]",
	},
};

const ESUMMARY_JSON = {
	result: {
		uids: ["35486828"],
		"35486828": {
			uid: "35486828",
			title: "A PubMed Test Article",
			fulljournalname: "Journal of Testing",
			pubdate: "2022 Mar 01",
			authors: [{ name: "Smith J" }, { name: "Doe A" }],
			articleids: [
				{ idtype: "pubmed", value: "35486828" },
				{ idtype: "doi", value: "10.9999/test.2022" },
			],
		},
	},
};

afterEach(() => {
	restoreNetwork();
	resetFetch();
	resetPacers();
});

describe("sources normalization", () => {
	test("registry exposes exactly the eight key-free connectors", () => {
		const ids = listConnectors().map((connector) => connector.id).sort();
		assert.deepEqual(ids, [
			"arxiv", "biorxiv", "crossref", "europepmc", "medrxiv", "openalex", "pubmed", "semanticscholar",
		]);
		for (const connector of listConnectors()) {
			assert.ok(connector.docs.startsWith("https://"), `${connector.id} needs a docs URL`);
			assert.ok(connector.endpoints.length > 0, `${connector.id} needs endpoints`);
		}
	});

	test("arxiv normalizes an Atom feed", async () => {
		const requests: string[] = [];
		setFetch(async (input) => {
			const url = new URL(String(input));
			requests.push(url.toString());
			assert.equal(url.hostname, "export.arxiv.org");
			return textResponse(ARXIV_XML);
		});
		const envelope = await scienceDatabaseSearch({ source: "arxiv", query: "widget algorithms" });
		assert.equal(envelope.schema, "sakirea.scienceDatabaseSearch.v1");
		assert.equal(envelope.source, "arxiv");
		assert.equal(envelope.returned, 2);

		const first = envelope.results[0];
		assert.ok(first);
		assert.equal(first.id, "2401.12345");
		assert.equal(first.title, "A Test Paper on Widget Algorithms");
		assert.equal(first.year, 2024);
		assert.deepEqual(first.authors, ["Ada Lovelace", "Alan Turing"]);
		assert.equal(first.doi, "10.1234/test.5678");
		assert.equal(first.venue, "arXiv");
		assert.equal(first.abstract, "We study widget algorithms & their limits.");
		assert.equal(first.source, "arxiv");

		const second = envelope.results[1];
		assert.ok(second);
		assert.equal(second.year, 2023);
		assert.equal(second.doi, undefined);

		assert.match(requests[0] ?? "", /search_query=/);
		assert.equal(envelope.provenance.docs, "https://info.arxiv.org/help/api/user-manual.html");
		assert.ok(envelope.provenance.endpoints[0]?.includes("export.arxiv.org/api/query"));
		assert.ok(!Number.isNaN(Date.parse(envelope.provenance.queriedAt)));
	});

	test("arxiv id queries use id_list and honor every requested id", async () => {
		let captured = "";
		setFetch(async (input) => {
			captured = String(input);
			return textResponse(ARXIV_XML);
		});
		const envelope = await scienceDatabaseSearch({ source: "arxiv", query: "2401.12345, 2402.99999" });
		assert.match(captured, /id_list=2401\.12345%2C2402\.99999/);
		assert.equal(envelope.returned, 2);
	});

	test("openalex normalizes works and records scrubbed endpoints", async () => {
		let captured = "";
		setFetch(async (input) => {
			captured = String(input);
			return jsonResponse(OPENALEX_JSON);
		});
		const envelope = await scienceDatabaseSearch({ source: "openalex", query: "widget algorithms", limit: 3 });
		const work = envelope.results[0];
		assert.ok(work);
		assert.equal(work.id, "W4309876123");
		assert.equal(work.title, "Widget Algorithms Revisited");
		assert.equal(work.year, 2023);
		assert.deepEqual(work.authors, ["Grace Hopper", "Alan Turing"]);
		assert.equal(work.venue, "Journal of Widgets");
		assert.equal(work.citations, 42);
		assert.equal(work.doi, "10.1000/xyz123");
		assert.equal(work.abstract, "widget algorithms revisited");
		assert.equal(work.url, "https://openalex.org/W4309876123");
		assert.match(captured, /per-page=3/);
		assert.equal(envelope.provenance.docs, "https://developers.openalex.org/api-reference/works");
		assert.ok(envelope.provenance.endpoints[0]?.includes("api.openalex.org/works"));
	});

	test("pubmed runs esearch then esummary and joins the metadata", async () => {
		const paths: string[] = [];
		setFetch(async (input) => {
			const url = new URL(String(input));
			paths.push(url.pathname);
			if (url.pathname.endsWith("/esearch.fcgi")) return jsonResponse(ESEARCH_JSON);
			if (url.pathname.endsWith("/esummary.fcgi")) return jsonResponse(ESUMMARY_JSON);
			return jsonResponse({ error: "unexpected endpoint" }, 500);
		});
		const envelope = await scienceDatabaseSearch({ source: "pubmed", query: "widget[Title/Abstract]" });
		assert.deepEqual(paths, ["/entrez/eutils/esearch.fcgi", "/entrez/eutils/esummary.fcgi"]);
		const record = envelope.results[0];
		assert.ok(record);
		assert.equal(record.id, "35486828");
		assert.equal(record.title, "A PubMed Test Article");
		assert.equal(record.year, 2022);
		assert.equal(record.venue, "Journal of Testing");
		assert.equal(record.doi, "10.9999/test.2022");
		assert.equal(record.url, "https://pubmed.ncbi.nlm.nih.gov/35486828/");
		assert.deepEqual(record.authors, ["Smith J", "Doe A"]);
		assert.ok(record.endpoint?.includes("esearch.fcgi"));
		assert.ok(record.endpoint?.includes("esummary.fcgi"));
	});

	test("europepmc normalizes lite results", async () => {
		setFetch(async () =>
			jsonResponse({
				hitCount: 1,
				resultList: {
					result: [
						{
							id: "PMC123",
							source: "PMC",
							title: "An Europe PMC Record",
							authorString: "Alpha A, Beta B",
							journalTitle: "PeerJ",
							pubYear: "2021",
							citedByCount: 7,
							doi: "10.7717/peerj.123",
						},
					],
				},
			}),
		);
		const envelope = await scienceDatabaseSearch({ source: "europepmc", query: "test" });
		const record = envelope.results[0];
		assert.ok(record);
		assert.equal(record.id, "PMC123");
		assert.equal(record.year, 2021);
		assert.equal(record.venue, "PeerJ");
		assert.equal(record.citations, 7);
		assert.equal(record.url, "https://europepmc.org/article/PMC/PMC123");
		assert.deepEqual(record.authors, ["Alpha A", "Beta B"]);
	});

	test("biorxiv topic queries route through Europe PMC's preprint index and keep the source id", async () => {
		let captured = "";
		setFetch(async (input) => {
			captured = String(input);
			return jsonResponse({
				hitCount: 1,
				resultList: {
					result: [
						{
							id: "PPR1",
							source: "PPR",
							title: "CRISPR in plants",
							authorString: "C D",
							pubYear: "2024",
							firstPublicationDate: "2024-06-01",
							doi: "10.1101/2024.06.01.123456",
							abstractText: "We edit plants.",
							citedByCount: 3,
						},
					],
				},
			});
		});
		const envelope = await scienceDatabaseSearch({ source: "biorxiv", query: "CRISPR plants" });
		assert.match(captured, /SRC%3APPR/);
		assert.match(captured, /PUBLISHER%3A%22bioRxiv%22/);
		const record = envelope.results[0];
		assert.ok(record);
		assert.equal(record.source, "biorxiv");
		assert.equal(record.venue, "bioRxiv");
		assert.equal(record.abstract, "We edit plants.");
		assert.equal(record.citations, 3);
		assert.equal(record.year, 2024);
	});

	test("crossref normalizes works from /works metadata", async () => {
		let captured = "";
		setFetch(async (input) => {
			captured = String(input);
			return jsonResponse({
				status: "ok",
				message: {
					"total-results": 1,
					items: [
						{
							DOI: "10.5555/widgets.1",
							title: ["Crossref Widget Study"],
							"container-title": ["Journal of Crossref"],
							issued: { "date-parts": [[2020, 4, 1]] },
							author: [{ given: "Ada", family: "Lovelace" }],
							"is-referenced-by-count": 12,
							URL: "https://doi.org/10.5555/widgets.1",
							type: "journal-article",
						},
					],
				},
			});
		});
		const envelope = await scienceDatabaseSearch({ source: "crossref", query: "widgets" });
		const record = envelope.results[0];
		assert.ok(record);
		assert.equal(record.id, "10.5555/widgets.1");
		assert.equal(record.title, "Crossref Widget Study");
		assert.equal(record.year, 2020);
		assert.equal(record.venue, "Journal of Crossref");
		assert.equal(record.citations, 12);
		assert.deepEqual(record.authors, ["Ada Lovelace"]);
		assert.match(captured, /select=/);
	});

	test("semanticscholar normalizes paper search results", async () => {
		setFetch(async () =>
			jsonResponse({
				total: 1,
				data: [
					{
						paperId: "abc123",
						title: "Semantic Widgets",
						year: 2019,
						authors: [{ name: "Ada Lovelace" }],
						venue: "NeurIPS",
						citationCount: 99,
						externalIds: { DOI: "10.5555/sem.2019", ArXiv: "1901.00001" },
						abstract: "An abstract about widgets.",
						url: "https://www.semanticscholar.org/paper/abc123",
					},
				],
			}),
		);
		const envelope = await scienceDatabaseSearch({ source: "semanticscholar", query: "semantic widgets" });
		const record = envelope.results[0];
		assert.ok(record);
		assert.equal(record.id, "abc123");
		assert.equal(record.year, 2019);
		assert.equal(record.citations, 99);
		assert.equal(record.venue, "NeurIPS");
		assert.equal(record.doi, "10.5555/sem.2019");
		assert.equal(record.source, "semanticscholar");
	});
});

describe("search envelope rules", () => {
	test("limit is clamped to 1..20 with a default of 5", async () => {
		const perPages: string[] = [];
		setFetch(async (input) => {
			const url = new URL(String(input));
			perPages.push(url.searchParams.get("per-page") ?? "");
			return jsonResponse({ results: [] });
		});
		await scienceDatabaseSearch({ source: "openalex", query: "q" });
		await scienceDatabaseSearch({ source: "openalex", query: "q", limit: 0 });
		await scienceDatabaseSearch({ source: "openalex", query: "q", limit: 99 });
		assert.deepEqual(perPages, ["5", "1", "20"]);
	});

	test("empty and unknown sources fail with actionable messages", async () => {
		await assert.rejects(() => scienceDatabaseSearch({ source: "openalex", query: "   " }), /non-empty query/);
		await assert.rejects(
			async () => {
				await scienceDatabaseSearch({ source: "google-scholar", query: "q" });
			},
			/Unknown source "google-scholar"/,
		);
		assert.ok(getConnector("arxiv"));
	});

	test("429 with retry-after is retried once, then surfaces a rate-limit message", async () => {
		let attempts = 0;
		setFetch(async () => {
			attempts += 1;
			if (attempts === 1) {
				return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
			}
			return jsonResponse({
				total: 1,
				data: [{ paperId: "p1", title: "Recovered", year: 2024, authors: [] }],
			});
		});
		const envelope = await scienceDatabaseSearch({ source: "semanticscholar", query: "recovery" });
		assert.equal(attempts, 2);
		assert.equal(envelope.returned, 1);

		attempts = 0;
		setFetch(async () => {
			attempts += 1;
			return new Response("still slow", { status: 429, headers: { "retry-after": "0" } });
		});
		await assert.rejects(
			() => scienceDatabaseSearch({ source: "semanticscholar", query: "never" }),
			/rate-limited/,
		);
		assert.equal(attempts, 2);
	});

	test("timeouts become an actionable per-source message", async () => {
		setFetch(async () => {
			throw Object.assign(new Error("aborted"), { name: "AbortError" });
		});
		await assert.rejects(
			() => scienceDatabaseSearch({ source: "openalex", query: "slow" }),
			/did not respond within 25 s/,
		);
		// HttpError is a plain status failure, not a timeout
		assert.equal(new HttpError("x", 500).status, 500);
	});
});
