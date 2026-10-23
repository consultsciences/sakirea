// Model registry: which providers Sakirea can talk to, what they are called,
// and which one (if any) the current environment can actually use. Listing
// never needs a key; resolving to a callable model does (except local Ollama).
import { requestJson } from "../sources/http.ts";

export type ProviderId = "openai" | "anthropic" | "openrouter" | "ollama";

export interface ProviderInfo {
	id: ProviderId;
	label: string;
	/** OpenAI-compatible base URL — every provider here serves /chat/completions. */
	baseUrl: string;
	/** Environment variable carrying the API key (absent for local Ollama). */
	envKey: string | undefined;
	docs: string;
	/** Whether the current environment has the key this provider needs. */
	available: boolean;
}

export interface ModelInfo {
	id: string;
	provider: ProviderId;
	/** Where the id came from: a static catalog or a live local listing. */
	source: "catalog" | "local";
	note?: string;
}

export interface ResolvedModel {
	provider: ProviderId;
	model: string;
	baseUrl: string;
	apiKey: string | undefined;
}

export const PROVIDERS: Array<Omit<ProviderInfo, "available">> = [
	{
		id: "openai",
		label: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		envKey: "OPENAI_API_KEY",
		docs: "https://platform.openai.com/docs/api-reference/chat",
	},
	{
		id: "anthropic",
		label: "Anthropic (OpenAI-compatible endpoint)",
		baseUrl: "https://api.anthropic.com/v1",
		envKey: "ANTHROPIC_API_KEY",
		docs: "https://docs.anthropic.com/en/api/messages",
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		envKey: "OPENROUTER_API_KEY",
		docs: "https://openrouter.ai/docs/api-reference/overview",
	},
	{
		id: "ollama",
		label: "Ollama (local)",
		baseUrl: process.env.SAKIREA_OLLAMA_URL?.trim() || "http://localhost:11434/v1",
		envKey: undefined,
		docs: "https://docs.ollama.com/api/chat",
	},
];

// Static catalog: real provider model ids, good enough to pick a default
// without any network call. Nothing here is a benchmark or a capability claim.
const CATALOG: ModelInfo[] = [
	{ id: "gpt-4o-mini", provider: "openai", source: "catalog" },
	{ id: "gpt-4o", provider: "openai", source: "catalog" },
	{ id: "claude-sonnet", provider: "anthropic", source: "catalog" },
	{ id: "openai/gpt-4o-mini", provider: "openrouter", source: "catalog" },
	{ id: "llama3.2", provider: "ollama", source: "catalog", note: "local installs vary; set SAKIREA_MODEL to your installed model" },
];

const DEFAULT_MODEL: Record<ProviderId, string> = {
	openai: "gpt-4o-mini",
	anthropic: "claude-sonnet",
	openrouter: "openai/gpt-4o-mini",
	ollama: "llama3.2",
};

function keyFor(provider: ProviderId): string | undefined {
	const info = PROVIDERS.find((candidate) => candidate.id === provider);
	return info?.envKey ? process.env[info.envKey]?.trim() || undefined : undefined;
}

export function providerInfo(id: ProviderId): ProviderInfo {
	const info = PROVIDERS.find((candidate) => candidate.id === id);
	if (!info) throw new Error(`Unknown provider "${id}".`);
	return { ...info, available: id === "ollama" ? true : Boolean(keyFor(id)) };
}

export function listProviders(): ProviderInfo[] {
	return PROVIDERS.map((info) => providerInfo(info.id));
}

/** Static catalog listing — no key, no network. */
export function listModels(): ModelInfo[] {
	return CATALOG.map((model) => ({ ...model }));
}

/** Live listing for local Ollama (needs no key; a local server only). */
export async function listOllamaModels(): Promise<ModelInfo[]> {
	const baseUrl = providerInfo("ollama").baseUrl;
	const payload = await requestJson(`${baseUrl}/models`, { timeoutMs: 4_000, pace: false });
	const data = (payload as { data?: Array<{ id?: string }> }).data ?? [];
	return data
		.map((model) => model.id)
		.filter((id): id is string => Boolean(id))
		.map((id) => ({ id, provider: "ollama" as const, source: "local" as const }));
}

function parseModelName(name: string): { provider?: ProviderId; model: string } {
	const trimmed = name.trim();
	const match = /^(openai|anthropic|openrouter|ollama)[:/](.+)$/.exec(trimmed);
	if (match?.[1] && match[2]) return { provider: match[1] as ProviderId, model: match[2] };
	return { model: trimmed };
}

/**
 * Resolve a model to call. With no explicit name: the first provider with a
 * key in the environment, in OpenAI → Anthropic → OpenRouter order. Returns
 * undefined when nothing is configured, which is the deterministic-mode signal.
 */
export function resolveModel(name?: string): ResolvedModel | undefined {
	const requested = name?.trim() || process.env.SAKIREA_MODEL?.trim() || undefined;
	if (requested) {
		const parsed = parseModelName(requested);
		if (parsed.provider) {
			const apiKey = keyFor(parsed.provider);
			if (parsed.provider !== "ollama" && !apiKey) return undefined;
			return {
				provider: parsed.provider,
				model: parsed.model || DEFAULT_MODEL[parsed.provider],
				baseUrl: providerInfo(parsed.provider).baseUrl,
				apiKey,
			};
		}
		// A bare model id still needs a provider that has a key.
		for (const provider of ["openai", "anthropic", "openrouter"] as const) {
			const apiKey = keyFor(provider);
			if (apiKey) return { provider, model: requested, baseUrl: providerInfo(provider).baseUrl, apiKey };
		}
		return undefined;
	}
	for (const provider of ["openai", "anthropic", "openrouter"] as const) {
		const apiKey = keyFor(provider);
		if (apiKey) {
			return {
				provider,
				model: DEFAULT_MODEL[provider],
				baseUrl: providerInfo(provider).baseUrl,
				apiKey,
			};
		}
	}
	return undefined;
}

/** The provider that has a key in this environment, if any. */
export function configuredProvider(): ProviderId | undefined {
	return resolveModel()?.provider;
}
