// bioRxiv + medRxiv connector.
//
// The bioRxiv details API (https://api.biorxiv.org/details/...) only answers
// DOI lookups and date windows — it has no full-text search. So:
//   * a DOI query            -> api.biorxiv.org/details/<server>/<doi>/na/json
//   * explicit date_from/to  -> api.biorxiv.org/details window + local token filter
//   * a plain topic query    -> Europe PMC's preprint index
//     (SRC:PPR AND PUBLISHER:"bioRxiv"|"medRxiv"), because it is the only
//     key-free index that text-searches these servers.
// Provenance always records the endpoint that actually answered.
import { requestJson } from "./http.ts";
import { buildEuropePmcUrl, normalizeEuropePmcResult } from "./europepmc.ts";
import { cleanQuery, safeLimit, type SearchParams, type SourceConnector, type SourceResult } from "./types.ts";
import { arrayValue, recordValue, stringValue, yearFromDate } from "./util.ts";

const PREPRINT_API_BASE = "https://api.biorxiv.org";
const DEFAULT_WINDOW_DAYS = 60;
const DETAILS_MAX_RECORDS = 100;

export type PreprintServer = "biorxiv" | "medrxiv";

const SERVER_LABEL: Record<PreprintServer, string> = { biorxiv: "bioRxiv", medrxiv: "medRxiv" };

function isPreprintServer(value: string | undefined): value is PreprintServer {
	return value === "biorxiv" || value === "medrxiv";
}

function preprintHost(server: PreprintServer): string {
	return `www.${server}.org`;
}

export function normalizePreprintDoi(query: string): string | undefined {
	const clean = query.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
	return /^10\.\d{4,9}\/\S+$/i.test(clean) ? clean : undefined;
}

