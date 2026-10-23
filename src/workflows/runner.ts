// Workflow runner: slug → plan artifact → evidence gathering → role pipeline →
// final artifact → provenance sidecars, all staged on disk in that order.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runPipeline, type RequestedMode, type SourceFailure } from "../agents/orchestrator.ts";
import { resolveModel } from "../model/registry.ts";
import { buildProvenance, writeProvenance } from "../provenance/sidecar.ts";
import { getConnector, scienceDatabaseSearch } from "../sources/index.ts";
import type { SourceResult } from "../sources/types.ts";
import { VERSION } from "../version.ts";
import { getWorkflow, loadPrompt, type Workflow } from "./registry.ts";

export const DEFAULT_SOURCES = ["semanticscholar", "openalex", "pubmed"];
export const DEFAULT_LIMIT = 5;

const FILLER_WORDS = new Set([
	"a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "at", "by",
	"with", "about", "into", "from", "is", "are", "was", "were", "be", "been",
	"what", "how", "why", "when", "which", "who", "do", "does", "did", "can",
	"could", "should", "would", "vs", "versus", "please", "tell", "me",
]);

/** Lowercase, hyphenated, filler words dropped, at most 5 words. */
export function deriveSlug(topic: string): string {
	const words = String(topic ?? "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word && !FILLER_WORDS.has(word));
	const slug = words.slice(0, 5).join("-");
	return slug || "research-topic";
}

export type EffectiveMode = "deterministic" | "llm";

export function effectiveMode(mode: RequestedMode | undefined, model?: string): EffectiveMode {
	if (mode === "deterministic") return "deterministic";
	return resolveModel(model) ? "llm" : "deterministic";
}

export interface ScaleDecision {
	scale: "direct" | "multi-agent";
	rationale: string;
}

export function deriveScaleDecision(topic: string, workflow: Workflow, mode: EffectiveMode): ScaleDecision {
	if (mode === "deterministic") {
		return {
			scale: "direct",
			rationale: "deterministic mode (no LLM key): role stages run as template sections in one pass, with no agent fan-out.",
		};
	}
	const tokens = topic.split(/\s+/).filter(Boolean).length;
	if (tokens <= 3 && workflow.agents.length <= 3 && workflow.id !== "deepresearch" && workflow.id !== "autoresearch") {
		return { scale: "direct", rationale: "narrow question and a small role pipeline: one lead pass is enough." };
	}
	return {
		scale: "multi-agent",
		rationale: `${workflow.agents.length} role stages for a ${tokens}-token topic: decomposition reduces context pressure.`,
	};
}

export interface RunOptions {
	topic: string;
	workflowId?: string;
	mode?: RequestedMode;
	/** Directory receiving the final artifact and sidecars (default: the workflow's own outputs/ or papers/). */
	outputDir?: string;
	model?: string;
	sources?: string[];
	limit?: number;
}

export interface RunResult {
	slug: string;
	workflowId: string;
	mode: EffectiveMode;
	status: "completed" | "degraded";
	artifactPath: string;
	provenancePath: string;
	provenanceJsonPath: string;
	planPath: string;
	draftPath: string;
	resultsCount: number;
	failures: SourceFailure[];
}

interface Gathered {
	results: SourceResult[];
	failures: SourceFailure[];
	docs: string[];
	endpoints: string[];
	queriedAt: string;
}

async function gatherEvidence(topic: string, sources: string[], limit: number): Promise<Gathered> {
	const results: SourceResult[] = [];
	const failures: SourceFailure[] = [];
	const docs: string[] = [];
	const endpoints: string[] = [];
	let queriedAt = new Date().toISOString();
	for (const source of sources) {
		const connector = getConnector(source); // unknown source is a caller error, not a degraded run
		docs.push(connector.docs);
		try {
			const envelope = await scienceDatabaseSearch({ source, query: topic, limit });
			results.push(...envelope.results);
			endpoints.push(...envelope.provenance.endpoints);
			queriedAt = envelope.provenance.queriedAt;
		} catch (error) {
			endpoints.push(...(connector.describe?.({ query: topic, limit }) ?? connector.endpoints));
			failures.push({ source, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { results, failures, docs, endpoints, queriedAt };
}

function planMarkdown(input: {
	topic: string;
	slug: string;
	workflow: Workflow;
	mode: EffectiveMode;
	scale: ScaleDecision;
	sources: string[];
	limit: number;
}): string {
	const ledgerRows = input.workflow.agents
		.map((agent) => `| ${agent} | ${agent} | pending |`)
		.join("\n");
	return [
		`# Plan: ${input.topic}`,
		"",
		`- **Slug:** ${input.slug}`,
		`- **Workflow:** ${input.workflow.id} — ${input.workflow.name}`,
		`- **Mode:** ${input.mode}${input.mode === "deterministic" ? " (no LLM key)" : ""}`,
		`- **Scale:** ${input.scale.scale} — ${input.scale.rationale}`,
		`- **Sources:** ${input.sources.join(", ")} (limit ${input.limit} each)`,
		`- **Generated:** ${new Date().toISOString()}`,
		`- **Sakirea:** v${VERSION}`,
		"",
		"## Key questions",
		"",
		`1. What do the retrieved sources actually claim about ${input.topic}?`,
		"2. Which claims are primary evidence and which are commentary?",
		"3. Where do the sources disagree, and what evidence would resolve it?",
		"",
		"## Evidence needed",
		"",
		`- Records (title, year, venue, URL, citations) from: ${input.sources.join(", ")}`,
		"- Abstracts or fetched page text for the records the conclusions depend on",
		"- Endpoint provenance for every retrieval (recorded in the sidecar)",
		"",
		"## Task ledger",
		"",
		"| Task | Owner | Status |",
		"|------|-------|--------|",
		"| Gather evidence from the listed sources | researcher | pending |",
		"| Verify citations and statuses | verifier | pending |",
		"| Adversarial review of the draft | reviewer | pending |",
		"| Write the final artifact | writer | pending |",
		"",
		"### Role pipeline for this run",
		"",
		"| Stage | Role | Status |",
		"|-------|------|--------|",
		ledgerRows,
		"",
		"## Verification log",
		"",
		"| Check | Status | Note |",
		"|-------|--------|------|",
		"| Sources reachable | pending | filled during gathering |",
		"| Every claim has a URL | pending | filled at delivery |",
		"",
		"## Decision log",
		"",
		`- Scale decision: ${input.scale.scale} — ${input.scale.rationale}`,
		"- Default sources chosen for coverage across general, biomedical, and citation-sorted indexes.",
		"",
	].join("\n");
}

function draftMarkdown(input: {
	topic: string;
	slug: string;
	sources: string[];
	gathered: Gathered;
}): string {
	const rows = input.gathered.results.map((result, index) => {
		const title = result.title.replace(/\|/g, "\\|");
		return `| ${index + 1} | ${title} | ${result.year ?? "—"} | ${result.source} | ${result.url ?? "—"} |`;
	});
	return [
		`# Draft notes: ${input.topic}`,
		"",
		`- **Slug:** ${input.slug}`,
		`- **Queries issued:** ${input.sources.map((source) => `${source} ← "${input.topic}"`).join("; ")}`,
		`- **Retrieved:** ${input.gathered.results.length} record(s)`,
		`- **Blocked:** ${input.gathered.failures.length ? input.gathered.failures.map((f) => f.source).join(", ") : "none"}`,
		"",
		"## Retrieved records",
		"",
		"| # | Title | Year | Source | URL |",
		"|---|-------|------|--------|-----|",
		...(rows.length ? rows : ["| — | no records retrieved | — | — | — |"]),
		"",
		"## Retrieval failures",
		"",
		...(input.gathered.failures.length
			? input.gathered.failures.map((failure) => `- \`${failure.source}\`: ${failure.error}`)
			: ["- none"]),
		"",
	].join("\n");
}

export async function runWorkflow(options: RunOptions): Promise<RunResult> {
	const topic = String(options.topic ?? "").trim();
	if (!topic) throw new Error("A non-empty topic is required.");

	const workflow = getWorkflow(options.workflowId ?? "deepresearch");
	const prompt = loadPrompt(workflow.id);
	const slug = deriveSlug(topic);
	const mode = effectiveMode(options.mode, options.model);
	const scale = deriveScaleDecision(topic, workflow, mode);
	const sources = options.sources?.length ? [...options.sources] : [...DEFAULT_SOURCES];
	const limit = options.limit ?? DEFAULT_LIMIT;

	const directory = resolve(options.outputDir ?? workflow.outputDir);
	const planDir = join(directory, ".plans");
	const draftDir = join(directory, ".drafts");
	mkdirSync(planDir, { recursive: true });
	mkdirSync(draftDir, { recursive: true });

	const planPath = join(planDir, `${slug}.md`);
	writeFileSync(planPath, planMarkdown({ topic, slug, workflow, mode, scale, sources, limit }), "utf8");

	const gathered = await gatherEvidence(topic, sources, limit);
	const draftPath = join(draftDir, `${slug}-draft.md`);
	writeFileSync(draftPath, draftMarkdown({ topic, slug, sources, gathered }), "utf8");

	const pipeline = await runPipeline({
		topic,
		workflowId: workflow.id,
		workflowName: workflow.name,
		promptBody: prompt.body,
		results: gathered.results,
		failures: gathered.failures,
		mode: options.mode ?? "auto",
		model: options.model,
		roles: workflow.agents,
	});

	const artifactPath = join(directory, `${slug}.md`);
	mkdirSync(directory, { recursive: true });
	writeFileSync(artifactPath, pipeline.artifact, "utf8");

	const provenance = buildProvenance({
		slug,
		topic,
		workflow: workflow.id,
		workflowName: workflow.name,
		artifact: artifactPath,
		mode: `${pipeline.mode}${pipeline.mode === "deterministic" ? " (no LLM key)" : ""}`,
		model: pipeline.model,
		verification: `Verification: ${pipeline.verification}`,
		results: gathered.results,
		failures: gathered.failures,
		queried: sources,
		docs: gathered.docs,
		endpoints: gathered.endpoints,
		queriedAt: gathered.queriedAt,
	});
	const { mdPath, jsonPath } = writeProvenance(directory, slug, provenance);

	// The plan's verification log reflects what actually happened.
	const planWithLog = [
		readPlan(planPath),
		"",
		"## Run outcome",
		"",
		`- Sources queried: ${sources.join(", ")}`,
		`- Records retrieved: ${gathered.results.length}`,
		`- Blocked sources: ${gathered.failures.length ? gathered.failures.map((f) => `${f.source} (${f.error})`).join("; ") : "none"}`,
		`- Verification: ${pipeline.verification}`,
		`- Artifact: ${artifactPath}`,
		"",
	].join("\n");
	writeFileSync(planPath, planWithLog, "utf8");

	return {
		slug,
		workflowId: workflow.id,
		mode: pipeline.mode,
		status: gathered.failures.length === 0 && gathered.results.length > 0 ? "completed" : "degraded",
		artifactPath,
		provenancePath: mdPath,
		provenanceJsonPath: jsonPath,
		planPath,
		draftPath,
		resultsCount: gathered.results.length,
		failures: gathered.failures,
	};
}

function readPlan(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}
