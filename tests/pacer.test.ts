// Request pacing: per-call gaps, per-host budgets, and queue resilience.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequestPacer, DEFAULT_MIN_GAP_MS, HOST_MIN_GAP_MS, minGapFor, pace, resetPacers } from "../src/sources/pacer.ts";
import { setFetch, resetFetch, requestText } from "../src/sources/http.ts";
import { restoreNetwork, textResponse } from "./helpers.ts";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("request pacer", () => {
	test("runs requests serially, each starting at least minGapMs after the previous", async () => {
		const pacer = createRequestPacer();
		const starts: number[] = [];
		const finishes: number[] = [];
		await Promise.all([
			pacer(60, async () => {
				starts.push(Date.now());
				await sleep(20);
				finishes.push(Date.now());
			}),
			pacer(60, async () => {
				starts.push(Date.now());
				await sleep(5);
				finishes.push(Date.now());
			}),
			pacer(60, async () => {
				starts.push(Date.now());
				finishes.push(Date.now());
			}),
		]);
		assert.equal(starts.length, 3);
		// started strictly in order, each >= 60 ms after the previous start
		assert.ok(starts[1]! >= starts[0]! + 55, `gap1=${starts[1]! - starts[0]!}`);
		assert.ok(starts[2]! >= starts[1]! + 55, `gap2=${starts[2]! - starts[1]!}`);
		// serial: each run finishes before the next starts
		assert.ok(starts[1]! >= finishes[0]!);
		assert.ok(starts[2]! >= finishes[1]!);
	});

	test("a rejected run does not break the queue", async () => {
		const pacer = createRequestPacer();
		const order: string[] = [];
		const first = pacer(1, async () => {
			order.push("first");
			throw new Error("boom");
		});
		const second = pacer(1, async () => {
			order.push("second");
			return "ok";
		});
		await assert.rejects(first, /boom/);
		assert.equal(await second, "ok");
		assert.deepEqual(order, ["first", "second"]);
	});

	test("host budgets are documented per service", () => {
		assert.equal(minGapFor("export.arxiv.org"), 3000);
		assert.equal(minGapFor("api.crossref.org"), 1200);
		assert.equal(minGapFor("api.openalex.org"), 1100);
		assert.equal(minGapFor("unknown.example"), DEFAULT_MIN_GAP_MS);
		assert.ok(Object.keys(HOST_MIN_GAP_MS).length >= 7);
	});

	test("pace() spaces two requests to the same host", async () => {
		resetPacers();
		const arrivals: number[] = [];
		const fetchLike = async (): Promise<Response> => {
			arrivals.push(Date.now());
			return textResponse("ok");
		};
		setFetch(fetchLike);
		try {
			await requestText("https://example.test/one");
			await requestText("https://example.test/two");
			const gap = arrivals[1]! - arrivals[0]!;
			// default host budget is 300 ms; allow small timer slack
			assert.ok(gap >= 250, `gap was ${gap} ms`);
		} finally {
			restoreNetwork();
			resetFetch();
			resetPacers();
		}
	});
});
