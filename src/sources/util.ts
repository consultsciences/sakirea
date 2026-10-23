// Small coercion helpers shared by every JSON connector. Each one answers
// "what does this payload actually contain" instead of guessing.
export function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? trimmed : undefined;
	}
	return undefined;
}

export function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

export function firstString(value: unknown): string | undefined {
	if (typeof value === "string") return stringValue(value);
	if (Array.isArray(value)) {
		for (const item of value) {
			const text = firstString(item);
			if (text) return text;
		}
	}
	return undefined;
}

export function splitAuthors(value: unknown, max = 8): string[] {
	if (typeof value === "string") {
		return value
			.split(/\s*(?:,|;| and )\s*/)
			.map((name) => name.trim())
			.filter(Boolean)
			.slice(0, max);
	}
	return arrayValue(value)
		.map((item) => stringValue(item) ?? firstString(recordValue(item).name) ?? "")
		.filter(Boolean)
		.slice(0, max);
}

export function doiUrl(doi: string | undefined): string | undefined {
	return doi ? `https://doi.org/${doi}` : undefined;
}

export function normalizeDoi(raw: unknown): string | undefined {
	const value = stringValue(raw);
	if (!value) return undefined;
	return value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
}

export function yearFromDate(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const match = /^(\d{4})/.exec(value.trim());
	if (!match?.[1]) return undefined;
	const year = Number(match[1]);
	return Number.isFinite(year) && year > 1000 && year < 3000 ? year : undefined;
}

export function yearFromDateParts(value: unknown): number | undefined {
	const parts = arrayValue(recordValue(value)["date-parts"])[0];
	if (!Array.isArray(parts) || !parts.length) return undefined;
	const year = Number(parts[0]);
	return Number.isFinite(year) ? year : undefined;
}

export function truncate(value: string | undefined, maxChars: number): string | undefined {
	if (value === undefined || value.length <= maxChars) return value;
	return `${value.slice(0, maxChars).trimEnd()}…`;
}

export function normalizeSort(sort: string | undefined): "relevance" | "pub_date" | undefined {
	const value = sort?.trim().toLowerCase();
	if (value === "pub_date" || value === "publication_date" || value === "date") return "pub_date";
	if (value === "relevance" || value === "best_match" || value === "bestmatch") return "relevance";
	return undefined;
}
