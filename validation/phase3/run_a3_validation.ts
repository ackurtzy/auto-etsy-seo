import { Phase3Executor } from "../../packages/operations/src/index.ts";

const faultMatrix = await Phase3Executor.runFaultMatrix();
const passed = faultMatrix.every((outcome) => outcome.passed);

process.stdout.write(`${JSON.stringify({
  schema_version: "a3-local-validation-v1",
  passed,
  external_requests: 0,
  fault_matrix: faultMatrix,
  contracts: {
    executor: "title-v1",
    credential_encryption: "aes-gcm-256-v1",
    operation_state: "phase3-operation-v1",
    oauth: "etsy-pkce-v1",
    recovery_manifest: "phase3-backup-manifest-v1",
  },
  boundaries: {
    deployed_cloudflare_integration: "not_run",
    live_etsy_canary: "not_run",
    owner_h3: "not_run",
    title_t3: "disabled",
    tags_t3: "disabled",
  },
}, null, 2)}\n`);
