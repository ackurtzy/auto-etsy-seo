import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { AppEnv } from "./env.ts";
import { executeOrReconcile } from "./runtime.ts";

interface OperationWorkflowParams {
  operationId: string;
}

export class OperationWorkflow extends WorkflowEntrypoint<AppEnv, OperationWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<OperationWorkflowParams>>, step: WorkflowStep): Promise<{ state: string }> {
    let state = await step.do(
      "execute-or-resume-without-mutation-replay",
      { retries: { limit: 3, delay: "1 second", backoff: "exponential" }, timeout: "2 minutes" },
      async () => executeOrReconcile(this.env, event.payload.operationId),
    );
    const delays = ["10 seconds", "1 minute", "5 minutes", "15 minutes"] as const;
    for (const [index, delay] of delays.entries()) {
      if (state !== "unknown" && state !== "dispatching" && state !== "verifying") break;
      await step.sleep(`bounded-reconciliation-delay-${index + 1}`, delay);
      state = await step.do(
        `bounded-reconciliation-read-${index + 1}`,
        { retries: { limit: 2, delay: "5 seconds", backoff: "linear" }, timeout: "1 minute" },
        async () => executeOrReconcile(this.env, event.payload.operationId),
      );
    }
    return { state };
  }
}
