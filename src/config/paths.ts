// Central paths and settings. Everything honors SAKIREA_HOME so tests can point
// the whole engine at a temporary directory.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type RunMode = "deterministic" | "llm";

export interface SakireaSettings {
	mode?: RunMode;
	model?: string;
	out?: string;
	host?: string;
	port?: number;
}

export function sakireaHome(): string {
	const raw = process.env.SAKIREA_HOME?.trim();
	return raw ? resolve(raw) : join(homedir(), ".sakirea");
}

export function settingsPath(): string {
	return join(sakireaHome(), "settings.json");
}

export function ensureHome(): string {
	const home = sakireaHome();
	mkdirSync(home, { recursive: true });
	return home;
}

export function readSettings(): SakireaSettings {
	try {
		const text = readFileSync(settingsPath(), "utf8");
		const parsed: unknown = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as SakireaSettings;
		return {};
	} catch {
		return {};
	}
}

export function writeSettings(patch: SakireaSettings): SakireaSettings {
	const next: SakireaSettings = { ...readSettings(), ...patch };
	ensureHome();
	const target = settingsPath();
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}
