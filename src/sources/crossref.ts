// Crossref connector — DOI metadata over https://api.crossref.org/works.
// The public pool allows one request at a time (x-concurrency-limit: 1); the
// pacer in http.ts keeps Sakirea inside that budget, and CROSSREF_MAILTO moves
// the request into Crossref's polite pool.
import { HttpError, requestJson } from "./http.ts";
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
	yearFromDateParts,
} from "./util.ts";

export const CROSSREF_BASE = "https://api.crossref.org";
export const CROSSREF_DOCS = "https://www.crossref.org/documentation/retrieve-metadata/rest-api/";
const SELECT =
	"DOI,title,published-print,published-online,issued,container-title,author,is-referenced-by-count,URL,type,abstract";

function stripJats(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
	return text || undefined;
}

export function buildCrossrefUrl(params: SearchParams): URL {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const mailto = process.env.CROSSREF_MAILTO?.trim() || process.env.NCBI_EMAIL?.trim();
	const url = new URL(`${CROSSREF_BASE}/works`);
	url.search = new URLSearchParams({
		query,
		rows: String(limit),
		select: SELECT,
		...(mailto ? { mailto } : {}),
	}).toString();
	return url;
}

function crossrefAuthors(value: unknown): string[] {
	return arrayValue(value)
		.map((author) => {
			const record = recordValue(author);
			return (
				[stringValue(record.given), stringValue(record.family)].filter(Boolean).join(" ") ||
				stringValue(record.name) ||
				""
			);
		})
		.filter(Boolean)
		.slice(0, 8);
}

export function normalizeCrossrefItem(item: Record<string, unknown>, endpoint: string): SourceResult {
	const doi = normalizeDoi(item.DOI);
	return {
		id: doi ?? stringValue(item.URL) ?? "",
		title: firstString(item.title) ?? "",
		year: yearFromDateParts(item["published-print"]) ?? yearFromDateParts(item["published-online"]) ?? yearFromDateParts(item.issued),
		authors: crossrefAuthors(item.author),
		venue: firstString(item["container-title"]),
		url: stringValue(item.URL) ?? (doi ? `https://doi.org/${doi}` : undefined),
		abstract: stripJats(stringValue(item.abstract)),
		citations: numberValue(item["is-referenced-by-count"]),
		source: "crossref",
		doi,
		endpoint,
	};
}

export async function searchCrossref(params: SearchParams): Promise<SourceResult[]> {
	const url = buildCrossrefUrl(params);
	const endpoint = url.toString();
	let payload: unknown;
	try {
		payload = await requestJson(url, {
			headers: {
				accept: "application/json",
				"user-agent": `sakirea/${VERSION} (https://github.com/consultsciences/sakirea)`,
			},
		});
	} catch (error) {
		if (error instanceof HttpError && error.status === 429) {
			const mailto = process.env.CROSSREF_MAILTO?.trim();
			throw new Error(
				mailto
					? "Crossref rate-limited this request (HTTP 429). Wait a few seconds and retry, or look the DOI up with source openalex."
					: "Crossref's public pool rate-limited this request (HTTP 429). Set CROSSREF_MAILTO for the faster polite pool, wait and retry, or look the DOI up with source openalex.",
			);
		}
		throw error;
	}
	const message = recordValue(recordValue(payload).message);
	const items = arrayValue(message.items);
	return items
		.map((item) => normalizeCrossrefItem(recordValue(item), endpoint))
		.slice(0, safeLimit(params.limit));
}

export const crossrefConnector: SourceConnector = {
	id: "crossref",
	docs: CROSSREF_DOCS,
	endpoints: [`${CROSSREF_BASE}/works`],
	search: searchCrossref,
	describe: (params) => [buildCrossrefUrl(params).toString()],
};