function optionValue(query: string, key: string): string | undefined {
	const pattern = new RegExp(`(?:^|[\\s;])${key}=("[^"]+"|'[^']+'|[^\\s;]+)`, "i");
	const match = pattern.exec(query);
	const raw = match?.[1]?.trim();
	return raw ? raw.replace(/^["']|["']$/g, "") : undefined;
}

function isDate(value: string | undefined): value is string {
	return value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export interface PreprintWindow {
	dateFrom?: string;
	dateTo?: string;
	text: string;
}

/** Strip date options out of the query and resolve the date window, if any. */
export function parsePreprintQuery(query: string, now = new Date()): PreprintWindow {
	const explicitFrom = optionValue(query, "date_from") ?? optionValue(query, "from");
	const explicitTo = optionValue(query, "date_to") ?? optionValue(query, "to");
	let dateFrom = isDate(explicitFrom) ? explicitFrom : undefined;
	let dateTo = isDate(explicitTo) ? explicitTo : undefined;
	const text = query
		.replace(/\b(?:date_from|date_to|from|to|category|cursor)=("[^"]+"|'[^']+'|[^\s;]+)/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!dateFrom && !dateTo) return { text };
	if (!dateTo) dateTo = now.toISOString().slice(0, 10);
	if (!dateFrom) {
		const start = new Date(now);
		start.setUTCDate(start.getUTCDate() - DEFAULT_WINDOW_DAYS);
		dateFrom = start.toISOString().slice(0, 10);
	}
	return { dateFrom, dateTo, text };
}

export function buildDetailsUrl(server: PreprintServer, doi: string): URL {
	return new URL(`${PREPRINT_API_BASE}/details/${server}/${doi}/na/json`);
}

export function buildWindowUrl(server: PreprintServer, dateFrom: string, dateTo: string, cursor = 0): URL {
	return new URL(`${PREPRINT_API_BASE}/details/${server}/${dateFrom}/${dateTo}/${cursor}/json`);
}

export function buildPreprintIndexUrl(server: PreprintServer, query: string, limit: number): URL {
	return buildEuropePmcUrl(`SRC:PPR AND PUBLISHER:"${SERVER_LABEL[server]}" AND ${query}`, limit, {
		resultType: "core",
	});
}

function matchesTokens(text: string, haystack: string): boolean {
	const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
	if (!tokens.length) return true;
	const target = haystack.toLowerCase();
	return tokens.every((token) => target.includes(token));
}

function detailResult(item: Record<string, unknown>, server: PreprintServer, endpoint: string): SourceResult | undefined {
	const doi = stringValue(item.doi);
	if (!doi) return undefined;
	const version = stringValue(item.version);
	const date = stringValue(item.date);
	return {
		id: doi,
		title: stringValue(item.title) ?? "",
		year: yearFromDate(date),
		authors: stringValue(item.authors)
			? String(item.authors).split(",").map((name) => name.trim()).filter(Boolean).slice(0, 8)
			: [],
		venue: SERVER_LABEL[server],
		url: `https://${preprintHost(server)}/content/${doi}${version ? `v${version}` : ""}`,
		abstract: stringValue(item.abstract),
		source: server,
		doi,
		endpoint,
	};
}

async function searchByDoi(server: PreprintServer, doi: string, limit: number): Promise<SourceResult[]> {
	const url = buildDetailsUrl(server, doi);
	const endpoint = url.toString();
	const payload = recordValue(await requestJson(url));
	return arrayValue(payload.collection)
		.map((item) => detailResult(recordValue(item), server, endpoint))
		.filter((item): item is SourceResult => item !== undefined)
		.slice(0, limit);
}

async function searchByWindow(
	server: PreprintServer,
	window: PreprintWindow,
	limit: number,
): Promise<SourceResult[]> {
	const dateFrom = window.dateFrom as string;
	const dateTo = window.dateTo as string;
	const url = buildWindowUrl(server, dateFrom, dateTo);
	const endpoint = url.toString();
	const payload = recordValue(await requestJson(url));
	return arrayValue(payload.collection)
		.map((item) => detailResult(recordValue(item), server, endpoint))
		.filter((item): item is SourceResult => item !== undefined)
		.filter((item) => matchesTokens(window.text, `${item.title} ${item.abstract ?? ""} ${item.id}`))
		.slice(0, limit);
}

async function searchByIndex(server: PreprintServer, query: string, limit: number): Promise<SourceResult[]> {
	const url = buildPreprintIndexUrl(server, query, limit);
	const endpoint = url.toString();
	const payload = recordValue(await requestJson(url));
	const items = recordValue(payload.resultList).result;
	return (Array.isArray(items) ? items : [])
		.map((item) => normalizeEuropePmcResult(recordValue(item), endpoint))
		.filter((item): item is SourceResult => item !== undefined)
		.map((item) => ({
			...item,
			source: server,
			venue: SERVER_LABEL[server],
			abstract: item.abstract,
		}))
		.slice(0, limit);
}

export async function searchPreprints(params: SearchParams): Promise<SourceResult[]> {
	const server: PreprintServer = isPreprintServer(params.source) ? params.source : "biorxiv";
	const raw = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const doi = normalizePreprintDoi(raw);
	if (doi) return searchByDoi(server, doi, limit);
	const window = parsePreprintQuery(raw);
	if (window.dateFrom && window.dateTo) return searchByWindow(server, window, limit);
	if (!window.text) throw new Error("Preprint search requires a non-empty query.");
	return searchByIndex(server, window.text, limit);
}

function describePreprints(params: SearchParams): string[] {
	const raw = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const server: PreprintServer = isPreprintServer(params.source) ? params.source : "biorxiv";
	const doi = normalizePreprintDoi(raw);
	if (doi) return [buildDetailsUrl(server, doi).toString()];
	const window = parsePreprintQuery(raw);
	if (window.dateFrom && window.dateTo) {
		return [buildWindowUrl(server, window.dateFrom, window.dateTo).toString()];
	}
	return [buildPreprintIndexUrl(server, window.text || raw, limit).toString()];
}

export function preprintConnector(server: PreprintServer): SourceConnector {
	return {
		id: server,
		docs: "https://api.biorxiv.org/",
		endpoints: [`${PREPRINT_API_BASE}/details/${server}/...`, buildPreprintIndexUrl(server, "<query>", 5).toString()],
		search: (params) => searchPreprints({ ...params, source: server }),
		describe: (params) => describePreprints({ ...params, source: server }),
	};
}
