// PubMed connector — two NCBI eutils calls: esearch for PMIDs, esummary for
// metadata. https://www.ncbi.nlm.nih.gov/books/NBK25499/
import { requestJson } from "./http.ts";
import { cleanQuery, safeLimit, type SearchParams, type SourceConnector, type SourceResult } from "./types.ts";
import {
	arrayValue,
	firstString,
	normalizeDoi,
	normalizeSort,
	recordValue,
	stringValue,
	yearFromDate,
} from "./util.ts";

export const NCBI_EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
export const NCBI_EUTILS_DOCS = "https://www.ncbi.nlm.nih.gov/books/NBK25499/";

function identityParams(): Record<string, string> {
	const email = process.env.NCBI_EMAIL?.trim() || process.env.CROSSREF_MAILTO?.trim();
	const key = process.env.NCBI_API_KEY?.trim();
	return { ...(email ? { email } : {}), ...(key ? { api_key: key } : {}) };
}

export function buildEsearchUrl(params: SearchParams): URL {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const sort = normalizeSort(params.sort);
	const url = new URL(`${NCBI_EUTILS_BASE}/esearch.fcgi`);
	url.search = new URLSearchParams({
		db: "pubmed",
		retmode: "json",
		retmax: String(limit),
		sort: sort === "pub_date" ? "pub date" : "relevance",
		term: query,
		...identityParams(),
	}).toString();
	return url;
}

function articleDoi(doc: Record<string, unknown>): string | undefined {
	for (const item of arrayValue(doc.articleids)) {
		const record = recordValue(item);
		if (stringValue(record.idtype)?.toLowerCase() === "doi") return normalizeDoi(record.value);
	}
	return undefined;
}

export async function searchPubMed(params: SearchParams): Promise<SourceResult[]> {
	const esearchUrl = buildEsearchUrl(params);
	const esearchEndpoint = esearchUrl.toString();
	const search = recordValue(await requestJson(esearchUrl));
	const esearch = recordValue(search.esearchresult);
	const ids = arrayValue(esearch.idlist)
		.map((id) => stringValue(id))
		.filter((id): id is string => Boolean(id));
	if (!ids.length) return [];

	const summaryUrl = new URL(`${NCBI_EUTILS_BASE}/esummary.fcgi`);
	summaryUrl.search = new URLSearchParams({
		db: "pubmed",
		id: ids.join(","),
		retmode: "json",
		...identityParams(),
	}).toString();
	const summaryEndpoint = summaryUrl.toString();
	const summary = recordValue(await requestJson(summaryUrl));
	const docs = recordValue(summary.result);

	const results: SourceResult[] = [];
	for (const id of ids) {
		const doc = recordValue(docs[id]);
		if (!Object.keys(doc).length) continue;
		const doi = articleDoi(doc);
		const publicationDate = stringValue(doc.pubdate) ?? stringValue(doc.epubdate);
		results.push({
			id,
			title: firstString(doc.title) ?? "",
			year: yearFromDate(publicationDate),
			authors: arrayValue(doc.authors)
				.map((author) => stringValue(recordValue(author).name))
				.filter((name): name is string => Boolean(name))
				.slice(0, 8),
			venue: stringValue(doc.fulljournalname) ?? stringValue(doc.source),
			url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
			source: "pubmed",
			doi,
			endpoint: `${esearchEndpoint} , ${summaryEndpoint}`,
		});
	}
	return results.slice(0, safeLimit(params.limit));
}

export const pubMedConnector: SourceConnector = {
	id: "pubmed",
	docs: NCBI_EUTILS_DOCS,
	endpoints: [`${NCBI_EUTILS_BASE}/esearch.fcgi`, `${NCBI_EUTILS_BASE}/esummary.fcgi`],
	search: searchPubMed,
	describe: (params) => [buildEsearchUrl(params).toString()],
};
