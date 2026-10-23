// A deliberately small Atom reader for arXiv's API feed. Sakirea has zero
// runtime dependencies, so instead of an XML library this parses the handful of
// elements the arXiv query feed actually emits (title, summary, id, published,
// authors, categories, links, doi). It is not a general XML parser and does not
// claim to be: unknown elements are ignored.

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

export function decodeEntities(text: string): string {
	return text
		.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
		.replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/** Remove nested markup (XML escapes decoded) so text is plain. */
export function textOf(fragment: string): string {
	return decodeEntities(fragment.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

/** Tag pattern tolerant of namespace prefixes (arXiv emits <arxiv:doi> etc.). */
function tagSource(tag: string): string {
	return `(?:[A-Za-z][\\w.-]*:)?${tag}`;
}

export function firstTag(block: string, tag: string): string | undefined {
	const match = new RegExp(`<${tagSource(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagSource(tag)}>`).exec(block);
	return match?.[1];
}

export function allTags(block: string, tag: string): string[] {
	const pattern = new RegExp(`<${tagSource(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagSource(tag)}>`, "g");
	const out: string[] = [];
	for (const match of block.matchAll(pattern)) {
		if (match[1] !== undefined) out.push(match[1]);
	}
	return out;
}

export function openTags(block: string, tag: string): string[] {
	const pattern = new RegExp(`<${tagSource(tag)}(?:\\s[^>]*)?/?>`, "g");
	return [...block.matchAll(pattern)].map((match) => match[0]);
}

export function attrValue(tagHtml: string, attr: string): string | undefined {
	const match = new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"|\\b${attr}\\s*=\\s*'([^']*)'`).exec(tagHtml);
	return match?.[1] ?? match?.[2];
}

/** Every <entry>…</entry> block in an Atom feed, in document order. */
export function splitEntries(xml: string): string[] {
	return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)]
		.map((match) => match[1] ?? "")
		.filter(Boolean);
}

export interface AtomEntry {
	id: string;
	title: string;
	summary: string;
	published: string;
	updated: string;
	doi?: string;
	journalRef?: string;
	comment?: string;
	authors: string[];
	categories: string[];
	absUrl: string;
	pdfUrl?: string;
	primaryCategory?: string;
}

export function parseAtomEntry(block: string): AtomEntry | undefined {
	const id = textOf(firstTag(block, "id") ?? "");
	if (!id) return undefined;
	const authors = allTags(block, "author")
		.map((author) => textOf(firstTag(author, "name") ?? ""))
		.filter(Boolean);
	const categories = openTags(block, "category")
		.map((tag) => attrValue(tag, "term"))
		.filter((value): value is string => Boolean(value));
	const primaryTag = openTags(block, "primary_category")[0];
	const links = openTags(block, "link");
	const pdfLink = links.find(
		(tag) => attrValue(tag, "title") === "pdf" || attrValue(tag, "type") === "application/pdf",
	);
	return {
		id,
		title: textOf(firstTag(block, "title") ?? ""),
		summary: textOf(firstTag(block, "summary") ?? ""),
		published: textOf(firstTag(block, "published") ?? ""),
		updated: textOf(firstTag(block, "updated") ?? ""),
		doi: textOf(firstTag(block, "doi") ?? "") || undefined,
		journalRef: textOf(firstTag(block, "journal_ref") ?? "") || undefined,
		comment: textOf(firstTag(block, "comment") ?? "") || undefined,
		authors,
		categories,
		absUrl: id,
		pdfUrl: pdfLink ? attrValue(pdfLink, "href") : undefined,
		primaryCategory: primaryTag ? attrValue(primaryTag, "term") : undefined,
	};
}

export function parseAtomFeed(xml: string): AtomEntry[] {
	return splitEntries(xml)
		.map(parseAtomEntry)
		.filter((entry): entry is AtomEntry => entry !== undefined);
}
