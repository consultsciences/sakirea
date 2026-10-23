// Workflow registry: the ten workflows Sakirea ships, their role pipelines,
// their output directory, and the Markdown prompt template for each.
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../frontmatter.ts";
import { roleIdList } from "../agents/loader.ts";

export type OutputDir = "outputs" | "papers";

export interface Workflow {
	id: string;
	name: string;
	description: string;
	agents: string[];
	outputDir: OutputDir;
}

interface PromptSource {
	id: string;
	name: string;
	description: string;
	agents: string[];
	outputDir: OutputDir;
}

const PROMPT_SOURCES: PromptSource[] = [
	{
		id: "deepresearch",
		name: "Deep research",
		description: "Thorough, source-heavy investigation producing a durable research brief with inline citations.",
		agents: ["researcher", "verifier", "reviewer", "writer"],
		outputDir: "outputs",
	},
	{
		id: "lit",
		name: "Literature review",
		description: "Map a topic's corpus, cluster it by theme, and report agreements, disputes, and gaps.",
		agents: ["researcher", "verifier", "writer"],
		outputDir: "outputs",
	},
	{
		id: "review",
		name: "Critical review",
		description: "Evidence-bounded critical assessment of a paper, claim, or line of work.",
		agents: ["researcher", "reviewer", "writer"],
		outputDir: "outputs",
	},
	{
		id: "audit",
		name: "Evidence audit",
		description: "Trace each major claim of a paper to its source and mark unsupported or unreproducible links.",
		agents: ["researcher", "verifier", "writer"],
		outputDir: "outputs",
	},
	{
		id: "replicate",
		name: "Replication",
		description: "Plan a replication of a reported result and run the smallest decisive check that is possible.",
		agents: ["researcher", "verifier"],
		outputDir: "outputs",
	},
	{
		id: "recipe",
		name: "ML recipe",
		description: "Source-backed recipe: data, method, hyperparameters, compute, and implementation pointers.",
		agents: ["researcher", "writer"],
		outputDir: "outputs",
	},
	{
		id: "compare",
		name: "Comparison",
		description: "Compare 2–3 named items on shared dimensions with an evidence cell for every claim.",
		agents: ["researcher", "verifier", "writer"],
		outputDir: "outputs",
	},
	{
		id: "draft",
		name: "Paper draft",
		description: "Draft a paper-style manuscript section from gathered evidence with an evidence-to-claim map.",
		agents: ["researcher", "writer"],
		outputDir: "papers",
	},
	{
		id: "autoresearch",
		name: "Autoresearch loop",
		description: "Iterative loop: generate questions, gather evidence, verify, refine, until the artifact stops improving.",
		agents: ["researcher", "verifier", "reviewer", "writer"],
		outputDir: "outputs",
	},
	{
		id: "summarize",
		name: "Source summary",
		description: "Summarize one research source into a structured, source-faithful artifact.",
		agents: ["writer"],
		outputDir: "outputs",
	},
];

export interface WorkflowPrompt {
	id: string;
	description: string;
	args: string;
	body: string;
}

export function promptsDir(): URL {
	return new URL("./prompts/", import.meta.url);
}

export function loadPrompt(id: string): WorkflowPrompt {
	const raw = readFileSync(new URL(`${id}.md`, promptsDir()), "utf8");
	const { data, body } = parseFrontmatter(raw);
	if (!data.description) throw new Error(`Workflow prompt "${id}" is missing a frontmatter description.`);
	return {
		id,
		description: data.description,
		args: data.args ?? "<topic>",
		body: body.trim(),
	};
}

const workflows: Workflow[] = PROMPT_SOURCES.map(({ id, name, description, agents, outputDir }) => ({
	id,
	name,
	description,
	agents,
	outputDir,
}));

export function listWorkflows(): Workflow[] {
	return workflows.map((workflow) => ({ ...workflow, agents: [...workflow.agents] }));
}

export function getWorkflow(id: string): Workflow {
	const workflow = workflows.find((candidate) => candidate.id === id);
	if (!workflow) {
		throw new Error(`Unknown workflow "${id}". Known workflows: ${workflows.map((w) => w.id).join(", ")}.`);
	}
	return workflow;
}

export function isWorkflowId(id: string): boolean {
	return workflows.some((workflow) => workflow.id === id);
}

/** Every workflow must name only known roles and have a loadable prompt. */
export function validateRegistry(): string[] {
	const known = new Set<string>(roleIdList());
	const problems: string[] = [];
	for (const workflow of workflows) {
		for (const agent of workflow.agents) {
			if (!known.has(agent)) problems.push(`${workflow.id}: unknown agent "${agent}"`);
		}
		try {
			loadPrompt(workflow.id);
		} catch (error) {
			problems.push(`${workflow.id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return problems;
}
