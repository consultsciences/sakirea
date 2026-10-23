// Additional engines: web, Hugging Face, model registry, telemetry, config,
// and the LLM orchestrator path (chat completions stubbed — zero network).
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchContent, htmlToText, parseDdgHtml, webSearch, unwrapDdgHref, FETCH_CONTENT_MAX_CHARS } from "../src/sources/web.ts";
import { hfRepoFiles, hfRepoReadFile, hfSearch, buildHfRawUrl } from "../src/sources/huggingface.ts";
import { listModels, listProviders, providerInfo, resolveModel } from "../src/model/registry.ts";
import { chatComplete } from "../src/model/chat.ts";
import { TELEMETRY_ENABLED, telemetryInfo, track, flush } from "../src/telemetry/noop.ts";
import { readSettings, sakireaHome, settingsPath, writeSettings, ensureHome } from "../src/config/paths.ts";
import { runPipeline } from "../src/agents/orchestrator.ts";
import { jsonResponse, restoreNetwork, cleanupDir, tempDir, textResponse } from "./helpers.ts";
import { setFetch, resetFetch } from "../src/sources/http.ts";
import { resetPacers } from "../src/sources/pacer.ts";

const LLM_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SAKIREA_MODEL"] as const;
const savedEnv: Record<string, string | undefined> = {};
const tempDirs: string[] = [];

function stash(): void {
	for (const key of [...LLM_KEYS, "SAKIREA_HOME"]) savedEnv[key] = process.env[key];
}

function clearKeys(): void {
	for (const key of LLM_KEYS) delete process.env[key];
}

