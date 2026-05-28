/**
 * RoomHub Durable Object — per-room WebSocket hub for real-time queue broadcasts.
 * Uses the Hibernation API so idle connections cost zero CPU.
 */
export class RoomHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // ── WebSocket upgrade (client connects) ─────────────────────────────────
    if (request.headers.get("Upgrade") === "websocket") {
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);

      // Send initial snapshot if provided
      const initialData = url.searchParams.get("initial");
      if (initialData) {
        try {
          server.send(decodeURIComponent(initialData));
        } catch {
          // ignore: client might close before first message
        }
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── Broadcast endpoint (called by Worker after DB mutation) ─────────────
    if (url.pathname.endsWith("/broadcast") && request.method === "POST") {
      const data = await request.json();
      const sockets = this.state.getWebSockets();
      for (const ws of sockets) {
        try {
          ws.send(JSON.stringify(data));
        } catch {
          // socket already closed — ignore
        }
      }
      return Response.json({ ok: true, broadcast_to: sockets.length });
    }

    return new Response("Not found", { status: 404 });
  }

  // ── Hibernation API callbacks ────────────────────────────────────────────
  webSocketMessage(ws, message) {
    if (message === "ping") ws.send("pong");
  }

  webSocketClose(_ws, _code, _reason) {}

  webSocketError(_ws, _error) {}
}
