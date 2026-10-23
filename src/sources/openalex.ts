// OpenAlex connector — https://api.openalex.org/works. Works without a key
// (the anonymous budget is smaller; OPENALEX_API_KEY is optional and is
// redacted from every endpoint string Sakirea records or returns).
import { requestJson } from "./http.ts";
import { VERSION } from "../version.ts";
import { cleanQuery, safeLimit, type SearchParams, type SourceConnector, type SourceResult } from "./types.ts";
import {
	arrayValue,
	firstString,
	normalizeDoi,
	normalizeSort,
	numberValue,
	recordValue,
	stringValue,
	yearFromDate,
	yearFromDateParts,
} from "./util.ts";

export const OPENALEX_BASE = "https://api.openalex.org";
export const OPENALEX_DOCS = "https://developers.openalex.org/api-reference/works";

function apiKey(): string | undefined {
	return process.env.OPENALEX_API_KEY?.trim() || undefined;
}

export function scrubEndpoint(url: URL): string {
	const clean = new URL(url.toString());
	if (clean.searchParams.has("api_key")) clean.searchParams.set("api_key", "[redacted]");
	return clean.toString();
}

export function buildOpenAlexUrl(params: SearchParams): URL {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${OPENALEX_BASE}/works`);
	url.searchParams.set("search", query);
	url.searchParams.set("per-page", String(limit));
	const sort = normalizeSort(params.sort);
	url.searchParams.set("sort", sort === "pub_date" ? "publication_date:desc" : "relevance_score:desc");
	const key = apiKey();
	if (key) url.searchParams.set("api_key", key);
	const mailto = process.env.CROSSREF_MAILTO?.trim();
	if (mailto && !key) url.searchParams.set("mailto", mailto);
	return url;
}

function shortId(value: unknown): string | undefined {
	const raw = stringValue(value);
	return raw ? raw.split("/").pop() || raw : undefined;
}

function reconstructAbstract(index: unknown): string | undefined {
	const inverted = recordValue(index);
	const positions: Array<{ position: number; word: string }> = [];
	for (const [word, rawPositions] of Object.entries(inverted)) {
		for (const position of arrayValue(rawPositions)) {
			const numeric = numberValue(position);
			if (numeric !== undefined) positions.push({ position: numeric, word });
		}
	}
	if (!positions.length) return undefined;
	return positions
		.sort((a, b) => a.position - b.position)
		.map((item) => item.word)
		.join(" ");
}

export function normalizeOpenAlexWork(work: Record<string, unknown>, endpoint: string): SourceResult {
	const id = shortId(work.id);
	const primary = recordValue(work.primary_location);
	const source = recordValue(primary.source);
	const doi = normalizeDoi(work.doi ?? recordValue(work.ids).doi);
	const authors = arrayValue(work.authorships)
		.map((authorship) => stringValue(recordValue(recordValue(authorship).author).display_name))
		.filter((name): name is string => Boolean(name))
		.slice(0, 8);
	return {
		id: id ?? stringValue(work.id) ?? "",
		title: stringValue(work.title) ?? stringValue(work.display_name) ?? "",
		year: numberValue(work.publication_year) ?? yearFromDate(stringValue(work.publication_date)),
		authors,
		venue: stringValue(source.display_name) ?? undefined,
		url: id ? `https://openalex.org/${id}` : stringValue(work.id),
		abstract: reconstructAbstract(work.abstract_inverted_index),
		citations: numberValue(work.cited_by_count),
		source: "openalex",
		doi,
		endpoint,
	};
}

export async function searchOpenAlex(params: SearchParams): Promise<SourceResult[]> {
	const url = buildOpenAlexUrl(params);
	const endpoint = scrubEndpoint(url);
	const payload = recordValue(await requestJson(url, {
		headers: { "user-agent": `sakirea/${VERSION} (https://github.com/consultsciences/sakirea)` },
	}));
	const results = arrayValue(payload.results).map((item) =>
		normalizeOpenAlexWork(recordValue(item), endpoint),
	);
	return results.slice(0, safeLimit(params.limit));
}

export const openAlexConnector: SourceConnector = {
	id: "openalex",
	docs: OPENALEX_DOCS,
	endpoints: [`${OPENALEX_BASE}/works`],
	search: searchOpenAlex,
	describe: (params) => [scrubEndpoint(buildOpenAlexUrl(params))],
};
