// Hugging Face engine — public, key-free Hub API (https://huggingface.co/api).
//   hf_search         -> search models / datasets / spaces
//   hf_repo_files     -> file tree of a repo
//   hf_repo_read_file -> read one small text file from a repo
// HF_TOKEN is optional and only used when the caller has set it.
import { HttpError, requestJson, requestText } from "./http.ts";
import { arrayValue, numberValue, recordValue, stringValue } from "./util.ts";
import { safeLimit } from "./types.ts";

export const HF_API_BASE = "https://huggingface.co/api";
export const HF_BASE = "https://huggingface.co";
export const HF_DOCS = "https://huggingface.co/docs/hub";
export const HF_DEFAULT_READ_CHARS = 20_000;
export const HF_MAX_READ_CHARS = 60_000;

export type RepoKind = "model" | "dataset" | "space";

const TREE_SEGMENT: Record<RepoKind, string> = { model: "models", dataset: "datasets", space: "spaces" };
const PATH_PREFIX: Record<RepoKind, string> = { model: "", dataset: "datasets/", space: "spaces/" };
const SEARCH_SEGMENT: Record<RepoKind, string> = { model: "models", dataset: "datasets", space: "spaces" };

const BLOCKED_EXTENSIONS = new Set([
	".7z", ".bin", ".ckpt", ".gguf", ".h5", ".joblib", ".onnx", ".ot",
	".parquet", ".pt", ".pth", ".safetensors", ".tar", ".tgz", ".zip",
]);

export interface ProvenanceMeta {
	docs: string;
	endpoints: string[];
	queriedAt: string;
}

export interface HfSearchResult {
	id: string;
	kind: RepoKind;
	downloads?: number;
	likes?: number;
	lastModified?: string;
	pipelineTag?: string;
	url: string;
}

export interface HfSearchEnvelope {
	returned: number;
	results: HfSearchResult[];
	provenance: ProvenanceMeta;
}

export interface HfFilesEnvelope {
	repo: string;
	kind: RepoKind;
	files: Array<{ path: string; size: number | undefined; type: string }>;
	provenance: ProvenanceMeta;
}

export interface HfReadEnvelope {
	repo: string;
	kind: RepoKind;
	path: string;
	text: string;
	truncated: boolean;
	provenance: ProvenanceMeta;
}

function authHeaders(): Record<string, string> {
	const token = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_HUB_TOKEN?.trim();
	return token ? { authorization: `Bearer ${token}` } : {};
}

export function normalizeRepoKind(value: string | undefined): RepoKind {
	if (value === "dataset" || value === "space") return value;
	return "model";
}

function encodeRepoId(repo: string): string {
	return repo.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export function buildHfSearchUrl(query: string, kind: RepoKind, limit: number): URL {
	const url = new URL(`${HF_API_BASE}/${SEARCH_SEGMENT[kind]}`);
	url.search = new URLSearchParams({ search: query, limit: String(limit), full: "false" }).toString();
	return url;
}

export function buildHfTreeUrl(repo: string, kind: RepoKind): URL {
	const url = new URL(`${HF_API_BASE}/${TREE_SEGMENT[kind]}/${encodeRepoId(repo)}/tree/main`);
	url.searchParams.set("recursive", "true");
	return url;
}

export function buildHfRawUrl(repo: string, kind: RepoKind, path: string): string {
	const prefix = PATH_PREFIX[kind];
	const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
	return `${HF_BASE}/${prefix}${encodeRepoId(repo)}/raw/main/${encodedPath}`;
}

export async function hfSearch(params: { query: string; kind?: string; limit?: number }): Promise<HfSearchEnvelope> {
	const query = String(params.query ?? "").trim();
	if (!query) throw new Error("hf_search requires a non-empty query.");
	const kind = normalizeRepoKind(params.kind);
	const limit = safeLimit(params.limit);
	const url = buildHfSearchUrl(query, kind, limit);
	const endpoint = url.toString();
	const payload = await requestJson(url, { headers: authHeaders() });
	const results: HfSearchResult[] = [];
	for (const item of arrayValue(payload)) {
		const record = recordValue(item);
		const id = stringValue(record.id) ?? stringValue(record.modelId);
		if (!id) continue;
		results.push({
			id,
			kind,
			downloads: numberValue(record.downloads),
			likes: numberValue(record.likes),
			lastModified: stringValue(record.lastModified),
			pipelineTag: stringValue(record.pipeline_tag),
			url: `${HF_BASE}/${PATH_PREFIX[kind]}${id}`,
		});
	}
	return {
		returned: results.length,
		results,
		provenance: { docs: HF_DOCS, endpoints: [endpoint], queriedAt: new Date().toISOString() },
	};
}

export async function hfRepoFiles(params: { repo: string; kind?: string }): Promise<HfFilesEnvelope> {
	const repo = String(params.repo ?? "").trim();
	if (!repo) throw new Error("hf_repo_files requires a repo id such as `openai/gpt-2`.");
	const kind = normalizeRepoKind(params.kind);
	const url = buildHfTreeUrl(repo, kind);
	const endpoint = url.toString();
	const payload = await requestJson(url, { headers: authHeaders() });
	const files = arrayValue(payload)
		.map((item) => {
			const record = recordValue(item);
			const path = stringValue(record.path);
			if (!path) return undefined;
			return { path, size: numberValue(record.size), type: stringValue(record.type) ?? "file" };
		})
		.filter((item): item is { path: string; size: number | undefined; type: string } => item !== undefined);
	return { repo, kind, files, provenance: { docs: HF_DOCS, endpoints: [endpoint], queriedAt: new Date().toISOString() } };
}

export async function hfRepoReadFile(params: {
	repo: string;
	path: string;
	kind?: string;
	maxChars?: number;
}): Promise<HfReadEnvelope> {
	const repo = String(params.repo ?? "").trim();
	const path = String(params.path ?? "").trim();
	if (!repo || !path) throw new Error("hf_repo_read_file requires a repo id and a file path.");
	const kind = normalizeRepoKind(params.kind);
	const extension = (path.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase();
	if (BLOCKED_EXTENSIONS.has(extension)) {
		throw new Error(`hf_repo_read_file refuses binary file "${path}". Use hf_repo_files to list the tree instead.`);
	}
	const maxChars = Math.min(Math.max(params.maxChars ?? HF_DEFAULT_READ_CHARS, 1), HF_MAX_READ_CHARS);
	const endpoint = buildHfRawUrl(repo, kind, path);
	let text: string;
	try {
		text = await requestText(endpoint, { accept: "text/plain", headers: authHeaders() });
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) {
			throw new Error(`hf_repo_read_file: ${repo} has no file "${path}".`);
		}
		throw error;
	}
	const truncated = text.length > maxChars;
	return {
		repo,
		kind,
		path,
		text: truncated ? text.slice(0, maxChars) : text,
		truncated,
		provenance: { docs: HF_DOCS, endpoints: [endpoint], queriedAt: new Date().toISOString() },
	};
}
