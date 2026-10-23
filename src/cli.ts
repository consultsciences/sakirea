// Sakirea CLI — command-style (no REPL).
//
//   sakirea "<topic>"                     run deepresearch
//   sakirea <workflow> "<topic>"          run a named workflow
//   sakirea sources                       list the science-database connectors
//   sakirea workflows                     list workflows
//   sakirea search <source> "<query>"     one-shot source search
//   sakirea serve [--port 4599]           start the HTTP API
//   sakirea --help | --version
//
// Flags: --mode deterministic|llm, --out <dir>, --model <id>, --limit <n>,
// --sort relevance|pub_date, --host <host>, --port <n>.
import { listConnectors, scienceDatabaseSearch } from "./sources/index.ts";
import { isWorkflowId, listWorkflows, loadPrompt } from "./workflows/registry.ts";
import { runWorkflow } from "./workflows/runner.ts";
import { readSettings, type RunMode } from "./config/paths.ts";
import { DEFAULT_HOST, DEFAULT_PORT, startServer } from "./server.ts";
import { VERSION } from "./version.ts";

export interface CliIo {
	out(text: string): void;
	err(text: string): void;
}

const processIo: CliIo = {
	out: (text) => void process.stdout.write(text),
	err: (text) => void process.stderr.write(text),
};

export const HELP = `sakirea ${VERSION} — research workflows over key-free science databases

Usage:
  sakirea "<topic>"                          run deep research on a topic
  sakirea <workflow> "<topic>"               run a named workflow
  sakirea sources                            list science-database connectors
  sakirea workflows                          list workflows
  sakirea search <source> "<query>"          search one source directly
  sakirea serve [--port 4599] [--host H]     start the HTTP API (default 127.0.0.1:4599)

Workflows:
${listWorkflows().map((workflow) => `  ${workflow.id.padEnd(14)} ${workflow.description}`).join("\n")}

Sources:
${listConnectors().map((connector) => `  ${connector.id.padEnd(15)} ${connector.docs}`).join("\n")}

Flags:
  --mode deterministic|llm    force a mode (default: llm when an API key is set, else deterministic)
  --out <dir>                 output directory (default: outputs/, papers/ for draft)
  --model <id>                model id for llm mode (e.g. gpt-4o-mini, anthropic/claude-sonnet)
  --limit <n>                 records per source, 1..20 (default 5)
  --sort relevance|pub_date   sort order where the source supports it
  --host <host>               bind address for serve (default 127.0.0.1)
  --port <n>                  port for serve (default 4599)
  -h, --help                  show this help
  -V, --version               print the version

Environment:
  OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY   enable llm mode
  SAKIREA_HOME        config directory (default ~/.sakirea, holds settings.json)
  SAKIREA_MODEL       default model id
No API key is needed for any science-database source. Sakirea ships no telemetry.
`;

interface ParsedArgs {
	positionals: string[];
	flags: Record<string, string | true>;
}

const VALUE_FLAGS = new Set(["mode", "out", "model", "limit", "sort", "host", "port"]);
const BOOL_FLAGS = new Set(["help", "version"]);

export function parseArgs(argv: string[]): ParsedArgs {
	const positionals: string[] = [];
	const flags: Record<string, string | true> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index] ?? "";
		if (token === "-h") {
			flags.help = true;
			continue;
		}
		if (token === "-V") {
			flags.version = true;
			continue;
		}
		if (token.startsWith("--")) {
			const [rawName, inlineValue] = token.slice(2).split(/=(.*)/s);
			const name = rawName ?? "";
			if (BOOL_FLAGS.has(name)) {
				flags[name] = true;
				continue;
			}
			if (!VALUE_FLAGS.has(name)) throw new UsageError(`Unknown flag "--${name}".`);
			const value = inlineValue !== undefined && inlineValue !== "" ? inlineValue : argv[index + 1];
			if (value === undefined || value.startsWith("--")) throw new UsageError(`Flag "--${name}" requires a value.`);
			flags[name] = value;
			index += 1;
			continue;
		}
		positionals.push(token);
	}
	return { positionals, flags };
}

export class UsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UsageError";
	}
}

function flagInt(flags: Record<string, string | true>, name: string): number | undefined {
	const raw = flags[name];
	if (typeof raw !== "string") return undefined;
	const value = Number(raw);
	if (!Number.isFinite(value)) throw new UsageError(`--${name} must be a number.`);
	return value;
}

function resolveMode(flags: Record<string, string | true>): RunMode | "auto" {
	const requested = flags.mode;
	if (typeof requested === "string") {
		if (requested !== "deterministic" && requested !== "llm") {
			throw new UsageError(`--mode must be "deterministic" or "llm" (got "${requested}").`);
		}
		return requested;
	}
	const settings = readSettings();
	return settings.mode ?? "auto";
}

function printLines(io: CliIo, lines: string[]): void {
	io.out(`${lines.join("\n")}\n`);
}

