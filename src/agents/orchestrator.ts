// The agent engine: a role pipeline over one task.
//
// Two modes:
//   * LLM mode       — a configured key (OPENAI_API_KEY / ANTHROPIC_API_KEY /
//     OPENROUTER_API_KEY) means one OpenAI-compatible chat-completions call per
//     role step, with the workflow prompt and the retrieved evidence as input.
//   * Deterministic  — no key: the artifact is synthesized directly from the
//     source results with template sections, labeled
//     "mode: deterministic (no LLM key)".
//
// Both modes always write an artifact; failures degrade statuses, they do not
// abort the run.
import { loadPolicy, loadRole, roleIdList, type RoleId } from "./loader.ts";
import { chatComplete, type ChatMessage } from "../model/chat.ts";
import { resolveModel, type ResolvedModel } from "../model/registry.ts";
import type { SourceResult } from "../sources/types.ts";

export type RequestedMode = "auto" | "deterministic" | "llm";

export interface SourceFailure {
	source: string;
	error: string;
}

export interface PipelineInput {
	topic: string;
	workflowId: string;
	workflowName: string;
	promptBody: string;
	results: SourceResult[];
	failures: SourceFailure[];
	mode?: RequestedMode;
	model?: string;
	roles?: string[];
}

export interface StepResult {
	role: string;
	status: "ok" | "error" | "fallback";
	text?: string;
	error?: string;
}

export interface PipelineOutput {
	mode: "deterministic" | "llm";
	/** Human-facing label written into the artifact's Mode line. */
	modeLabel: string;
	model: string | undefined;
	provider: string | undefined;
	roles: string[];
	steps: StepResult[];
	verification: string;
	artifact: string;
}

export function evidenceDigest(results: SourceResult[], max = 20): string {
	if (!results.length) return "No records were retrieved.";
	return results
		.slice(0, max)
		.map((result, index) => {
			const authors = result.authors.length ? result.authors.join(", ") : "unknown authors";
			const venue = result.venue ? `, ${result.venue}` : "";
			const citations = result.citations !== undefined ? `, citations=${result.citations}` : "";
			return `${index + 1}. ${result.title} (${result.year ?? "n.d."}) [${result.source}] — ${authors}${venue}${citations} — ${result.url ?? "no URL"}`;
		})
		.join("\n");
}

function sourcesSection(results: SourceResult[]): string {
	if (!results.length) return "## Sources\n\n_No sources retrieved._\n";
	const lines = results.map((result, index) => {
		const year = result.year ?? "n.d.";
		return `${index + 1}. ${result.title} — ${result.url ?? "no URL"} (${year}) [${result.source}]`;
	});
	return `## Sources\n\n${lines.join("\n")}\n`;
}

function evidenceSection(results: SourceResult[]): string {
	if (!results.length) return "## Evidence\n\n_No records retrieved from any source._\n";
	const rows = results.map((result, index) => {
		const title = result.title.replace(/\|/g, "\\|");
		const venue = (result.venue ?? "—").replace(/\|/g, "\\|");
		const authors = (result.authors.length ? result.authors.join(", ") : "—").replace(/\|/g, "\\|");
		const url = result.url ?? "—";
		return `| ${index + 1} | ${title} | ${result.year ?? "—"} | ${venue} | ${result.source} | ${result.citations ?? "—"} | ${authors} | ${url} |`;
	});
	return `## Evidence\n\n| # | Title | Year | Venue | Source | Citations | Authors | URL |\n|---|-------|------|-------|--------|-----------|---------|-----|\n${rows.join("\n")}\n`;
}

function coverageSection(failures: SourceFailure[], queriedSources: string[]): string {
	const lines: string[] = [];
	lines.push(`- Sources queried: ${queriedSources.length ? queriedSources.join(", ") : "none"}`);
	if (failures.length) {
		lines.push(`- Blocked sources (${failures.length}):`);
		for (const failure of failures) lines.push(`  - \`${failure.source}\` — ${failure.error}`);
	} else {
		lines.push("- Blocked sources: none");
	}
	return `## Coverage Status\n\n${lines.join("\n")}\n`;
}

export function verificationLabel(failures: SourceFailure[], results: SourceResult[]): string {
	if (failures.length > 0 || results.length === 0) {
		const reasons: string[] = [];
		if (results.length === 0) reasons.push("no records were retrieved");
		if (failures.length) reasons.push(`${failures.length} source(s) failed`);
		return `BLOCKED — ${reasons.join("; ")}`;
	}
	return "UNVERIFIED — records retrieved from source databases; no full-text or URL check was performed in this run";
}

function headerLines(input: PipelineInput, modeLabel: string, model: string | undefined, verification: string): string {
	const modelLine = model ? `\n**Model:** ${model}` : "";
	return [
		`# ${input.topic}`,
		"",
		`**Workflow:** ${input.workflowId} — ${input.workflowName}`,
		`**Mode:** ${modeLabel}${modelLine}`,
		`**Generated:** ${new Date().toISOString()}`,
		`**Verification:** ${verification}`,
		"",
	].join("\n");
}

