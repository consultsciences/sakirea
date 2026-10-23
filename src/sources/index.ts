// The sources engine: one unified, key-free search tool over eight scholarly
// databases, plus the connector registry the CLI and HTTP API expose.
import { VERSION, SCHEMA, TOOL_NAME } from "../version.ts";
import { arxivConnector } from "./arxiv.ts";
import { crossrefConnector } from "./crossref.ts";
import { europePmcConnector } from "./europepmc.ts";
import { isTimeout, REQUEST_TIMEOUT_MS } from "./http.ts";
import { openAlexConnector } from "./openalex.ts";
import { preprintConnector } from "./preprints.ts";
import { pubMedConnector } from "./pubmed.ts";
import { semanticScholarConnector } from "./semanticscholar.ts";
import {
	cleanQuery,
	safeLimit,
	type SearchParams,
	type SourceConnector,
	type SourceResult,
} from "./types.ts";
import { normalizeSort } from "./util.ts";

export type { SearchParams, SourceConnector, SourceResult, SourceId } from "./types.ts";
export { setFetch, resetFetch, HttpError, requestJson, requestText } from "./http.ts";
export { resetPacers, createRequestPacer } from "./pacer.ts";

const connectors: SourceConnector[] = [
	arxivConnector,
	openAlexConnector,
	pubMedConnector,
	europePmcConnector,
	preprintConnector("biorxiv"),
	preprintConnector("medrxiv"),
	crossrefConnector,
	semanticScholarConnector,
];

export function listConnectors(): SourceConnector[] {
	return [...connectors];
}

export function getConnector(id: string): SourceConnector {
	const connector = connectors.find((candidate) => candidate.id === id);
	if (!connector) {
		throw new Error(`Unknown source "${id}". Valid sources: ${connectors.map((c) => c.id).join(", ")}.`);
	}
	return connector;
}

export interface SearchProvenance {
	docs: string;
	endpoints: string[];
	queriedAt: string;
}

export interface SearchEnvelope {
	schema: string;
	source: string;
	query: string;
	limit: number;
	sort: string | undefined;
	returned: number;
	results: SourceResult[];
	provenance: SearchProvenance;
}

function mergeEndpoints(connector: SourceConnector, params: SearchParams, results: SourceResult[]): string[] {
	const endpoints = new Set<string>();
	for (const endpoint of connector.describe?.(params) ?? connector.endpoints) endpoints.add(endpoint);
	for (const result of results) if (result.endpoint) endpoints.add(result.endpoint);
	if (!endpoints.size) for (const endpoint of connector.endpoints) endpoints.add(endpoint);
	return [...endpoints];
}

/** The unified `sakirea_science_database_search` tool implementation. */
export async function scienceDatabaseSearch(params: SearchParams): Promise<SearchEnvelope> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const sort = normalizeSort(params.sort);
	const connector = getConnector(String(params.source ?? "").trim());
	const normalized: SearchParams = { query, limit, sort, source: connector.id };

	let results: SourceResult[];
	try {
		results = await connector.search(normalized);
	} catch (error) {
		if (isTimeout(error)) {
			throw new Error(`${connector.id} did not respond within ${REQUEST_TIMEOUT_MS / 1000} s. Retry, or search another source.`);
		}
		throw error;
	}

	return {
		schema: SCHEMA,
		source: connector.id,
		query,
		limit,
		sort,
		returned: results.length,
		results,
		provenance: {
			docs: connector.docs,
			endpoints: mergeEndpoints(connector, normalized, results),
			queriedAt: new Date().toISOString(),
		},
	};
}

export const SCIENCE_DATABASE_TOOL = {
	name: TOOL_NAME,
	label: "Science Database Search",
	description:
		"Search eight key-free scholarly databases (arXiv, OpenAlex, PubMed, Europe PMC, bioRxiv, medRxiv, Crossref, Semantic Scholar) and return normalized records with the exact endpoints used.",
	summary:
		"Search scholarly literature across arXiv, OpenAlex, PubMed, Europe PMC, bioRxiv, medRxiv, Crossref, and Semantic Scholar for source-backed evidence.",
	sources: connectors.map((connector) => ({
		id: connector.id,
		docs: connector.docs,
		endpoints: connector.endpoints,
	})),
	version: VERSION,
} as const;
