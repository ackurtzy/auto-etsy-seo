import type { GateId } from "../../../packages/gates/src/index.ts";
import { GateRepository, type GateEvidenceItemInput } from "./gate-repository.ts";

interface Scope { tenantId: string; shopId: string; actorId: string }

const G2_EVIDENCE_SHA256 = "5680a68435a639818cd10bc487c993d0e06669173bdef8cbbbafab1dd13c3282";
const G3_LOCAL_EVIDENCE_SHA256 = "d42c8b5605a71bd7d92f8dfcca64791461e222551f60484cdeb7e4d4e0f43cd0";

const interpretationProtocol: Array<readonly [string, string, string]> = [
  ["six-clusters", "Six clusters", "Confirm you understand that the smallest exact two-sided p-value cannot reach 0.05, so launch is rejected."],
  ["eight-clusters", "Eight clusters", "Confirm that assignment resolution alone does not establish useful power."],
  ["unequal-clusters", "Unequal clusters", "Confirm that listing-days are weighted by listings and are not interchangeable visitor samples."],
  ["before-after", "Before and after", "Confirm that this route reports directional change only, with no causal confidence or winner probability."],
  ["heterogeneous-effects", "Heterogeneous effects", "Confirm that the sharp-null test and average-effect interval answer different questions and may disagree."],
  ["shop-route", "This shop", "Accept the directional-only route. Randomized inference and automatic winner decisions remain disabled."],
];
const interpretationItems: GateEvidenceItemInput[] = interpretationProtocol.map(([itemId, label, instructions]) => ({ itemId: `interpretation-${itemId}`, category: "interpretation", label, instructions, required: true, comparison: { disposition: itemId === "shop-route" ? "directional_only_randomized_disabled" : "understood" } }));

const faultDetails = [
  "Acceptance crash leaves no command or outbox", "Stale authority creates no dispatchable work", "Duplicate submission converges",
  "Authority is revalidated before dispatch", "Potential-send marker forbids replay", "Lost response reconciles with one mutation",
  "Verification persistence recovers by read", "Bounded reconciliation retains the shop lane", "Revert owns title only",
  "A newer owner title is preserved", "Revocation boundary is explicit", "Mutation retry storms are impossible",
  "Partial deployment blocks the lane", "Restored state remains quarantined", "Notification failure suspends exposure",
];
const h3Steps = [
  "Confirm the exact low-risk listing and truthful temporary title", "Submit the same command twice and verify one mutation",
  "Verify the exact title directly in Etsy", "Preserve an unrelated description edit during revert",
  "Protect a newer owner title from a conflicting revert", "Reconcile a lost response without a second write",
  "Verify before- and after-dispatch revocation behavior", "Receive the incident notification and recovery link",
  "Restore into isolated staging with Etsy egress disabled",
];

export async function prepareGateProtocol(repository: GateRepository, scope: Scope, gateId: Exclude<GateId, "G1">, now: Date) {
  if (!await repository.dependenciesReady(scope, gateId)) throw new Error("gate_dependency_not_approved");
  const at = now.toISOString();
  const input = gateId === "G2" ? {
    gateId,
    protocolVersion: "h2-interpretation-v1",
    buildVersion: "phase4-gates-v1",
    evidenceRevision: `g2:a2:${G2_EVIDENCE_SHA256.slice(0, 12)}`,
    evidenceSha256: G2_EVIDENCE_SHA256,
    automatedEvidencePassed: true,
    enabledOutcomeMetrics: [],
    items: interpretationItems,
  } : {
    gateId,
    protocolVersion: "g3-deployed-safety-and-h3-v1",
    buildVersion: "phase4-gates-v1",
    evidenceRevision: `g3:local-only:${G3_LOCAL_EVIDENCE_SHA256.slice(0, 12)}`,
    evidenceSha256: G3_LOCAL_EVIDENCE_SHA256,
    automatedEvidencePassed: false,
    enabledOutcomeMetrics: [],
    items: [
      ...faultDetails.map((detail, index): GateEvidenceItemInput => ({
        itemId: `fault-F${String(index + 1).padStart(2, "0")}`, category: "fault", label: `F${String(index + 1).padStart(2, "0")}`,
        instructions: `Run this through the deployed Worker, D1, Durable Object, Workflow, R2, authentication, and notification boundaries: ${detail}.`,
        required: true, comparison: { expectedBehavior: detail, deployedResult: "not_run" },
      })),
      ...h3Steps.map((step, index): GateEvidenceItemInput => ({
        itemId: `human-H3-${String(index + 1).padStart(2, "0")}`, category: "human_step", label: `H3.${index + 1}`,
        instructions: step, required: true, comparison: { observation: "not_run", requiresSeparateLiveAuthorization: true },
      })),
    ],
  };
  const runId = await repository.startRun(scope, input, at);
  return repository.getRun(scope, runId);
}
