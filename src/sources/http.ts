// One HTTP door for every source connector. Network access is injectable so
// tests can run the whole engine with zero network: setFetch() swaps the
// implementation, resetFetch() restores the real global fetch.
import { pace } from "./pacer.ts";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const REQUEST_TIMEOUT_MS = 25_000;
export const MAX_RETRY_WAIT_MS = 5_000;
export const DEFAULT_RETRY_WAIT_MS = 1_500;

let injectedFetch: FetchLike | undefined;

export function setFetch(fn: FetchLike | undefined): void {
	injectedFetch = fn;
}

export function resetFetch(): void {
	injectedFetch = undefined;
}

export function getFetch(): FetchLike {
	return injectedFetch ?? ((input, init) => globalThis.fetch(input, init));
}

export class HttpError extends Error {
	readonly status: number;
	readonly retryAfterMs: number | undefined;

	constructor(message: string, status: number, retryAfterMs?: number) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.retryAfterMs = retryAfterMs;
	}
}

export function isTimeout(error: unknown): boolean {
	return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export function isRateLimited(error: unknown): boolean {
	return error instanceof HttpError && (error.status === 429 || error.status >= 500);
}

export interface RequestOptions {
	headers?: Record<string, string>;
	accept?: string;
	timeoutMs?: number;
	/** Extra attempts after a 429/5xx that carries (or implies) a short wait. */
	retries?: number;
	/** Pace the request against the host budget (default true). */
	pace?: boolean;
	method?: string;
	body?: string;
}

function parseRetryAfter(value: string | null): number | undefined {
	if (value === null) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(value);
	if (Number.isFinite(date)) return Math.max(0, date - Date.now());
	return undefined;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(url: URL, options: RequestOptions): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
	const headers: Record<string, string> = { ...(options.headers ?? {}) };
	if (options.accept) headers.accept = options.accept;
	try {
		const response = await getFetch()(url, {
			headers,
			signal: controller.signal,
			redirect: "follow",
			...(options.method ? { method: options.method } : {}),
			...(options.body !== undefined ? { body: options.body } : {}),
		});
		if (!response.ok) {
			throw new HttpError(
				`${url.hostname} request failed: ${response.status} ${response.statusText}`,
				response.status,
				parseRetryAfter(response.headers.get("retry-after")),
			);
		}
		return response;
	} finally {
		clearTimeout(timeout);
	}
}

async function withRetry(url: URL, options: RequestOptions): Promise<Response> {
	const retries = options.retries ?? 1;
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await requestOnce(url, options);
		} catch (error) {
			if (!(error instanceof HttpError) || attempt >= retries) throw error;
			// Retry only when the server asked us to (429, or any status with a
			// Retry-After header): a bare 4xx/5xx fails fast instead of sleeping.
			const retryable = error.status === 429 || error.retryAfterMs !== undefined;
			if (!retryable) throw error;
			const waitMs = Math.min(error.retryAfterMs ?? DEFAULT_RETRY_WAIT_MS, MAX_RETRY_WAIT_MS);
			await sleep(waitMs);
		}
	}
}

function run<T>(url: URL, options: RequestOptions, run: () => Promise<T>): Promise<T> {
	if (options.pace === false) return run();
	return pace(url.hostname, run);
}

export async function requestText(url: string | URL, options: RequestOptions = {}): Promise<string> {
	const target = typeof url === "string" ? new URL(url) : url;
	const response = await run(target, options, () => withRetry(target, options));
	return await response.text();
}

export async function requestJson(url: string | URL, options: RequestOptions = {}): Promise<unknown> {
	const target = typeof url === "string" ? new URL(url) : url;
	const response = await run(target, options, () => withRetry(target, { ...options, accept: options.accept ?? "application/json" }));
	return await response.json();
}
