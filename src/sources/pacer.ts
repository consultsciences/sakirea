// Request pacing. Every upstream service Sakirea talks to publishes a
// per-second or per-interval budget (arXiv asks for one request every three
// seconds; Crossref's public pool allows one per second). Pacing serializes
// requests per host so concurrent tool calls cannot burst past those budgets.
export type PacerRun = <T>(minGapMs: number, run: () => Promise<T>) => Promise<T>;

export function createRequestPacer(): PacerRun {
	let queue: Promise<unknown> = Promise.resolve();
	let lastStartedAt = Number.NEGATIVE_INFINITY;
	return <T>(minGapMs: number, run: () => Promise<T>): Promise<T> => {
		const next = queue.then(async () => {
			const wait = lastStartedAt + minGapMs - Date.now();
			if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
			lastStartedAt = Date.now();
			return run();
		});
		queue = next.catch(() => {});
		return next;
	};
}

// Minimum gap between consecutive requests to the same host, in milliseconds.
export const HOST_MIN_GAP_MS: Record<string, number> = {
	"export.arxiv.org": 3000,
	"api.crossref.org": 1200,
	"api.openalex.org": 1100,
	"api.semanticscholar.org": 1100,
	"eutils.ncbi.nlm.nih.gov": 400,
	"www.ebi.ac.uk": 300,
	"api.biorxiv.org": 300,
	"html.duckduckgo.com": 1000,
	"huggingface.co": 300,
};

export const DEFAULT_MIN_GAP_MS = 300;

const pacers = new Map<string, PacerRun>();

export function minGapFor(host: string): number {
	return HOST_MIN_GAP_MS[host] ?? DEFAULT_MIN_GAP_MS;
}

/** Pace one request for `host`; the gap comes from HOST_MIN_GAP_MS. */
export function pace<T>(host: string, run: () => Promise<T>): Promise<T> {
	let pacer = pacers.get(host);
	if (!pacer) {
		pacer = createRequestPacer();
		pacers.set(host, pacer);
	}
	return pacer(minGapFor(host), run);
}

/** Clear every host queue. Tests use this to avoid cross-test waits. */
export function resetPacers(): void {
	pacers.clear();
}
