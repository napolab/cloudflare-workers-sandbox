import { Hono } from "hono";

import { wsupgrade } from "../middleware";

export class SharedEvent implements DurableObject {
  private readonly app = new Hono();
  private readonly sessions = new Set<WebSocket>();

  constructor(private readonly state: DurableObjectState) {
    this.app.get("/events", wsupgrade(), async (c) => {
      const pair = new WebSocketPair();
      this.handleSession(pair[1]);

      return new Response(null, { status: 101, webSocket: pair[0] });
    });
    this.app.post("/event", async (c) => {
      const data = await c.req.json();
      const json = JSON.stringify(data);
      for (const socket of this.sessions) {
        socket.send(json);
      }
    });
  }

  private handleSession(socket: WebSocket): void {
    socket.accept();
    this.sessions.add(socket);

    socket.addEventListener("close", () => {
      this.sessions.delete(socket);
      socket.close();
    });
  }

  fetch(request: Request) {
    return this.app.fetch(request);
  }
}