function deterministicSections(input: PipelineInput, verification: string): string {
	const failureNote = input.failures.length
		? `\n_${input.failures.length} source(s) failed during retrieval and are listed under Coverage Status._\n`
		: "";
	const summary = input.results.length
		? `Retrieved ${input.results.length} record(s) from ${new Set(input.results.map((r) => r.source)).size} database(s) for this topic. Findings below are metadata-level: they are drawn from the returned records and are not a substitute for reading the full texts.`
		: "No records were retrieved, so this artifact carries no evidence-backed findings. Treat every substantive question as open until a source responds.";
	return [
		"## Summary",
		"",
		summary,
		failureNote,
		"",
		evidenceSection(input.results),
		"",
		"## Findings",
		"",
		...(input.results.length
			? input.results.map((result, index) => {
					const abstract = result.abstract ? ` ${result.abstract}` : "";
					return `- [${index + 1}] ${result.title}${result.year ? ` (${result.year})` : ""}${result.venue ? ` — ${result.venue}` : ""}.${abstract}`;
				})
			: ["- _No findings: retrieval produced nothing to report._"]),
		"",
		"## Disagreements and Gaps",
		"",
		input.results.length
			? "- Metadata-only pass: abstracts and venue fields were not cross-checked against publisher pages."
			: "- No evidence retrieved; every question remains unresolved.",
		"",
		"## Open Questions",
		"",
		"- Which of the retrieved records contain the primary evidence for this topic (requires full-text reading)?",
		"- Are there contradicting results outside the databases queried here?",
		"",
		coverageSection(input.failures, [...new Set([...input.results.map((r) => r.source), ...input.failures.map((f) => f.source)])]),
		"",
		sourcesSection(input.results),
	].join("\n");
}

function rolePrompt(input: PipelineInput, role: string, prior: StepResult[]): string {
	const policy = loadPolicy();
	const persona = loadRole(role);
	const priorText = prior
		.filter((step) => step.status === "ok" && step.text)
		.map((step) => `### ${step.role} output\n\n${step.text}`)
		.join("\n\n");
	return [
		policy,
		"",
		`## Role: ${persona.name}`,
		"",
		persona.body,
		"",
		"## Task",
		"",
		`Workflow: ${input.workflowId} (${input.workflowName})`,
		`Topic: ${input.topic}`,
		"",
		"### Workflow instructions",
		"",
		input.promptBody.trim(),
		"",
		"### Retrieved evidence",
		"",
		evidenceDigest(input.results),
		...(input.failures.length
			? ["", "### Retrieval failures", "", ...input.failures.map((failure) => `- ${failure.source}: ${failure.error}`)]
			: []),
		...(priorText ? ["", "### Earlier role outputs", "", priorText] : []),
		"",
		"Produce your role's output as Markdown now. Cite sources by their evidence numbers. If a check could not be performed, mark it blocked rather than guessing.",
	].join("\n");
}

function deterministicLabel(): string {
	return "deterministic (no LLM key)";
}

function buildDeterministicArtifact(input: PipelineInput, verification: string): PipelineOutput {
	const modeLabel = deterministicLabel();
	const artifact = [
		headerLines(input, modeLabel, undefined, verification),
		deterministicSections(input, verification),
	].join("\n");
	return {
		mode: "deterministic",
		modeLabel,
		model: undefined,
		provider: undefined,
		roles: [],
		steps: [],
		verification,
		artifact,
	};
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
	const requested = input.mode ?? "auto";
	const resolved: ResolvedModel | undefined =
		requested === "deterministic" ? undefined : resolveModel(input.model);
	const useLlm = requested === "deterministic" ? false : Boolean(resolved);
	const verification = verificationLabel(input.failures, input.results);

	if (!useLlm) {
		const output = buildDeterministicArtifact(input, verification);
		if (requested === "llm" && !resolved) {
			output.modeLabel = `${deterministicLabel()}; llm mode was requested but no API key is configured`;
		}
		return output;
	}

	const model = resolved as ResolvedModel;
	const roles: string[] = input.roles?.length ? input.roles : [...roleIdList()];
	const steps: StepResult[] = [];
	const policy = loadPolicy();

	for (const role of roles) {
		try {
			const messages: ChatMessage[] = [
				{ role: "system", content: policy },
				{ role: "user", content: rolePrompt(input, role, steps) },
			];
			const text = await chatComplete(model, messages, { temperature: role === "writer" ? 0.3 : 0.2 });
			steps.push({ role, status: "ok", text });
		} catch (error) {
			steps.push({ role, status: "error", error: error instanceof Error ? error.message : String(error) });
		}
	}

	const writerStep = [...steps].reverse().find(
		(step): step is StepResult & { text: string } => step.status === "ok" && Boolean(step.text),
	);
	let artifact: string;
	if (writerStep && writerStep.role === "writer") {
		artifact = [
			headerLines(input, "llm", `${model.provider}/${model.model}`, verification),
			writerStep.text.trim(),
			"",
			"---",
			"",
			"## Evidence (retrieved in this run)",
			"",
			evidenceDigest(input.results),
			"",
			sourcesSection(input.results),
		].join("\n");
	} else {
		// The writing step failed: fall back to deterministic synthesis and say so.
		const fallback = buildDeterministicArtifact(input, verification);
		const stepErrors = steps.filter((step) => step.status === "error");
		artifact = [
			headerLines(
				input,
				`${deterministicLabel()}; llm steps failed (${stepErrors.map((step) => step.role).join(", ") || "none completed"})`,
				`${model.provider}/${model.model}`,
				verification,
			),
			deterministicSections(input, verification),
		].join("\n");
		steps.push({ role: "writer", status: "fallback", error: "no successful writer step; artifact synthesized deterministically" });
	}

	return {
		mode: "llm",
		modeLabel: "llm",
		model: `${model.provider}/${model.model}`,
		provider: model.provider,
		roles,
		steps,
		verification,
		artifact,
	};
}
