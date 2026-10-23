// Minimal YAML-frontmatter reader for the Markdown assets in this repo
// (agent roles and workflow prompts). It reads the flat `key: value` pairs
// these files actually use — it is not a general YAML parser.
export interface Frontmatter {
	data: Record<string, string>;
	body: string;
}

export function parseFrontmatter(raw: string): Frontmatter {
	const text = raw.replace(/^﻿/, "");
	if (!text.startsWith("---")) return { data: {}, body: text };
	const rest = text.slice(3);
	const end = rest.search(/\r?\n---/);
	if (end === -1) return { data: {}, body: text };
	const header = rest.slice(0, end);
	const body = rest.slice(end).replace(/^\r?\n---\r?\n?/, "");
	const data: Record<string, string> = {};
	for (const line of header.split(/\r?\n/)) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
		if (match?.[1] !== undefined) data[match[1]] = (match[2] ?? "").trim();
	}
	return { data, body: body.replace(/^\r?\n/, "") };
}

export function parseList(value: string | undefined): string[] {
	if (!value) return [];
	return value.split(",").map((item) => item.trim()).filter(Boolean);
}
