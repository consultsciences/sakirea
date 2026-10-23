// Workflow registry completeness: all ten workflows, loadable prompt templates
// with frontmatter, and role pipelines that only name real roles.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getWorkflow, isWorkflowId, listWorkflows, loadPrompt, validateRegistry } from "../src/workflows/registry.ts";
import { loadRoles, roleIdList } from "../src/agents/loader.ts";

const EXPECTED_IDS = [
	"deepresearch", "lit", "review", "audit", "replicate",
	"recipe", "compare", "draft", "autoresearch", "summarize",
];

describe("workflow registry", () => {
	test("ships exactly the ten workflows", () => {
		const workflows = listWorkflows();
		assert.equal(workflows.length, 10);
		assert.deepEqual(workflows.map((workflow) => workflow.id).sort(), [...EXPECTED_IDS].sort());
	});

	test("every entry has a name, description, agents, and a valid output directory", () => {
		const roles = new Set<string>(roleIdList());
		for (const workflow of listWorkflows()) {
			assert.ok(workflow.name.length > 0, `${workflow.id} name`);
			assert.ok(workflow.description.length > 20, `${workflow.id} description`);
			assert.ok(workflow.agents.length > 0, `${workflow.id} agents`);
			for (const agent of workflow.agents) {
				assert.ok(roles.has(agent), `${workflow.id} names unknown agent ${agent}`);
			}
			assert.ok(workflow.outputDir === "outputs" || workflow.outputDir === "papers", `${workflow.id} outputDir`);
		}
	});

	test("draft writes into papers/, everything else into outputs/", () => {
		assert.equal(getWorkflow("draft").outputDir, "papers");
		for (const id of EXPECTED_IDS.filter((workflowId) => workflowId !== "draft")) {
			assert.equal(getWorkflow(id).outputDir, "outputs", id);
		}
	});

	test("every prompt template loads with frontmatter description and args", () => {
		for (const id of EXPECTED_IDS) {
			const prompt = loadPrompt(id);
			assert.equal(prompt.id, id);
			assert.ok(prompt.description.length > 20, `${id} description`);
			assert.match(prompt.args, /^</, `${id} args should read like <topic>`);
			assert.ok(!prompt.body.startsWith("---"), `${id} frontmatter should be stripped`);
			assert.ok(prompt.body.length > 300, `${id} body too short`);
		}
	});

	test("every prompt stages plan → draft → final artifacts and allows degraded delivery", () => {
		for (const id of EXPECTED_IDS) {
			const { body } = loadPrompt(id);
			assert.match(body, /\.plans\/<slug>\.md/, `${id} stages a plan`);
			assert.match(body, /\.drafts\/<slug>/, `${id} stages a draft`);
			assert.match(body, /provenance/, `${id} stages provenance`);
			assert.match(body, /blocked/i, `${id} documents the degraded path`);
			assert.match(body, /slug/, `${id} derives a slug`);
		}
	});

	test("deepresearch and lit require provenance sidecars explicitly", () => {
		for (const id of ["deepresearch", "lit"]) {
			const { body } = loadPrompt(id);
			assert.match(body, /provenance\.md/, id);
			assert.match(body, /provenance\.json/, id);
		}
	});

	test("registry validation finds no problems", () => {
		assert.deepEqual(validateRegistry(), []);
	});

	test("unknown workflow and unknown role fail loudly", () => {
		assert.throws(() => getWorkflow("blogpost"), /Unknown workflow "blogpost"/);
		assert.equal(isWorkflowId("blogpost"), false);
		assert.equal(isWorkflowId("deepresearch"), true);
		assert.equal(loadRoles().find((role) => role.id === "critic"), undefined);
	});

	test("roles load from markdown personas with frontmatter", () => {
		const roles = loadRoles();
		assert.deepEqual(roles.map((role) => role.id), ["researcher", "verifier", "reviewer", "writer"]);
		for (const role of roles) {
			assert.ok(role.description.length > 10, `${role.id} description`);
			assert.ok(role.body.length > 200, `${role.id} body`);
			assert.match(role.body, /verif|blocked|cite|evidence/i, `${role.id} carries integrity rules`);
		}
	});
});
