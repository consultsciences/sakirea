// arXiv connector — Atom feed over https://export.arxiv.org/api/query.
// The API is lexical and ranks concept queries poorly, so a query that is a
// list of arXiv IDs is resolved with id_list= (exact lookup) while ordinary
// text queries use search_query=all:"…" (plain lexical topic search).
import { requestText } from "./http.ts";
import { cleanQuery, safeLimit, type SearchParams, type SourceConnector, type SourceResult } from "./types.ts";
import { normalizeSort, yearFromDate } from "./util.ts";
import { parseAtomFeed } from "./xml.ts";

export const ARXIV_QUERY_URL = "https://export.arxiv.org/api/query";
export const ARXIV_DOCS = "https://info.arxiv.org/help/api/user-manual.html";
export const ARXIV_MIN_GAP_MS = 3000;

const ACCEPT = "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8";
const ARXIV_ID_PATTERN = /^(\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[A-Za-z-]+)?\/\d{7})(v\d+)?$/;

function queryTokens(query: string): string[] {
	return query.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
}

export function isArxivIdQuery(query: string): boolean {
	const tokens = queryTokens(query);
	return tokens.length > 0 && tokens.every((token) => ARXIV_ID_PATTERN.test(token));
}

function stripVersion(id: string): string {
	return id.replace(/v\d+$/, "");
}

export function buildArxivUrl(params: SearchParams): URL {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(ARXIV_QUERY_URL);
	if (isArxivIdQuery(query)) {
		const ids = queryTokens(query).map(stripVersion);
		url.search = new URLSearchParams({ id_list: ids.join(","), max_results: String(ids.length) }).toString();
		return url;
	}
	url.search = new URLSearchParams({
		search_query: `all:"${query.replace(/"/g, "'")}"`,
		start: "0",
		max_results: String(limit),
		...(normalizeSort(params.sort) === "pub_date"
			? { sortBy: "submittedDate", sortOrder: "descending" }
			: {}),
	}).toString();
	return url;
}

export async function searchArxiv(params: SearchParams): Promise<SourceResult[]> {
	const query = cleanQuery(params.query);
	const url = buildArxivUrl(params);
	const xml = await requestText(url, { accept: ACCEPT });
	const entries = parseAtomFeed(xml);
	const errorEntry = entries.find((entry) => entry.absUrl.includes("/api/errors"));
	if (errorEntry) {
		throw new Error(`arXiv API error: ${errorEntry.summary || errorEntry.title || "unknown error"}`);
	}
	const endpoint = url.toString();
	// An explicit ID list is the request: every ID the caller named is returned.
	// Plain topic searches obey the clamped limit.
	const limit = isArxivIdQuery(query) ? queryTokens(query).length : safeLimit(params.limit);
	const results: SourceResult[] = [];
	for (const entry of entries) {
		const versioned = entry.id.split("/abs/").pop() ?? entry.id;
		const id = stripVersion(versioned);
		if (!id) continue;
		results.push({
			id,
			title: entry.title,
			year: yearFromDate(entry.published),
			authors: entry.authors.slice(0, 8),
			venue: entry.journalRef ?? "arXiv",
			url: entry.absUrl,
			abstract: entry.summary || undefined,
			source: "arxiv",
			doi: entry.doi,
			endpoint,
		});
	}
	return results.slice(0, limit);
}

export const arxivConnector: SourceConnector = {
	id: "arxiv",
	docs: ARXIV_DOCS,
	endpoints: [ARXIV_QUERY_URL],
	search: searchArxiv,
	describe: (params) => [buildArxivUrl(params).toString()],
};
