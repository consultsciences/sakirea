// Key-free web engine.
//   web_search    -> DuckDuckGo's HTML endpoint (https://html.duckduckgo.com/html/?q=…)
//   fetch_content -> fetch a URL and strip HTML down to readable text
// Both are best-effort: any failure is returned as a degraded result with the
// error recorded, never as a thrown crash that kills a research run.
import { HttpError, isTimeout, requestText } from "./http.ts";import { decodeEntities } from "./xml.ts";

export const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
export const FETCH_CONTENT_MAX_CHARS = 50_000;

export interface WebSearchResult {
	title: string;
	url: string;
	snippet?: string;
}

export interface ProvenanceMeta {
	docs: string;
	endpoints: string[];
	queriedAt: string;
}

export interface WebSearchEnvelope {
	ok: boolean;
	degraded: boolean;
	error?: string;
	query: string;
	returned: number;
	results: WebSearchResult[];
	provenance: ProvenanceMeta;
}

export interface FetchContentEnvelope {
	ok: boolean;
	degraded: boolean;
	error?: string;
	url: string;
	contentType: string | undefined;
	truncated: boolean;
	text: string;
	provenance: ProvenanceMeta;
}

function cleanText(fragment: string): string {
	return decodeEntities(fragment.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** DuckDuckGo wraps result URLs as //duckduckgo.com/l/?uddg=<encoded>. */
export function unwrapDdgHref(href: string): string {
	let trimmed = href.trim();
	if (trimmed.startsWith("//")) trimmed = `https:${trimmed}`;
	try {
		const url = new URL(trimmed);
		if (url.hostname.endsWith("duckduckgo.com") && url.pathname.startsWith("/l/")) {
			const target = url.searchParams.get("uddg");
			if (target) return target;
		}
		return trimmed.startsWith("http") ? url.toString() : trimmed;
	} catch {
		return trimmed;
	}
}

export function parseDdgHtml(html: string): WebSearchResult[] {
	const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
	const results: WebSearchResult[] = [];
	const snippets: string[] = [];
	for (const match of anchors) {
		const attrs = match[1] ?? "";
		const body = match[2] ?? "";
		const classes = /class\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "";
		if (classes.split(/\s+/).includes("result__a")) {
			const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
			if (!href) continue;
			const url = unwrapDdgHref(decodeEntities(href));
			if (!/^https?:/i.test(url)) continue;
			const title = cleanText(body);
			if (!title) continue;
			results.push({ title, url });
		} else if (classes.split(/\s+/).includes("result__snippet")) {
			snippets.push(cleanText(body));
		}
	}
	return results.map((result, index) => {
		const snippet = snippets[index];
		return snippet ? { ...result, snippet } : result;
	});
}

function describeError(error: unknown): string {
	if (isTimeout(error)) return "request timed out";
	if (error instanceof HttpError) return error.message;
	if (error instanceof Error) return error.message;
	return String(error);
}

export async function webSearch(query: string, limit = 8): Promise<WebSearchEnvelope> {
	const trimmed = query.trim();
	const provenance: ProvenanceMeta = {
		docs: "https://duckduckgo.com/html/",
		endpoints: [],
		queriedAt: new Date().toISOString(),
	};
	if (!trimmed) {
		return { ok: false, degraded: true, error: "web_search requires a non-empty query.", query: trimmed, returned: 0, results: [], provenance };
	}
	const url = new URL(DDG_HTML_URL);
	url.searchParams.set("q", trimmed);
	const endpoint = url.toString();
	provenance.endpoints = [endpoint];
	try {
		const html = await requestText(url, {
			accept: "text/html",
			headers: { "user-agent": "Mozilla/5.0 (compatible; sakirea/0.1)" },
		});
		const results = parseDdgHtml(html).slice(0, Math.max(1, limit));
		return { ok: true, degraded: false, query: trimmed, returned: results.length, results, provenance };
	} catch (error) {
		return {
			ok: false,
			degraded: true,
			error: `web_search degraded: ${describeError(error)}`,
			query: trimmed,
			returned: 0,
			results: [],
			provenance,
		};
	}
}

/** Strip HTML down to readable prose: drop scripts/styles, collapse whitespace. */
export function htmlToText(html: string): string {
	return decodeEntities(
		html
			.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
			.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
			.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
			.replace(/<!--[\s\S]*?-->/g, " ")
			.replace(/<\/(p|div|section|article|h[1-6]|li|tr|br|blockquote)>/gi, "\n")
			.replace(/<[^>]*>/g, " "),
	)
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n\s*\n+/g, "\n\n")
		.split("\n")
		.map((line) => line.trim())
		.join("\n")
		.trim();
}

export async function fetchContent(input: string, maxChars = FETCH_CONTENT_MAX_CHARS): Promise<FetchContentEnvelope> {
	const provenance: ProvenanceMeta = { docs: "https://developer.mozilla.org/en-US/docs/Web/HTTP", endpoints: [], queriedAt: new Date().toISOString() };
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return { ok: false, degraded: true, error: "fetch_content requires an absolute http(s) URL.", url: input, contentType: undefined, truncated: false, text: "", provenance };
	}
	const endpoint = url.toString();
	provenance.endpoints = [endpoint];
	try {
		const response = await requestText(url, {
			accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
			headers: { "user-agent": "Mozilla/5.0 (compatible; sakirea/0.1)" },
		});
		const isHtml = /<html[\s>]|<!doctype html|<body[\s>]/i.test(response.slice(0, 2000));
		const raw = isHtml ? htmlToText(response) : response;
		const truncated = raw.length > maxChars;
		return {
			ok: true,
			degraded: false,
			url: endpoint,
			contentType: isHtml ? "text/html" : "text",
			truncated,
			text: truncated ? raw.slice(0, maxChars) : raw,
			provenance,
		};
	} catch (error) {
		return {
			ok: false,
			degraded: true,
			error: `fetch_content degraded: ${describeError(error)}`,
			url: endpoint,
			contentType: undefined,
			truncated: false,
			text: "",
			provenance,
		};
	}
}
