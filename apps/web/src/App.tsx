import { useMemo, useState, type FormEvent } from "react";
import { useAuth, UserButton } from "@clerk/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, Phase3Api, type CommandInput, type OperationReceipt, type Scope } from "./api.ts";

const activeStates = new Set(["queued", "validating", "prepared", "dispatching", "verifying", "unknown"]);

function tomorrow(): string { return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); }

export function App() {
  const { getToken } = useAuth();
  const api = useMemo(() => new Phase3Api(getToken), [getToken]);
  const [scope, setScope] = useState<Scope>({ tenantId: "", shopId: "" });
  const [form, setForm] = useState<CommandInput>({
    idempotencyKey: crypto.randomUUID(), listingId: "", baselineTitle: "", proposedTitle: "",
    approvalExpiresAt: tomorrow(), authority: { tenantEpoch: 1, shopEpoch: 1, capabilityEpoch: 1 },
  });
  const [operationId, setOperationId] = useState<string | null>(null);
  const operation = useQuery({
    queryKey: ["operation", scope, operationId],
    queryFn: () => api.operation(scope, operationId!),
    enabled: operationId !== null && scope.tenantId.length > 0 && scope.shopId.length > 0,
    refetchInterval: (query) => activeStates.has(query.state.data?.state ?? "") ? 5_000 : false,
  });
  const submit = useMutation({
    mutationFn: () => api.createTitleCommand(scope, form),
    onSuccess: (receipt) => setOperationId(receipt.id),
  });
  const keep = useMutation({ mutationFn: (receipt: OperationReceipt) => api.keep(scope, receipt.id), onSuccess: (receipt) => setOperationId(receipt.id) });
  const revert = useMutation({ mutationFn: (receipt: OperationReceipt) => api.revert(scope, receipt, form.authority), onSuccess: (receipt) => setOperationId(receipt.id) });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit.mutate();
  }

  const displayed = operation.data;
  const error = submit.error ?? operation.error ?? keep.error ?? revert.error;
  return <main>
    <header className="topbar">
      <div><span className="eyebrow">Phase 3 · human-approved title operation</span><h1>Review the exact Etsy change</h1></div>
      <UserButton />
    </header>
    <p className="lede">This executor changes only the title. It reads Etsy immediately before dispatch, writes once, and blocks further work if the result is uncertain.</p>

    <section className="panel" aria-labelledby="scope-heading">
      <h2 id="scope-heading">Authorized scope</h2>
      <div className="grid two">
        <Field label="Tenant ID" value={scope.tenantId} onChange={(tenantId) => setScope({ ...scope, tenantId })} />
        <Field label="Shop connection ID" value={scope.shopId} onChange={(shopId) => setScope({ ...scope, shopId })} />
      </div>
    </section>

    <form className="panel" onSubmit={onSubmit}>
      <h2>Exact title diff</h2>
      <Field label="Etsy listing ID" value={form.listingId} onChange={(listingId) => setForm({ ...form, listingId })} inputMode="numeric" />
      <div className="diff-grid">
        <TitleField label="Current approved baseline" tone="before" value={form.baselineTitle} onChange={(baselineTitle) => setForm({ ...form, baselineTitle })} />
        <TitleField label="Exact proposed title" tone="after" value={form.proposedTitle} onChange={(proposedTitle) => setForm({ ...form, proposedTitle })} />
      </div>
      <fieldset>
        <legend>Authority revisions</legend>
        <div className="grid three">
          {(["tenantEpoch", "shopEpoch", "capabilityEpoch"] as const).map((key) => <Field key={key} label={labelFor(key)} type="number" value={String(form.authority[key])} onChange={(value) => setForm({ ...form, authority: { ...form.authority, [key]: Number(value) } })} />)}
        </div>
      </fieldset>
      <div className="warning"><strong>Dispatch rule:</strong> approval is bound to these exact values and expires within 24 hours. A baseline conflict, revocation, kill switch, or gate mismatch prevents the PATCH.</div>
      <button className="primary" disabled={submit.isPending || !scope.tenantId || !scope.shopId || !form.listingId || !form.baselineTitle || !form.proposedTitle}>
        {submit.isPending ? "Accepting command…" : "Approve exact title command"}
      </button>
    </form>

    {error && <div className="error" role="alert">{humanError(error)}</div>}
    {displayed && <Receipt operation={displayed} onKeep={() => keep.mutate(displayed)} onRevert={() => revert.mutate(displayed)} busy={keep.isPending || revert.isPending} />}
  </main>;
}

function Receipt({ operation, onKeep, onRevert, busy }: { operation: OperationReceipt; onKeep: () => void; onRevert: () => void; busy: boolean }) {
  const recovery = operation.state === "unknown" || operation.state === "manual_required" || operation.state === "conflict";
  return <section className={`panel receipt state-${operation.state}`} aria-live="polite">
    <div className="receipt-head"><div><span className="eyebrow">Immutable operation receipt</span><h2>{operation.state.replaceAll("_", " ")}</h2></div><code>{operation.id}</code></div>
    <dl>
      <div><dt>Listing</dt><dd>{operation.listingId}</dd></div>
      <div><dt>Mutation attempt</dt><dd>{operation.dispatchedAt ? "Recorded before network I/O" : "Not dispatched"}</dd></div>
      <div><dt>Verification</dt><dd>{operation.verificationKind ?? "Not verified"}</dd></div>
      <div><dt>Reconciliation reads</dt><dd>{operation.reconciliationReads}</dd></div>
    </dl>
    <div className="diff-grid compact"><DiffValue label="Before" value={operation.baselineTitle} /><DiffValue label="Desired" value={operation.proposedTitle} /></div>
    {recovery && <div className="recovery" role="status"><strong>No blind retry is available.</strong><p>{recoveryCopy(operation)}</p>{operation.failureCode && <code>{operation.failureCode}</code>}</div>}
    {operation.state === "verified" && operation.kind === "apply" && <div className="actions">
      <button className="secondary" disabled={busy} onClick={onKeep}>Verify and keep</button>
      <button className="danger" disabled={busy} onClick={onRevert}>Authorize conditional title revert</button>
    </div>}
  </section>;
}

function Field({ label, value, onChange, type="text", inputMode }: { label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: "numeric" }) {
  return <label><span>{label}</span><input type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} required /></label>;
}
function TitleField({ label, value, onChange, tone }: { label: string; value: string; onChange: (value: string) => void; tone: string }) {
  return <label className={`title-field ${tone}`}><span>{label}</span><textarea value={value} maxLength={140} onChange={(event) => onChange(event.target.value)} required /><small>{Array.from(value).length} / 140 characters</small></label>;
}
function DiffValue({ label, value }: { label: string; value: string }) { return <div className="diff-value"><strong>{label}</strong><p>{value}</p></div>; }
function labelFor(key: keyof CommandInput["authority"]): string { return key.replace("Epoch", " authority epoch").replace(/^./, (v) => v.toUpperCase()); }
function humanError(error: Error): string { return error instanceof ApiError ? `The operation was not accepted: ${error.code.replaceAll("_", " ")}.` : "The request failed without changing Etsy."; }
function recoveryCopy(operation: OperationReceipt): string {
  if (operation.state === "conflict") return "The current Etsy title differs from the approved baseline or last verified experiment title. The current owner state is preserved.";
  if (operation.state === "manual_required") return "Bounded reconciliation ended without a safe conclusion. This shop’s write lane remains blocked until an owner resolves it.";
  return "The request may have reached Etsy. The executor will only read and reconcile; it will not send the mutation again.";
}
