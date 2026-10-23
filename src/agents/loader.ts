// Loads the Markdown role personas in src/agents/roles/*.md.
import { readFileSync } from "node:fs";
import { parseFrontmatter, parseList } from "../frontmatter.ts";

export interface Role {
	id: string;
	name: string;
	description: string;
	tools: string[];
	body: string;
}

const ROLE_IDS = ["researcher", "verifier", "reviewer", "writer"] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export function roleIdList(): RoleId[] {
	return [...ROLE_IDS];
}

export function rolesDir(): URL {
	return new URL("./roles/", import.meta.url);
}

function loadRoleFrom(dir: URL, id: string): Role {
	const raw = readFileSync(new URL(`${id}.md`, dir), "utf8");
	const { data, body } = parseFrontmatter(raw);
	return {
		id,
		name: data.name ?? id,
		description: data.description ?? "",
		tools: parseList(data.tools),
		body: body.trim(),
	};
}

let cached: Role[] | undefined;

export function loadRoles(): Role[] {
	if (cached) return cached;
	const dir = rolesDir();
	cached = ROLE_IDS.map((id) => loadRoleFrom(dir, id));
	return cached;
}

export function loadRole(id: string): Role {
	const role = loadRoles().find((candidate) => candidate.id === id);
	if (!role) throw new Error(`Unknown role "${id}". Known roles: ${loadRoles().map((r) => r.id).join(", ")}.`);
	return role;
}

export function loadPolicy(): string {
	return readFileSync(new URL("./SAKIREA.md", import.meta.url), "utf8").trim();
}
