// CLI tests run in-process (this sandbox forbids child_process spawning):
// main(argv, io) returns an exit code and writes through the injected io.
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { main, parseArgs, HELP } from "../src/cli.ts";
import { VERSION } from "../src/version.ts";
import { jsonResponse, restoreNetwork, textResponse } from "./helpers.ts";
import { setFetch, resetFetch } from "../src/sources/http.ts";
import { resetPacers } from "../src/sources/pacer.ts";

function capture(): { io: { out(text: string): void; err(text: string): void }; out: string[]; err: string[] } {
	const out: string[] = [];
	const err: string[] = [];
	return {
		io: {
			out: (text) => out.push(text),
			err: (text) => err.push(text),
		},
		out,
		err,
	};
}

afterEach(() => {
	restoreNetwork();
	resetFetch();
	resetPacers();
});

describe("argument parsing", () => {
	test("separates positionals and value flags", () => {
		const parsed = parseArgs(["search", "arxiv", "some query", "--limit", "7", "--sort=pub_date"]);
		assert.deepEqual(parsed.positionals, ["search", "arxiv", "some query"]);
		assert.equal(parsed.flags.limit, "7");
		assert.equal(parsed.flags.sort, "pub_date");
	});

	test("rejects unknown flags and missing values", () => {
		assert.throws(() => parseArgs(["--nope"]), /Unknown flag "--nope"/);
		assert.throws(() => parseArgs(["--limit"]), /requires a value/);
	});

	test("understands shorthands", () => {
		assert.equal(parseArgs(["-h"]).flags.help, true);
		assert.equal(parseArgs(["-V"]).flags.version, true);
	});
});

describe("main()", () => {
	test("--help prints usage, workflows, and sources with exit 0", async () => {
		const captureIo = capture();
		const code = await main(["--help"], captureIo.io);
		assert.equal(code, 0);
		const text = captureIo.out.join("");
		assert.equal(text, HELP);
		assert.match(text, /Usage:/);
		assert.match(text, /sakirea "<topic>"/);
		assert.match(text, /deepresearch/);
		assert.match(text, /autoresearch/);
		assert.match(text, /sakirea_science_database_search|No API key is needed/);
		assert.match(text, /info\.arxiv\.org/);
		assert.match(text, /ships no telemetry/);
	});

	test("no arguments prints usage", async () => {
		const captureIo = capture();
		assert.equal(await main([], captureIo.io), 0);
		assert.match(captureIo.out.join(""), /Usage:/);
	});

	test("--version prints the package version", async () => {
		const captureIo = capture();
		assert.equal(await main(["--version"], captureIo.io), 0);
		assert.equal(captureIo.out.join("").trim(), VERSION);
	});

	test("unknown flag exits with usage code 2", async () => {
		const captureIo = capture();
		assert.equal(await main(["--bogus"], captureIo.io), 2);
		assert.match(captureIo.err.join(""), /Unknown flag "--bogus"/);
	});

	test("bad --mode value exits 2 with guidance", async () => {
		const captureIo = capture();
		assert.equal(await main(["--mode", "sometimes", "topic"], captureIo.io), 2);
		assert.match(captureIo.err.join(""), /--mode must be/);
	});

	test("sources lists all connectors with docs and endpoints", async () => {
		const captureIo = capture();
		assert.equal(await main(["sources"], captureIo.io), 0);
		const text = captureIo.out.join("");
		for (const id of ["arxiv", "openalex", "pubmed", "europepmc", "biorxiv", "medrxiv", "crossref", "semanticscholar"]) {
			assert.ok(text.includes(id), `missing ${id}`);
		}
		assert.match(text, /https:\/\/export\.arxiv\.org\/api\/query/);
		assert.match(text, /https:\/\/api\.openalex\.org\/works/);
		assert.match(text, /docs:/);
	});

	test("workflows lists the ten workflows with agents and output dirs", async () => {
		const captureIo = capture();
		assert.equal(await main(["workflows"], captureIo.io), 0);
		const text = captureIo.out.join("");
		assert.match(text, /deepresearch\s+\(outputs\/\)/);
		assert.match(text, /draft\s+\(papers\/\)/);
		assert.match(text, /researcher → verifier/);
	});

	test("search requires a source and a query", async () => {
		const captureIo = capture();
		assert.equal(await main(["search"], captureIo.io), 2);
		assert.match(captureIo.err.join(""), /Usage: sakirea search/);
	});

	test("search returns the envelope as JSON without touching the network", async () => {
		setFetch(async (input) => {
			const url = new URL(String(input));
			if (url.hostname === "export.arxiv.org") {
				return textResponse(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
<id>http://arxiv.org/abs/2401.12345v1</id>
<published>2024-01-15T00:00:00Z</published>
<title>CLI Search Fixture</title><summary>Abstract.</summary>
<author><name>Ada Lovelace</name></author>
<link href="http://arxiv.org/abs/2401.12345v1" rel="alternate" type="text/html"/>
</entry></feed>`);
			}
			return jsonResponse({ error: `unexpected host ${url.hostname}` }, 500);
		});
		const captureIo = capture();
		const code = await main(["search", "arxiv", "2401.12345"], captureIo.io);
		assert.equal(code, 0);
		const payload = JSON.parse(captureIo.out.join("")) as { source: string; results: Array<{ id: string }> };
		assert.equal(payload.source, "arxiv");
		assert.equal(payload.results[0]?.id, "2401.12345");
	});

	test("a failing search exits 1 and reports the error on stderr", async () => {
		setFetch(async () => jsonResponse({ error: "nope" }, 500));
		const captureIo = capture();
		const code = await main(["search", "openalex", "anything"], captureIo.io);
		assert.equal(code, 1);
		assert.match(captureIo.err.join(""), /request failed: 500/);
	});
});