afterEach(() => {
	restoreNetwork();
	resetFetch();
	resetPacers();
	for (const key of [...LLM_KEYS, "SAKIREA_HOME"]) {
		const value = savedEnv[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	for (const dir of tempDirs.splice(0)) cleanupDir(dir);
});

const DDG_HTML = `<!DOCTYPE html><html><body>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fwidget&amp;rut=xyz">Example Widget Title</a>
<a class="result__snippet">Widgets explained in a <b>short</b> snippet.</a>
<a rel="nofollow" class="result__a" href="https://direct.example.org/paper">Direct Result</a>
</body></html>`;

describe("web engine", () => {
	test("parses DuckDuckGo HTML results and unwraps redirect links", () => {
		const results = parseDdgHtml(DDG_HTML);
		assert.equal(results.length, 2);
		assert.equal(results[0]?.title, "Example Widget Title");
		assert.equal(results[0]?.url, "https://example.com/widget");
		assert.equal(results[0]?.snippet, "Widgets explained in a short snippet.");
		assert.equal(results[1]?.title, "Direct Result");
		assert.equal(results[1]?.url, "https://direct.example.org/paper");
		assert.match(unwrapDdgHref("http://duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2Fx&rut=1"), /^https:\/\/a\.test\/x/);
	});

	test("web_search returns an envelope with endpoint provenance", async () => {
		setFetch(async (input) => {
			const url = new URL(String(input));
			assert.equal(url.hostname, "html.duckduckgo.com");
			assert.equal(url.searchParams.get("q"), "widget algorithms");
			return textResponse(DDG_HTML, 200, { "content-type": "text/html" });
		});
		const envelope = await webSearch("widget algorithms", 5);
		assert.equal(envelope.ok, true);
		assert.equal(envelope.degraded, false);
		assert.equal(envelope.returned, 2);
		assert.ok(envelope.provenance.endpoints[0]?.includes("html.duckduckgo.com/html/?q=widget+algorithms"));
		assert.ok(!Number.isNaN(Date.parse(envelope.provenance.queriedAt)));
	});

	test("web_search degrades instead of throwing", async () => {
		setFetch(async () => textResponse("busy", 503));
		const envelope = await webSearch("anything");
		assert.equal(envelope.ok, false);
		assert.equal(envelope.degraded, true);
		assert.equal(envelope.returned, 0);
		assert.match(envelope.error ?? "", /503/);
		const empty = await webSearch("   ");
		assert.equal(empty.degraded, true);
		assert.match(empty.error ?? "", /non-empty query/);
	});
});

describe("fetch_content", () => {
	test("strips HTML down to readable text", async () => {
		setFetch(async () =>
			textResponse(
				`<!doctype html><html><head><style>.x{color:red}</style><script>alert(1)</script></head>
<body><h1>Widget Report</h1><p>First paragraph with &amp;amp; entity.</p><div>Second block.</div></body></html>`,
				200,
				{ "content-type": "text/html" },
			),
		);
		const envelope = await fetchContent("https://example.com/report");
		assert.equal(envelope.ok, true);
		assert.equal(envelope.contentType, "text/html");
		assert.equal(envelope.truncated, false);
		assert.match(envelope.text, /Widget Report/);
		assert.match(envelope.text, /First paragraph/);
		assert.ok(!envelope.text.includes("alert(1)"), "scripts dropped");
		assert.ok(!envelope.text.includes("color:red"), "styles dropped");
	});

	test("caps content at ~50k characters", async () => {
		setFetch(async () => textResponse(`<html><body>${"word ".repeat(20_000)}</body></html>`));
		const envelope = await fetchContent("https://example.com/long");
		assert.equal(envelope.truncated, true);
		assert.equal(envelope.text.length, FETCH_CONTENT_MAX_CHARS);
	});

	test("degrades on bad URLs and failed fetches", async () => {
		const bad = await fetchContent("not a url");
		assert.equal(bad.ok, false);
		assert.match(bad.error ?? "", /absolute http/);
		setFetch(async () => textResponse("gone", 404));
		const failed = await fetchContent("https://example.com/missing");
		assert.equal(failed.degraded, true);
		assert.match(failed.error ?? "", /404/);
	});

	test("htmlToText collapses whitespace and block boundaries", () => {
		const text = htmlToText("<p>a</p><p>b</p><span>c</span>");
		assert.equal(text, "a\nb\nc");
	});
});

describe("hugging face engine", () => {
	test("hf_search normalizes model hits", async () => {
		setFetch(async (input) => {
			const url = new URL(String(input));
			assert.equal(url.hostname, "huggingface.co");
			assert.equal(url.pathname, "/api/models");
			assert.equal(url.searchParams.get("search"), "widgets");
			return jsonResponse([
				{ id: "acme/widgets", downloads: 1234, likes: 56, lastModified: "2025-01-01", pipeline_tag: "text-classification" },
			]);
		});
		const envelope = await hfSearch({ query: "widgets", limit: 3 });
		assert.equal(envelope.returned, 1);
		assert.equal(envelope.results[0]?.id, "acme/widgets");
		assert.equal(envelope.results[0]?.kind, "model");
		assert.equal(envelope.results[0]?.downloads, 1234);
		assert.equal(envelope.results[0]?.url, "https://huggingface.co/acme/widgets");
		assert.equal(envelope.provenance.docs, "https://huggingface.co/docs/hub");
		await assert.rejects(() => hfSearch({ query: "  " }), /non-empty query/);
	});

	test("hf_repo_files lists the tree", async () => {
		setFetch(async (input) => {
			const url = new URL(String(input));
			assert.equal(url.pathname, "/api/datasets/acme/widgets/tree/main");
			assert.equal(url.searchParams.get("recursive"), "true");
			return jsonResponse([
				{ type: "file", path: "README.md", size: 100 },
				{ type: "directory", path: "data" },
			]);
		});
		const envelope = await hfRepoFiles({ repo: "acme/widgets", kind: "dataset" });
		assert.equal(envelope.kind, "dataset");
		assert.equal(envelope.files.length, 2);
		assert.equal(envelope.files[0]?.path, "README.md");
		assert.equal(envelope.files[0]?.size, 100);
	});

	test("hf_repo_read_file reads text and refuses binaries", async () => {
		setFetch(async (input) => {
			const url = new URL(String(input));
			assert.equal(url.toString(), "https://huggingface.co/acme/widgets/raw/main/README.md");
			return textResponse("# Widgets\nA model card.");
		});
		const envelope = await hfRepoReadFile({ repo: "acme/widgets", path: "README.md" });
		assert.match(envelope.text, /A model card/);
		assert.equal(envelope.truncated, false);

		await assert.rejects(
			() => hfRepoReadFile({ repo: "acme/widgets", path: "model.safetensors" }),
			/refuses binary file/,
		);
		assert.equal(
			buildHfRawUrl("acme/widgets", "dataset", "data/train.csv"),
			"https://huggingface.co/datasets/acme/widgets/raw/main/data/train.csv",
		);
	});
});

describe("model registry", () => {
	test("listing needs no key", () => {
		stash();
		clearKeys();
		const models = listModels();
		assert.ok(models.length >= 4);
		assert.ok(models.some((model) => model.id === "gpt-4o-mini" && model.provider === "openai"));
		assert.ok(models.some((model) => model.provider === "anthropic"));
		assert.ok(models.every((model) => model.source === "catalog"));
		const providers = listProviders();
		assert.equal(providers.length, 4);
		assert.equal(providers.find((provider) => provider.id === "ollama")?.available, true);
		assert.equal(providers.find((provider) => provider.id === "openai")?.available, false);
	});

	test("resolveModel picks the first keyed provider and defaults per provider", () => {
		stash();
		clearKeys();
		assert.equal(resolveModel(), undefined);
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		const anthropic = resolveModel();
		assert.equal(anthropic?.provider, "anthropic");
		assert.equal(anthropic?.model, "claude-sonnet");
		assert.equal(anthropic?.baseUrl, "https://api.anthropic.com/v1");

		process.env.OPENAI_API_KEY = "sk-test";
		const openai = resolveModel();
		assert.equal(openai?.provider, "openai");
		assert.equal(openai?.model, "gpt-4o-mini");

		// explicit provider prefixes win (each provider needs its own key)
		process.env.OPENROUTER_API_KEY = "or-test";
		assert.equal(resolveModel("openrouter/openai/gpt-4o-mini")?.provider, "openrouter");
		assert.equal(resolveModel("ollama/llama3.2")?.provider, "ollama"); // local needs no key
		// explicit provider without its key resolves to nothing
		clearKeys();
		process.env.OPENAI_API_KEY = "sk-test";
		assert.equal(resolveModel("anthropic/claude-sonnet"), undefined);
		// SAKIREA_MODEL supplies the default name
		process.env.SAKIREA_MODEL = "gpt-4o";
		assert.equal(resolveModel()?.model, "gpt-4o");
	});

	test("providerInfo reports key availability", () => {
		stash();
		clearKeys();
		assert.equal(providerInfo("openai").available, false);
		process.env.OPENAI_API_KEY = "sk-test";
		assert.equal(providerInfo("openai").available, true);
		assert.equal(providerInfo("ollama").envKey, undefined);
	});
});

describe("chat completions", () => {
	test("POSTs an OpenAI-compatible payload and returns the message text", async () => {
		let captured: { url: URL; body: Record<string, unknown>; headers: Headers } | undefined;
		setFetch(async (input, init) => {
			captured = {
				url: new URL(String(input)),
				body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
				headers: new Headers(init?.headers ?? {}),
			};
			return jsonResponse({ choices: [{ message: { content: "## Writer output\nDone." } }] });
		});
		const text = await chatComplete(
			{ provider: "openai", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" },
			[
				{ role: "system", content: "policy" },
				{ role: "user", content: "task" },
			],
		);
		assert.equal(text, "## Writer output\nDone.");
		assert.equal(captured?.url.toString(), "https://api.openai.com/v1/chat/completions");
		assert.equal(captured?.body.model, "gpt-4o-mini");
		assert.equal(captured?.headers.get("authorization"), "Bearer sk-test");
	});
});

describe("LLM mode orchestrator", () => {
	test("runs one call per role and marks the mode llm", async () => {
		stash();
		clearKeys();
		process.env.OPENAI_API_KEY = "sk-test";
		const calls: string[] = [];
		setFetch(async (input, init) => {
			const url = new URL(String(input));
			assert.equal(url.pathname, "/v1/chat/completions");
			const body = JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ role: string; content: string }> };
			const prompt = body.messages.at(-1)?.content ?? "";
			calls.push(prompt.includes("Role: researcher") ? "researcher" : prompt.includes("Role: writer") ? "writer" : "other");
			return jsonResponse({
				choices: [{ message: { content: `## Output from ${calls.at(-1)}\nEvidence cited [1].` } }],
			});
		});
		const output = await runPipeline({
			topic: "widget algorithms",
			workflowId: "deepresearch",
			workflowName: "Deep research",
			promptBody: "Investigate the topic.",
			results: [
				{
					id: "1",
					title: "Widget Paper",
					year: 2024,
					authors: ["Ada Lovelace"],
					venue: "Journal of Widgets",
					url: "https://example.com/paper",
					abstract: "Widgets.",
					source: "openalex",
				},
			],
			failures: [],
			mode: "llm",
			roles: ["researcher", "writer"],
		});
		assert.equal(output.mode, "llm");
		assert.equal(output.model, "openai/gpt-4o-mini");
		assert.deepEqual(output.steps.map((step) => `${step.role}:${step.status}`), ["researcher:ok", "writer:ok"]);
		assert.match(output.artifact, /\*\*Mode:\*\* llm/);
		assert.match(output.artifact, /Output from writer/);
		assert.match(output.artifact, /Widget Paper/);
	});

	test("falls back to deterministic synthesis when the model call fails", async () => {
		stash();
		clearKeys();
		process.env.OPENAI_API_KEY = "sk-test";
		setFetch(async () => textResponse("nope", 500));
		const output = await runPipeline({
			topic: "widget algorithms",
			workflowId: "deepresearch",
			workflowName: "Deep research",
			promptBody: "Investigate.",
			results: [],
			failures: [{ source: "openalex", error: "HTTP 503" }],
			mode: "llm",
			roles: ["writer"],
		});
		assert.equal(output.mode, "llm");
		assert.equal(output.steps[0]?.status, "error");
		assert.equal(output.steps[1]?.status, "fallback");
		assert.match(output.artifact, /llm steps failed \(writer\)/);
		assert.match(output.artifact, /\*\*Verification:\*\* BLOCKED/);
	});

	test("llm mode without a key is deterministic and says so", async () => {
		stash();
		clearKeys();
		const output = await runPipeline({
			topic: "no keys here",
			workflowId: "lit",
			workflowName: "Literature review",
			promptBody: "Review.",
			results: [],
			failures: [],
			mode: "llm",
		});
		assert.equal(output.mode, "deterministic");
		assert.match(output.modeLabel, /deterministic \(no LLM key\)/);
		assert.match(output.modeLabel, /no API key is configured/);
	});
});

describe("telemetry and config", () => {
	test("telemetry is explicitly disabled and side-effect free", async () => {
		assert.equal(TELEMETRY_ENABLED, false);
		track({ name: "run.started", properties: { workflow: "deepresearch" } });
		await flush();
		const info = telemetryInfo();
		assert.equal(info.enabled, false);
		assert.equal(info.provider, "none");
		assert.match(info.note, /no telemetry/);
	});

	test("SAKIREA_HOME overrides the config directory and settings persist", () => {
		const home = tempDir("sakirea-config");
		tempDirs.push(home);
		const previous = process.env.SAKIREA_HOME;
		try {
			process.env.SAKIREA_HOME = home;
			assert.equal(sakireaHome(), home);
			assert.equal(settingsPath(), join(home, "settings.json"));
			assert.deepEqual(readSettings(), {});
			writeSettings({ mode: "deterministic", model: "gpt-4o-mini" });
			const loaded = readSettings();
			assert.equal(loaded.mode, "deterministic");
			assert.equal(loaded.model, "gpt-4o-mini");
			assert.ok(existsSync(join(home, "settings.json")));
			// corrupt settings degrade to {} instead of crashing
			writeFileSync(join(home, "settings.json"), "{oops", "utf8");
			assert.deepEqual(readSettings(), {});
		} finally {
			if (previous === undefined) delete process.env.SAKIREA_HOME;
			else process.env.SAKIREA_HOME = previous;
		}
	});

	test("ensureHome creates the directory", () => {
		const home = tempDir("sakirea-home-create");
		tempDirs.push(home);
		const previous = process.env.SAKIREA_HOME;
		try {
			process.env.SAKIREA_HOME = join(home, "nested");
			assert.equal(ensureHome(), join(home, "nested"));
			assert.ok(existsSync(join(home, "nested")));
		} finally {
			if (previous === undefined) delete process.env.SAKIREA_HOME;
			else process.env.SAKIREA_HOME = previous;
		}
	});
});
