import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getDb } from "../lib/mongo.js";
import { getRoomQueues, toQueueView } from "../lib/queue-service.js";
import { ACTIVE_QUEUE_STATUSES, WAITING_QUEUE_STATUSES } from "../lib/constants.js";
import queueEvents from "../lib/queue-events.js";
import { verifyToken } from "../lib/auth.js";

const route = new Hono();

/**
 * GET /v1/events/queue?room_id=<id>&token=<jwt>
 * SSE stream cho admin — token qua query param (EventSource không hỗ trợ custom headers).
 */
route.get(
  "/v1/events/queue",
  async (c) => {
    // Verify JWT from query param (EventSource limitation)
    const rawToken = String(c.req.query("token") || "").trim();
    if (!rawToken) {
      return c.json({ ok: false, error: "token_required" }, 401);
    }
    let auth;
    try {
      auth = verifyToken(rawToken);
    } catch {
      return c.json({ ok: false, error: "invalid_or_expired_token" }, 401);
    }
    if (!auth) {
      return c.json({ ok: false, error: "invalid_or_expired_token" }, 401);
    }
    const db     = getDb();
    const roomId = String(c.req.query("room_id") || "").trim();

    if (!roomId) {
      return c.json({ ok: false, error: "room_id_required" }, 400);
    }

    return streamSSE(c, async (stream) => {
      // Gửi snapshot ngay khi kết nối
      try {
        const roomDoc = await db.collection("rooms").findOne({ room_id: roomId });
        const roomName = roomDoc?.room_name || roomId;
        const docs  = await getRoomQueues(db, roomId, ACTIVE_QUEUE_STATUSES);
        const items = [];
        for (const doc of docs) {
          items.push(await toQueueView(db, doc));
        }
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ roomId, roomName, items }) });
      } catch {
        // Continue — don't crash on snapshot error
      }

      // Lắng nghe updates
      function onUpdate({ roomId: eventRoomId, roomName: eventRoomName, items }) {
        if (String(eventRoomId) !== String(roomId)) return;
        stream.writeSSE({ event: "update", data: JSON.stringify({ roomId, roomName: eventRoomName || roomId, items }) }).catch(() => {});
      }

      queueEvents.on("queue-update", onUpdate);

      // Keep-alive ping mỗi 25 giây
      const pingInterval = setInterval(() => {
        stream.write(": ping\n\n").catch(() => clearInterval(pingInterval));
      }, 25000);

      // Cleanup khi client disconnect
      c.req.raw.signal.addEventListener("abort", () => {
        queueEvents.off("queue-update", onUpdate);
        clearInterval(pingInterval);
      });

      // Giữ stream mở
      await new Promise((resolve) => {
        c.req.raw.signal.addEventListener("abort", resolve);
      });
    });
  }
);

/**
 * GET /v1/events/public?room_id=<id>
 * SSE stream cho màn hình công khai — không yêu cầu auth,
 * chỉ trả về statuses trong WAITING_QUEUE_STATUSES và dữ liệu tối thiểu.
 */
route.get("/v1/events/public", async (c) => {
  const db     = getDb();
  const roomId = String(c.req.query("room_id") || "").trim();

  if (!roomId) {
    return c.json({ ok: false, error: "room_id_required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    // Snapshot ngay khi kết nối
    try {
      const roomDoc = await db.collection("rooms").findOne({ room_id: roomId });
      const roomName = roomDoc?.room_name || roomId;
      const docs  = await getRoomQueues(db, roomId, WAITING_QUEUE_STATUSES);
      const items = [];
      for (const doc of docs) {
        const view = await toQueueView(db, doc);
        items.push(toPublicViewFromView(view));
      }
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ roomId, roomName, items }) });
    } catch {
      // Continue
    }

    function onUpdate({ roomId: eventRoomId, roomName: eventRoomName, items: allItems }) {
      if (String(eventRoomId) !== String(roomId)) return;
      const publicItems = allItems
        .filter((x) => WAITING_QUEUE_STATUSES.includes(x.status))
        .map(toPublicViewFromView);
      stream.writeSSE({ event: "update", data: JSON.stringify({ roomId, roomName: eventRoomName || roomId, items: publicItems }) }).catch(() => {});
    }

    queueEvents.on("queue-update", onUpdate);

    const pingInterval = setInterval(() => {
      stream.write(": ping\n\n").catch(() => clearInterval(pingInterval));
    }, 25000);

    c.req.raw.signal.addEventListener("abort", () => {
      queueEvents.off("queue-update", onUpdate);
      clearInterval(pingInterval);
    });

    await new Promise((resolve) => {
      c.req.raw.signal.addEventListener("abort", resolve);
    });
  });
});

// Minimal public view — không expose PII nhạy cảm
function toPublicViewFromView(view) {
  return {
    queue_id:     view.queue_id,
    queue_number: view.queue_number,
    patient_name: view.patient_name ? view.patient_name.split(" ").slice(-1)[0] : "", // chỉ tên (lastName)
    status:       view.status,
    room_id:      view.room_id,
    is_priority:  view.is_priority,
    order_rank:   view.order_rank,
  };
}

export default route;
