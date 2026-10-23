// Shared shapes for the sources engine.
export type SourceId =
	| "arxiv"
	| "openalex"
	| "pubmed"
	| "europepmc"
	| "biorxiv"
	| "medrxiv"
	| "crossref"
	| "semanticscholar";

export const SOURCE_IDS: readonly SourceId[] = [
	"arxiv",
	"openalex",
	"pubmed",
	"europepmc",
	"biorxiv",
	"medrxiv",
	"crossref",
	"semanticscholar",
] as const;

export interface SearchParams {
	query: string;
	limit?: number;
	sort?: string;
	source?: string;
}

/** One normalized literature record. Optional fields are `undefined` when the
 * source genuinely does not report them — never invented. */
export interface SourceResult {
	id: string;
	title: string;
	year: number | undefined;
	authors: string[];
	venue: string | undefined;
	url: string | undefined;
	abstract?: string;
	citations?: number;
	source: string;
	doi?: string;
	/** Exact endpoint that produced this record (provenance). */
	endpoint?: string;
}

export interface SourceConnector {
	id: string;
	/** Documentation URL for the API this connector speaks to. */
	docs: string;
	/** Documented endpoint templates for this connector. */
	endpoints: string[];
	search(params: SearchParams): Promise<SourceResult[]>;
	/** Exact endpoints a query will hit, known before the request runs. */
	describe?(params: SearchParams): string[];
}

export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 20;

export function safeLimit(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

export function cleanQuery(query: string): string {
	const clean = String(query ?? "").trim();
	if (!clean) throw new Error("Search requires a non-empty query.");
	return clean;
}