async function runSearch(io: CliIo, positionals: string[], flags: Record<string, string | true>): Promise<number> {
	const [, ...rest] = positionals;
	const source = positionals[0];
	const query = rest.join(" ").trim();
	if (!source || !query) throw new UsageError('Usage: sakirea search <source> "<query>" [--limit N] [--sort relevance|pub_date]');
	const envelope = await scienceDatabaseSearch({
		source,
		query,
		limit: flagInt(flags, "limit"),
		sort: typeof flags.sort === "string" ? flags.sort : undefined,
	});
	io.out(`${JSON.stringify(envelope, null, 2)}\n`);
	return 0;
}

async function runTopic(io: CliIo, workflowId: string, topic: string, flags: Record<string, string | true>): Promise<number> {
	const result = await runWorkflow({
		topic,
		workflowId,
		mode: resolveMode(flags),
		outputDir: typeof flags.out === "string" ? flags.out : undefined,
		model: typeof flags.model === "string" ? flags.model : undefined,
		limit: flagInt(flags, "limit"),
	});
	printLines(io, [
		`workflow : ${result.workflowId}`,
		`slug     : ${result.slug}`,
		`mode     : ${result.mode}${result.mode === "deterministic" ? " (no LLM key)" : ""}`,
		`status   : ${result.status}`,
		`records  : ${result.resultsCount}`,
		`artifact : ${result.artifactPath}`,
		`plan     : ${result.planPath}`,
		`draft    : ${result.draftPath}`,
		`provenance: ${result.provenancePath}`,
		...(result.failures.length
			? ["blocked  :", ...result.failures.map((failure) => `  - ${failure.source}: ${failure.error}`)]
			: []),
	]);
	return 0;
}

export async function main(argv: string[], io: CliIo = processIo): Promise<number> {
	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(argv);
	} catch (error) {
		io.err(`${error instanceof Error ? error.message : String(error)}\n`);
		return 2;
	}
	const { positionals, flags } = parsed;

	try {
		if (flags.help || positionals[0] === "help") {
			io.out(HELP);
			return 0;
		}
		if (flags.version) {
			io.out(`${VERSION}\n`);
			return 0;
		}
		if (positionals.length === 0) {
			io.out(HELP);
			return 0;
		}

		const command = positionals[0] as string;

		if (command === "sources") {
			const lines: string[] = [];
			for (const connector of listConnectors()) {
				lines.push(`${connector.id}`);
				lines.push(`  docs:      ${connector.docs}`);
				lines.push(`  endpoints: ${connector.endpoints.join(", ")}`);
			}
			printLines(io, lines);
			return 0;
		}

		if (command === "workflows") {
			const lines: string[] = [];
			for (const workflow of listWorkflows()) {
				const prompt = loadPrompt(workflow.id);
				lines.push(`${workflow.id}  (${workflow.outputDir}/)`);
				lines.push(`  ${workflow.description}`);
				lines.push(`  args: ${prompt.args} | agents: ${workflow.agents.join(" → ")}`);
			}
			printLines(io, lines);
			return 0;
		}

		if (command === "search") {
			return await runSearch(io, positionals.slice(1), flags);
		}

		if (command === "serve") {
			const settings = readSettings();
			const host = typeof flags.host === "string" ? flags.host : (settings.host ?? DEFAULT_HOST);
			const port = flagInt(flags, "port") ?? settings.port ?? DEFAULT_PORT;
			const running = await startServer({ host, port });
			printLines(io, [
				`sakirea API listening on ${running.url}`,
				`  GET  /api/health`,
				`  GET  /api/sources`,
				`  GET  /api/workflows`,
				`  POST /api/search`,
				`  POST /api/workflows/:id/run`,
			]);
			await new Promise<never>(() => {});
			return 0; // unreachable while the server is listening
		}

		// sakirea <workflow> "<topic>"  |  sakirea "<topic>"
		const rest = positionals.slice(1);
		if (isWorkflowId(command)) {
			const topic = rest.join(" ").trim();
			if (!topic) throw new UsageError(`Usage: sakirea ${command} "<topic>"`);
			return await runTopic(io, command, topic, flags);
		}
		const topic = positionals.join(" ").trim();
		return await runTopic(io, "deepresearch", topic, flags);
	} catch (error) {
		if (error instanceof UsageError) {
			io.err(`${error.message}\n`);
			return 2;
		}
		io.err(`${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}

// Self-run only when this module is the CLI entry (bin/sakirea.mjs imports it;
// tests import main() directly and must not trigger execution).
const entryPath = (process.argv[1] ?? "").replace(/\\/g, "/");
const isCliEntry = entryPath.endsWith("/sakirea.mjs") || entryPath.endsWith("/cli.ts") || entryPath === "sakirea.mjs";
if (isCliEntry) {
	process.exitCode = await main(process.argv.slice(2));
}
