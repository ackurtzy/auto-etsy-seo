import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "./env.ts";
import { OperationRepository } from "./repository.ts";

export class ShopCoordinator extends DurableObject<AppEnv> {
  async enqueue(operationId: string): Promise<{ scheduled: boolean }> {
    const key = `operation:${operationId}`;
    const state = await this.ctx.storage.get<"pending" | "scheduled">(key);
    if (state === "scheduled") return { scheduled: true };
    await this.ctx.storage.put(key, "pending");
    try {
      await this.env.OPERATION_WORKFLOW.create({ id: operationId, params: { operationId } });
    } catch (error) {
      const existing = await this.env.OPERATION_WORKFLOW.get(operationId);
      const status = await existing.status();
      if (status.status === "unknown") throw error;
    }
    await this.ctx.storage.put(key, "scheduled");
    await new OperationRepository(this.env.DB).markOutboxStarted(operationId, new Date().toISOString());
    return { scheduled: true };
  }
}
