// Provenance sidecars: one human-readable `<slug>.provenance.md` and one
// machine-readable `<slug>.provenance.json` next to every final artifact.
// Mirrors upstream Feynman's {docs, endpoints} provenance metadata concept.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION, TOOL_NAME } from "../version.ts";
import type { SourceFailure } from "../agents/orchestrator.ts";
import type { SourceResult } from "../sources/types.ts";

export type SourceStatus = "verified" | "unverified" | "blocked";

export interface ProvenanceEntry {
	title: string;
	source: string;
	url: string;
	doi: string | undefined;
	queriedAt: string;
	status: SourceStatus;
}

export interface ProvenanceData {
	schema: "sakirea.provenance.v1";
	slug: string;
	topic: string;
	workflow: string;
	workflowName: string;
	artifact: string;
	generatedAt: string;
	mode: string;
	model: string | undefined;
	tool: string;
	sakireaVersion: string;
	verification: string;
	sourcesConsulted: string[];
	sourcesAccepted: number;
	sourcesBlocked: number;
	entries: ProvenanceEntry[];
	docs: string[];
	endpoints: string[];
}

function normalizeTitle(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A record is `verified` only when two independent databases returned it (the
 * metadata cross-checked); `unverified` when a single database returned it;
 * `blocked` when a source failed and produced nothing.
 */
export function buildEntries(results: SourceResult[], failures: SourceFailure[], queriedAt: string): ProvenanceEntry[] {
	const groups = new Map<string, Set<string>>();
	for (const result of results) {
		const key = result.doi ? `doi:${result.doi.toLowerCase()}` : `title:${normalizeTitle(result.title)}`;
		const sources = groups.get(key) ?? new Set<string>();
		sources.add(result.source);
		groups.set(key, sources);
	}
	const entries: ProvenanceEntry[] = results.map((result) => {
		const key = result.doi ? `doi:${result.doi.toLowerCase()}` : `title:${normalizeTitle(result.title)}`;
		const status: SourceStatus = (groups.get(key)?.size ?? 0) > 1 ? "verified" : "unverified";
		return {
			title: result.title || "(untitled record)",
			source: result.source,
			url: result.doi ? (result.url ?? `https://doi.org/${result.doi}`) : (result.url ?? "—"),
			doi: result.doi,
			queriedAt: queriedAt,
			status,
		};
	});
	for (const failure of failures) {
		entries.push({
			title: "— retrieval failed —",
			source: failure.source,
			url: "—",
			doi: undefined,
			queriedAt: queriedAt,
			status: "blocked",
		});
	}
	return entries;
}

export function buildProvenance(input: {
	slug: string;
	topic: string;
	workflow: string;
	workflowName: string;
	artifact: string;
	mode: string;
	model: string | undefined;
	verification: string;
	results: SourceResult[];
	failures: SourceFailure[];
	/** Every source the run queried, in query order (includes zero-result sources). */
	queried: string[];
	docs: string[];
	endpoints: string[];
	queriedAt: string;
}): ProvenanceData {
	return {
		schema: "sakirea.provenance.v1",
		slug: input.slug,
		topic: input.topic,
		workflow: input.workflow,
		workflowName: input.workflowName,
		artifact: input.artifact,
		generatedAt: new Date().toISOString(),
		mode: input.mode,
		model: input.model,
		tool: TOOL_NAME,
		sakireaVersion: VERSION,
		verification: input.verification,
		sourcesConsulted: [
			...new Set([
				...input.queried,
				...input.results.map((result) => result.source),
				...input.failures.map((failure) => failure.source),
			]),
		],
		sourcesAccepted: input.results.length,
		sourcesBlocked: input.failures.length,
		entries: buildEntries(input.results, input.failures, input.queriedAt),
		docs: [...new Set(input.docs)],
		endpoints: [...new Set(input.endpoints)],
	};
}

export function renderProvenanceMarkdown(data: ProvenanceData): string {
	const rows = data.entries.map((entry) => {
		const title = entry.title.replace(/\|/g, "\\|");
		return `| ${title} | ${entry.source} | ${entry.url} | ${entry.queriedAt} | ${entry.status} |`;
	});
	const statusLegend = [
		"- `verified` — the record was returned by two independent databases (metadata cross-checked).",
		"- `unverified` — the record was returned by one database; metadata not cross-checked.",
		"- `blocked` — the source failed during retrieval; nothing was accepted from it.",
	].join("\n");
	return [
		`# Provenance: ${data.topic}`,
		"",
		`- **Slug:** ${data.slug}`,
		`- **Artifact:** ${data.artifact}`,
		`- **Workflow:** ${data.workflow} — ${data.workflowName}`,
		`- **Mode:** ${data.mode}${data.model ? ` (${data.model})` : ""}`,
		`- **Generated:** ${data.generatedAt}`,
		`- **Tool:** ${data.tool} (sakirea v${data.sakireaVersion})`,
		`- **Verification:** ${data.verification}`,
		`- **Sources consulted:** ${data.sourcesConsulted.length ? data.sourcesConsulted.join(", ") : "none"}`,
		`- **Sources accepted:** ${data.sourcesAccepted}`,
		`- **Sources blocked:** ${data.sourcesBlocked}`,
		"",
		"## Sources",
		"",
		"| Title | Source DB | URL / DOI | Queried at | Status |",
		"|-------|-----------|-----------|------------|--------|",
		...(rows.length ? rows : ["| — | — | — | — | no records retrieved |"]),
		"",
		"## Status legend",
		"",
		statusLegend,
		"",
		"## Endpoints",
		"",
		"### Documentation",
		"",
		...(data.docs.length ? data.docs.map((doc) => `- ${doc}`) : ["- none"]),
		"",
		"### API endpoints used",
		"",
		...(data.endpoints.length ? data.endpoints.map((endpoint) => `- ${endpoint}`) : ["- none"]),
		"",
	].join("\n");
}

export function writeProvenance(
	directory: string,
	slug: string,
	data: ProvenanceData,
): { mdPath: string; jsonPath: string } {
	mkdirSync(directory, { recursive: true });
	const mdPath = join(directory, `${slug}.provenance.md`);
	const jsonPath = join(directory, `${slug}.provenance.json`);
	writeFileSync(mdPath, renderProvenanceMarkdown(data), "utf8");
	writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	return { mdPath, jsonPath };
}
