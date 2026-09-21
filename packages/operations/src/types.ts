export type OperationState =
  | "queued"
  | "validating"
  | "prepared"
  | "dispatching"
  | "verifying"
  | "verified"
  | "rejected"
  | "cancelled_before_dispatch"
  | "unknown"
  | "conflict"
  | "manual_required";

export type CapabilityMode = "disabled" | "canary" | "enabled";

export interface CanaryPermit {
  gateId: string;
  listingId: string;
  baselineDigest: string;
  proposedDigest: string;
  expiresAt: string;
}

export interface AuthoritySnapshot {
  actorActive: boolean;
  actorRole: "owner" | "editor" | "viewer";
  tenantEpoch: number;
  shopEpoch: number;
  capabilityEpoch: number;
  capabilityMode: CapabilityMode;
  applicationKillSwitch: boolean;
  shopKillSwitch: boolean;
  scopes: string[];
  canary?: CanaryPermit;
  restoredQuarantine?: boolean;
  notificationsReachable?: boolean;
}

export interface TitleCommandInput {
  id: string;
  idempotencyKey: string;
  tenantId: string;
  shopId: string;
  listingId: string;
  actorId: string;
  baselineTitle: string;
  proposedTitle: string;
  authority: {
    tenantEpoch: number;
    shopEpoch: number;
    capabilityEpoch: number;
  };
  approvalExpiresAt: string;
  parentOperationId?: string;
  kind?: "apply" | "revert" | "keep";
}

export interface ListingSnapshot {
  listingId: string;
  title: string;
  description?: string;
  tags?: string[];
  revision?: string;
}

export interface OperationAttempt {
  id: string;
  operationId: string;
  markedPotentiallySentAt: string;
  result: "pending" | "response_received" | "transport_ambiguous";
  statusCode?: number;
}

export interface TitleOperation {
  id: string;
  requestDigest: string;
  idempotencyKey: string;
  tenantId: string;
  shopId: string;
  listingId: string;
  actorId: string;
  baselineTitle: string;
  proposedTitle: string;
  baselineDigest: string;
  proposedDigest: string;
  authority: TitleCommandInput["authority"];
  approvalExpiresAt: string;
  kind: "apply" | "revert" | "keep";
  parentOperationId?: string;
  state: OperationState;
  version: number;
  acceptedAt: string;
  preparedAt?: string;
  dispatchedAt?: string;
  verifiedAt?: string;
  verificationKind?: "verified_response_and_readback" | "verified_observed_desired_state";
  preWriteSnapshot?: ListingSnapshot;
  lastObservation?: ListingSnapshot;
  reconciliationReads: number;
  failureCode?: string;
}

export interface FaultOutcome {
  id: string;
  passed: boolean;
  detail: string;
}

export interface EtsyTitleService {
  getListing(shopId: string, listingId: string): Promise<ListingSnapshot>;
  patchTitle(shopId: string, listingId: string, title: string): Promise<{ status: number }>;
}
