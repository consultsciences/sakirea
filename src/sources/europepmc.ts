// Europe PMC connector — metadata search over https://www.ebi.ac.uk/europepmc/webservices/rest/search
import { requestJson } from "./http.ts";
import { cleanQuery, safeLimit, type SearchParams, type SourceConnector, type SourceResult } from "./types.ts";
import { normalizeDoi, numberValue, recordValue, stringValue, yearFromDate } from "./util.ts";

export const EUROPE_PMC_SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
export const EUROPE_PMC_DOCS = "https://europepmc.org/RestfulWebService";

export function buildEuropePmcUrl(query: string, limit: number, extra: Record<string, string> = {}): URL {
	const url = new URL(EUROPE_PMC_SEARCH_URL);
	url.search = new URLSearchParams({
		query,
		resultType: "lite",
		cursorMark: "*",
		pageSize: String(limit),
		format: "json",
		...extra,
	}).toString();
	return url;
}

export function normalizeEuropePmcResult(item: Record<string, unknown>, endpoint: string): SourceResult | undefined {
	const id = stringValue(item.id);
	const source = stringValue(item.source);
	if (!id || !source) return undefined;
	return {
		id,
		title: stringValue(item.title) ?? "",
		year: numberValue(item.pubYear) ?? yearFromDate(stringValue(item.firstPublicationDate)),
		authors: stringValue(item.authorString)
			? String(item.authorString).split(",").map((name) => name.trim()).filter(Boolean).slice(0, 8)
			: [],
		venue: stringValue(item.journalTitle),
		url: `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
		abstract: stringValue(item.abstractText) ?? stringValue(item.description),
		citations: numberValue(item.citedByCount),
		source: "europepmc",
		doi: normalizeDoi(item.doi),
		endpoint,
	};
}

export async function searchEuropePmc(params: SearchParams): Promise<SourceResult[]> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = buildEuropePmcUrl(query, limit);
	const endpoint = url.toString();
	const payload = recordValue(await requestJson(url));
	const items = recordValue(payload.resultList).result;
	const results = (Array.isArray(items) ? items : [])
		.map((item) => normalizeEuropePmcResult(recordValue(item), endpoint))
		.filter((item): item is SourceResult => item !== undefined);
	return results.slice(0, limit);
}

export const europePmcConnector: SourceConnector = {
	id: "europepmc",
	docs: EUROPE_PMC_DOCS,
	endpoints: [EUROPE_PMC_SEARCH_URL],
	search: searchEuropePmc,
	describe: (params) => [buildEuropePmcUrl(cleanQuery(params.query), safeLimit(params.limit)).toString()],
};
