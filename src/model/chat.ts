// One chat-completions call against an OpenAI-compatible endpoint. Every
// provider in the registry serves /chat/completions (Anthropic through its
// OpenAI-compatible surface), so LLM mode uses a single request shape.
import { requestJson } from "../sources/http.ts";
import type { ResolvedModel } from "./registry.ts";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export const CHAT_TIMEOUT_MS = 60_000;

function headers(resolved: ResolvedModel): Record<string, string> {
	const base: Record<string, string> = { "content-type": "application/json" };
	if (resolved.apiKey) {
		base.authorization = `Bearer ${resolved.apiKey}`;
		if (resolved.provider === "anthropic") base["x-api-key"] = resolved.apiKey;
	}
	if (resolved.provider === "anthropic") base["anthropic-version"] = "2023-06-01";
	if (resolved.provider === "openrouter") base["http-referer"] = "https://github.com/consultsciences/sakirea";
	return base;
}

export async function chatComplete(
	resolved: ResolvedModel,
	messages: ChatMessage[],
	options: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
	const endpoint = `${resolved.baseUrl.replace(/\/$/, "")}/chat/completions`;
	const payload = await requestJson(endpoint, {
		method: "POST",
		headers: headers(resolved),
		timeoutMs: CHAT_TIMEOUT_MS,
		pace: false,
		retries: 0,
		body: JSON.stringify({
			model: resolved.model,
			messages,
			temperature: options.temperature ?? 0.2,
			...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
		}),
	});
	const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices ?? [];
	const content = choices[0]?.message?.content;
	if (typeof content !== "string" || !content.trim()) {
		throw new Error(`${resolved.provider} returned no message content for model ${resolved.model}.`);
	}
	return content;
}
