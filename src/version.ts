import { readFileSync } from "node:fs";

export const VERSION: string = (() => {
	try {
		const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
		const pkg = JSON.parse(raw) as { version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
})();

export const TOOL_NAME = "sakirea_science_database_search";
export const SCHEMA = "sakirea.scienceDatabaseSearch.v1";
