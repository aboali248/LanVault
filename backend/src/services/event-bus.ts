import { EventEmitter } from "node:events";

export interface RealtimeEvent<T = unknown> {
  type: string;
  payload: T;
  occurredAt: string;
}

class LanVaultEventBus extends EventEmitter {
  publish<T>(type: string, payload: T): void {
    this.emit("event", { type, payload, occurredAt: new Date().toISOString() } satisfies RealtimeEvent<T>);
  }
}

export const eventBus = new LanVaultEventBus();
