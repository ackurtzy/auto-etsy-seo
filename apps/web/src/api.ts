export type OperationState =
  | "queued" | "validating" | "prepared" | "dispatching" | "verifying" | "verified"
  | "rejected" | "cancelled_before_dispatch" | "unknown" | "conflict" | "manual_required";

export interface OperationReceipt {
  id: string;
  listingId: string;
  state: OperationState;
  kind: "apply" | "revert" | "keep";
  baselineTitle: string;
  proposedTitle: string;
  requestDigest: string;
  acceptedAt: string;
  preparedAt: string | null;
  dispatchedAt: string | null;
  verifiedAt: string | null;
  verificationKind: string | null;
  failureCode: string | null;
  reconciliationReads: number;
}

export interface Scope {
  tenantId: string;
  shopId: string;
}

export interface CommandInput {
  idempotencyKey: string;
  listingId: string;
  baselineTitle: string;
  proposedTitle: string;
  approvalExpiresAt: string;
  authority: { tenantEpoch: number; shopEpoch: number; capabilityEpoch: number };
}

export type GateId = "G1" | "G2" | "G3";
export type GateStatus = "not_started" | "collecting" | "ready_for_review" | "needs_attention" | "approved" | "blocked" | "stale" | "superseded";
export type ReviewOutcome = "matched" | "resolved_difference" | "unavailable_disabled" | "differs" | "cannot_verify";

export interface SessionShop { id: string; externalShopId: string; status: string; }
export interface SessionTenant { id: string; name: string; role: "owner" | "editor" | "viewer"; shops: SessionShop[]; }
export interface SessionResponse { tenants: SessionTenant[]; }

export interface GateEvidenceItem {
  id: string;
  category: "listing" | "receipt" | "views_day" | "interpretation" | "fault" | "human_step";
  label: string;
  instructions: string;
  metricKey: string | null;
  required: boolean;
  comparison: Record<string, unknown>;
  sourceReference: string | null;
  response: { id: string; outcome: ReviewOutcome; note: string; evidence_revision: string; created_at: string } | null;
}

export interface GateWorkspace {
  gate: { id: GateId; title: string; shortTitle: string; description: string; enabledCapabilities: string[]; explicitlyDisabledCapabilities: string[] };
  run: { id: string; protocolVersion: string; buildVersion: string; evidenceRevision: string; evidenceSha256: string } | null;
  review: { status: GateStatus; completed: number; total: number; canApprove: boolean; blockers: string[] };
  items: GateEvidenceItem[];
}

export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export class Phase3Api {
  constructor(private readonly token: () => Promise<string | null>) {}

  async createTitleCommand(scope: Scope, input: CommandInput): Promise<OperationReceipt> {
    return (await this.request<{ operation: OperationReceipt }>(
      `/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/title-commands`,
      { method: "POST", body: JSON.stringify(input) },
    )).operation;
  }

  async session(): Promise<SessionResponse> { return this.request<SessionResponse>("/api/v1/session"); }

  async gates(scope: Scope): Promise<{ gates: GateWorkspace[] }> {
    return this.request<{ gates: GateWorkspace[] }>(`/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/gates`);
  }

  async collectGate1(scope: Scope): Promise<GateWorkspace> {
    return this.request<GateWorkspace>(`/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/gates/G1/collect`, { method: "POST" });
  }

  async prepareGate(scope: Scope, gateId: "G2" | "G3"): Promise<GateWorkspace> {
    return this.request<GateWorkspace>(`/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/gates/${gateId}/prepare`, { method: "POST" });
  }

  async respondToGateItem(scope: Scope, runId: string, itemId: string, input: { outcome: ReviewOutcome; note: string; evidenceRevision: string }): Promise<GateWorkspace> {
    return this.request<GateWorkspace>(`/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/gates/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/responses`, { method: "POST", body: JSON.stringify(input) });
  }

  async approveGate(scope: Scope, runId: string, disposition: string): Promise<GateWorkspace> {
    return this.request<GateWorkspace>(`/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/gates/runs/${encodeURIComponent(runId)}/approve`, { method: "POST", body: JSON.stringify({ disposition }) });
  }

  async uploadGateArtifact(scope: Scope, runId: string, itemId: string, file: File): Promise<{ contentSha256: string; byteLength: number }> {
    const buffer = await file.arrayBuffer();
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((value) => value.toString(16).padStart(2, "0")).join("");
    return this.request(`/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/gates/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/artifacts`, {
      method: "POST", body: file, headers: { "content-type": file.type, "x-content-sha256": sha256 },
    });
  }

  async startEtsyOAuth(tenantId: string, externalShopId: string, accessMode: "read_only" | "title_canary" = "read_only"): Promise<string> {
    const response = await this.request<{ authorizationUrl: string }>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/oauth/etsy/start`, { method: "POST", body: JSON.stringify({ externalShopId, accessMode }) });
    return response.authorizationUrl;
  }

  async operation(scope: Scope, id: string): Promise<OperationReceipt> {
    return (await this.request<{ operation: OperationReceipt }>(
      `/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/operations/${encodeURIComponent(id)}`,
    )).operation;
  }

  async keep(scope: Scope, id: string): Promise<OperationReceipt> {
    return (await this.request<{ operation: OperationReceipt }>(
      `/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/operations/${encodeURIComponent(id)}/keep`,
      { method: "POST", body: JSON.stringify({ idempotencyKey: `${id}:keep` }) },
    )).operation;
  }

  async revert(scope: Scope, operation: OperationReceipt, authority: CommandInput["authority"]): Promise<OperationReceipt> {
    return (await this.request<{ operation: OperationReceipt }>(
      `/api/v1/tenants/${encodeURIComponent(scope.tenantId)}/shops/${encodeURIComponent(scope.shopId)}/operations/${encodeURIComponent(operation.id)}/revert`,
      {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: `${operation.id}:revert`,
          approvalExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          authority,
        }),
      },
    )).operation;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token();
    if (!token) throw new ApiError("unauthorized", 401);
    const response = await fetch(path, {
      ...init,
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    });
    const data = await response.json() as { error?: { code?: string } } & T;
    if (!response.ok) throw new ApiError(data.error?.code ?? "request_failed", response.status);
    return data;
  }
}
