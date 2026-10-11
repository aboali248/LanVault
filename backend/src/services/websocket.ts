import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { eventBus, type RealtimeEvent } from "./event-bus";
import { getTokenRole } from "../modules/auth/auth.service";

export function attachWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return;
    if (getTokenRole(url.searchParams.get("token") ?? "") !== "admin") {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  });

  wss.on("connection", (client) => {
    client.send(JSON.stringify({ type: "system.connected", payload: { message: "LanVault realtime channel connected" }, occurredAt: new Date().toISOString() }));
    client.on("error", () => client.close());
  });

  eventBus.on("event", (event: RealtimeEvent) => {
    const data = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  });

  return wss;
}
