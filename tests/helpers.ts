// Shared test utilities: a fake fetch (zero network in tests), JSON/text
// response builders, and temp-directory helpers.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetFetch, setFetch, type FetchLike } from "../src/sources/http.ts";
import { resetPacers } from "../src/sources/pacer.ts";

export function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

export function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });
}

export function htmlResponse(body: string, status = 200): Response {
	return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** Install a fake fetch; unmatched hosts answer 500 so a leak is visible. */
export function stubFetch(handler: FetchLike): void {
	setFetch(handler);
}

/** Route fake responses by hostname. */
export function stubFetchByHost(routes: Record<string, (url: URL, init?: RequestInit) => Response>): void {
	setFetch(async (input, init) => {
		const url = new URL(String(input));
		const route = routes[url.hostname];
		if (!route) return jsonResponse({ error: `no stub for ${url.hostname}` }, 500);
		return route(url, init);
	});
}

export function restoreNetwork(): void {
	resetFetch();
	resetPacers();
}

export function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function cleanupDir(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// best effort; temp dirs are reaped by the OS
	}
}
