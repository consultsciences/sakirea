// Semantic Scholar connector — https://api.semanticscholar.org/graph/v1/paper/search
// Key-free on the shared anonymous pool (rate-limited; SEMANTIC_SCHOLAR_API_KEY
// is optional). sort=relevance uses the plain search endpoint; sort=pub_date
// uses the bulk endpoint with a publicationDate:desc sort.
import { HttpError, requestJson } from "./http.ts";
import { cleanQuery, safeLimit, type SearchParams, type SourceConnector, type SourceResult } from "./types.ts";
import { arrayValue, normalizeDoi, normalizeSort, numberValue, recordValue, stringValue, truncate } from "./util.ts";

export const SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1";
export const SEMANTIC_SCHOLAR_DOCS = "https://api.semanticscholar.org/api-docs/graph";
const FIELDS = "title,year,authors,venue,citationCount,externalIds,abstract,url";
const ABSTRACT_CHARS = 600;

function buildSemanticScholarUrl(query: string, limit: number, sort: "relevance" | "pub_date" | undefined): URL {
	const byDate = sort === "pub_date";
	const url = new URL(`${SEMANTIC_SCHOLAR_BASE}/paper/search${byDate ? "/bulk" : ""}`);
	url.search = new URLSearchParams({
		query,
		fields: FIELDS,
		...(byDate ? { sort: "publicationDate:desc" } : { limit: String(limit) }),
	}).toString();
	return url;
}

export function normalizeSemanticScholarItem(item: Record<string, unknown>, endpoint: string): SourceResult | undefined {
	const paperId = stringValue(item.paperId) ?? stringValue(item.corpusId);
	if (!paperId) return undefined;
	const externalIds = recordValue(item.externalIds);
	const doi = normalizeDoi(externalIds.DOI);
	return {
		id: paperId,
		title: stringValue(item.title) ?? "",
		year: numberValue(item.year),
		authors: arrayValue(item.authors)
			.map((author) => stringValue(recordValue(author).name))
			.filter((name): name is string => Boolean(name))
			.slice(0, 8),
		venue: stringValue(item.venue) || undefined,
		url: stringValue(item.url) ?? `https://www.semanticscholar.org/paper/${paperId}`,
		abstract: truncate(stringValue(item.abstract), ABSTRACT_CHARS),
		citations: numberValue(item.citationCount),
		source: "semanticscholar",
		doi,
		endpoint,
	};
}

export async function searchSemanticScholar(params: SearchParams): Promise<SourceResult[]> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const sort = normalizeSort(params.sort);
	const url = buildSemanticScholarUrl(query, limit, sort);
	const endpoint = url.toString();
	let payload: unknown;
	try {
		payload = await requestJson(url);
	} catch (error) {
		if (error instanceof HttpError && error.status === 429) {
			throw new Error(
				"Semantic Scholar's shared anonymous pool is rate-limited (HTTP 429) after one retry. Wait and retry, or search with source openalex.",
			);
		}
		throw error;
	}
	const data = recordValue(payload).data;
	const rows = (Array.isArray(data) ? data : [])
		.map((item) => normalizeSemanticScholarItem(recordValue(item), endpoint))
		.filter((item): item is SourceResult => item !== undefined);
	return rows.slice(0, limit);
}

export const semanticScholarConnector: SourceConnector = {
	id: "semanticscholar",
	docs: SEMANTIC_SCHOLAR_DOCS,
	endpoints: [`${SEMANTIC_SCHOLAR_BASE}/paper/search`],
	search: searchSemanticScholar,
	describe: (params) => [
		buildSemanticScholarUrl(cleanQuery(params.query), safeLimit(params.limit), normalizeSort(params.sort)).toString(),
	],
};
