// Slug derivation and scale decisions.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deriveScaleDecision, deriveSlug, effectiveMode } from "../src/workflows/runner.ts";
import { getWorkflow } from "../src/workflows/registry.ts";

describe("deriveSlug", () => {
	test("lowercase, hyphenated, ≤5 words", () => {
		assert.equal(deriveSlug("Cloud sandbox pricing"), "cloud-sandbox-pricing");
		// filler words are dropped, so the classic title loses its "is"
		assert.equal(deriveSlug("Attention Is All You Need"), "attention-all-you-need");
	});

	test("drops filler words", () => {
		assert.equal(deriveSlug("What is the capital of France?"), "capital-france");
		assert.equal(deriveSlug("A Comparison of the best vs the worst"), "comparison-best-worst");
	});

	test("caps at five words", () => {
		const slug = deriveSlug("one two three four five six seven");
		assert.equal(slug, "one-two-three-four-five");
		assert.equal(slug.split("-").length, 5);
	});

	test("strips punctuation and survives empty input", () => {
		assert.equal(deriveSlug("BIOLOGY: Cells & Genes!"), "biology-cells-genes");
		assert.equal(deriveSlug("!!!"), "research-topic");
		assert.equal(deriveSlug(""), "research-topic");
		assert.equal(deriveSlug("   the   and   of   "), "research-topic");
	});

	test("keeps digits and hyphen-safe tokens", () => {
		assert.equal(deriveSlug("GPT-4o mini explained"), "gpt-4o-mini-explained");
	});
});

describe("scale decisions", () => {
	test("deterministic mode is always direct", () => {
		const decision = deriveScaleDecision("a very broad multi faceted survey topic", getWorkflow("deepresearch"), "deterministic");
		assert.equal(decision.scale, "direct");
		assert.match(decision.rationale, /deterministic mode/);
	});

	test("llm mode fans out for broad deepresearch and stays direct for narrow summarize", () => {
		const broad = deriveScaleDecision("transformer scaling laws across modalities and regimes", getWorkflow("deepresearch"), "llm");
		assert.equal(broad.scale, "multi-agent");
		const narrow = deriveScaleDecision("Attention", getWorkflow("summarize"), "llm");
		assert.equal(narrow.scale, "direct");
	});
});

describe("effectiveMode", () => {
	test("explicit deterministic wins; auto follows key presence", () => {
		const saved = {
			OPENAI_API_KEY: process.env.OPENAI_API_KEY,
			ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
			OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
			SAKIREA_MODEL: process.env.SAKIREA_MODEL,
		};
		try {
			delete process.env.OPENAI_API_KEY;
			delete process.env.ANTHROPIC_API_KEY;
			delete process.env.OPENROUTER_API_KEY;
			delete process.env.SAKIREA_MODEL;
			assert.equal(effectiveMode("auto"), "deterministic");
			assert.equal(effectiveMode(undefined), "deterministic");
			assert.equal(effectiveMode("llm"), "deterministic"); // no key anywhere
			process.env.OPENAI_API_KEY = "sk-test";
			assert.equal(effectiveMode("auto"), "llm");
			assert.equal(effectiveMode("deterministic"), "deterministic");
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
});
