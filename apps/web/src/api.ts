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
