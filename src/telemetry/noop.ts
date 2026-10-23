// Telemetry: Sakirea has NONE.
//
// Upstream Feynman ships PostHog telemetry (upstream src/telemetry/posthog.ts
// and the posthog-node dependency); Sakirea reimplementation deliberately has
// no analytics client, no event queue, no session id, and no network call on
// any code path in this module. The functions below exist so call sites have a
// stable, obviously-empty surface — calling them changes nothing, and nothing
// is ever buffered or sent.
//
// Privacy summary: Sakirea talks only to the scholarly/web endpoints a run
// explicitly queries. Topics, artifacts, and results never leave the machine
// except as those queries themselves.

export const TELEMETRY_ENABLED = false;
export const TELEMETRY_PROVIDER = "none";

export interface TelemetryEvent {
	name: string;
	properties?: Record<string, string | number | boolean>;
}

/** No-op: no event is recorded, stored, or transmitted. */
export function track(_event: TelemetryEvent): void {
	// intentionally empty
}

/** No-op: there is no queue to flush. */
export async function flush(): Promise<void> {
	return;
}

export function telemetryInfo(): { enabled: boolean; provider: string; note: string } {
	return {
		enabled: TELEMETRY_ENABLED,
		provider: TELEMETRY_PROVIDER,
		note: "Sakirea ships no telemetry: no events are collected, stored, or sent.",
	};
}
