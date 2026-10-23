// HTTP API — node:http only, CORS enabled for browser apps, uniform
// {error:{code,message}} errors, 1 MiB JSON body limit.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { SCIENCE_DATABASE_TOOL, listConnectors, scienceDatabaseSearch } from "./sources/index.ts";
import { listWorkflows, loadPrompt, getWorkflow } from "./workflows/registry.ts";
import { runWorkflow, type RunResult } from "./workflows/runner.ts";
import { VERSION } from "./version.ts";

export const DEFAULT_PORT = 4599;
export const DEFAULT_HOST = "127.0.0.1";
export const MAX_BODY_BYTES = 1_048_576;

interface ApiError {
	status: number;
	code: string;
	message: string;
}

class RequestError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "RequestError";
		this.status = status;
		this.code = code;
	}
}

function corsHeaders(): Record<string, string> {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "content-type",
	};
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(Buffer.byteLength(body)),
		...corsHeaders(),
	});
	res.end(body);
}

function sendError(res: ServerResponse, error: ApiError): void {
	sendJson(res, error.status, { error: { code: error.code, message: error.message } });
}

function toApiError(error: unknown): ApiError {
	if (error instanceof RequestError) return { status: error.status, code: error.code, message: error.message };
	const message = error instanceof Error ? error.message : String(error);
	if (/^Unknown workflow\b/.test(message)) return { status: 404, code: "not_found", message };
	if (/^Unknown source\b/.test(message)) return { status: 400, code: "bad_request", message };
	if (/non-empty query|non-empty topic|requires a non-empty/i.test(message)) {
		return { status: 400, code: "bad_request", message };
	}
	if (/did not respond|rate-limited|request failed|HTTP \d{3}/i.test(message)) {
		return { status: 502, code: "upstream_error", message };
	}
	return { status: 500, code: "internal_error", message };
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let tooLarge = false;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				// Drain the rest so the client receives a clean 413 response,
				// then reject once the body has ended.
				tooLarge = true;
				chunks.length = 0;
				return;
			}
			if (!tooLarge) chunks.push(chunk);
		});
		req.on("end", () => {
			if (tooLarge) {
				reject(new RequestError(413, "payload_too_large", `JSON body exceeds ${MAX_BODY_BYTES} bytes.`));
				return;
			}
			resolve(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", (error) => reject(error));
	});
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	const raw = await readBody(req);
	if (!raw.trim()) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new RequestError(400, "bad_request", "Request body is not valid JSON.");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new RequestError(400, "bad_request", "Request body must be a JSON object.");
	}
	return parsed as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (typeof value !== "string" || !value.trim()) {
		throw new RequestError(400, "bad_request", `"${key}" must be a non-empty string.`);
	}
	return value.trim();
}

const MODES = new Set(["auto", "deterministic", "llm"]);

async function handleSearch(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
	const source = requireString(body, "source");
	const query = requireString(body, "query");
	const limit = typeof body.limit === "number" ? body.limit : undefined;
	const sort = typeof body.sort === "string" ? body.sort : undefined;
	const envelope = await scienceDatabaseSearch({ source, query, limit, sort });
	sendJson(res, 200, envelope);
}

async function handleRun(res: ServerResponse, workflowId: string, body: Record<string, unknown>): Promise<void> {
	const topic = requireString(body, "topic");
	const mode = body.mode === undefined ? "auto" : body.mode;
	if (typeof mode !== "string" || !MODES.has(mode)) {
		throw new RequestError(400, "bad_request", `"mode" must be one of: auto, deterministic, llm.`);
	}
	const outputDir = typeof body.outputDir === "string" && body.outputDir.trim() ? body.outputDir.trim() : undefined;
	const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
	getWorkflow(workflowId); // throws "Unknown workflow ..." → 404 via toApiError
	const result: RunResult = await runWorkflow({
		topic,
		workflowId,
		mode: mode as "auto" | "deterministic" | "llm",
		outputDir,
		model,
	});
	sendJson(res, 200, {
		slug: result.slug,
		workflowId: result.workflowId,
		artifactPath: result.artifactPath,
		provenancePath: result.provenancePath,
		provenanceJsonPath: result.provenanceJsonPath,
		planPath: result.planPath,
		status: result.status,
		mode: result.mode,
		results: result.resultsCount,
		blocked: result.failures.map((failure) => ({ source: failure.source, error: failure.error })),
	});
}

function handleListSources(res: ServerResponse): void {
	sendJson(res, 200, {
		tool: SCIENCE_DATABASE_TOOL.name,
		sources: listConnectors().map((connector) => ({
			id: connector.id,
			docs: connector.docs,
			endpoints: connector.endpoints,
		})),
	});
}

function handleListWorkflows(res: ServerResponse): void {
	sendJson(res, 200, {
		workflows: listWorkflows().map((workflow) => {
			const prompt = loadPrompt(workflow.id);
			return {
				id: workflow.id,
				name: workflow.name,
				description: workflow.description,
				agents: workflow.agents,
				outputDir: workflow.outputDir,
				args: prompt.args,
			};
		}),
	});
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const method = (req.method ?? "GET").toUpperCase();
	const url = new URL(req.url ?? "/", "http://localhost");
	const path = url.pathname.replace(/\/$/, "") || "/";

	try {
		if (method === "OPTIONS") {
			res.writeHead(204, corsHeaders());
			res.end();
			return;
		}
		if (method === "GET" && path === "/api/health") {
			sendJson(res, 200, { ok: true, name: "sakirea", version: VERSION });
			return;
		}
		if (method === "GET" && path === "/api/sources") {
			handleListSources(res);
			return;
		}
		if (method === "GET" && path === "/api/workflows") {
			handleListWorkflows(res);
			return;
		}
		if (method === "POST" && path === "/api/search") {
			await handleSearch(res, await readJsonBody(req));
			return;
		}
		const runMatch = /^\/api\/workflows\/([A-Za-z0-9_-]+)\/run$/.exec(path);
		if (method === "POST" && runMatch?.[1]) {
			await handleRun(res, runMatch[1], await readJsonBody(req));
			return;
		}
		if (path.startsWith("/api/")) {
			sendError(res, { status: 404, code: "not_found", message: `No route for ${method} ${path}.` });
			return;
		}
		sendError(res, { status: 404, code: "not_found", message: `No route for ${method} ${path}.` });
	} catch (error) {
		sendError(res, toApiError(error));
	}
}

export interface RunningServer {
	url: string;
	host: string;
	port: number;
	server: Server;
	close(): Promise<void>;
}

export async function startServer(options: { host?: string; port?: number } = {}): Promise<RunningServer> {
	const host = options.host ?? DEFAULT_HOST;
	const port = options.port ?? DEFAULT_PORT;
	const server = createServer((req, res) => {
		void handleRequest(req, res);
	});
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(port, host, () => {
			server.removeListener("error", rejectListen);
			resolveListen();
		});
	});
	const address = server.address();
	const boundPort = typeof address === "object" && address ? address.port : port;
	return {
		url: `http://${host}:${boundPort}`,
		host,
		port: boundPort,
		server,
		close: () =>
			new Promise<void>((resolveClose) => {
				server.close(() => resolveClose());
			}),
	};
}
