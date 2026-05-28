import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import { getRoomQueues, toQueueView, formatDateKey } from "../lib/queue-service.js";
import { ACTIVE_QUEUE_STATUSES, WAITING_QUEUE_STATUSES } from "../lib/constants.js";
import { verifyToken } from "../lib/auth.js";

const route = new Hono();

/**
 * GET /v1/ws/queue?room_id=<id>&token=<jwt>
 * WebSocket stream for admin — token passed as query param (WS can't set custom headers).
 * Upgrades to the ROOM_HUB Durable Object for the given room.
 */
route.get("/v1/ws/queue", async (c) => {
  const rawToken = String(c.req.query("token") || "").trim();
  if (!rawToken) return c.json({ ok: false, error: "token_required" }, 401);

  try {
    await verifyToken(rawToken, c.env);
  } catch {
    return c.json({ ok: false, error: "invalid_or_expired_token" }, 401);
  }

  const roomId = String(c.req.query("room_id") || "").trim();
  if (!roomId) return c.json({ ok: false, error: "room_id_required" }, 400);

  // Fetch snapshot then forward WS upgrade to DO
  const db = getDb(c.env);
  let initialParam = "";
  try {
    const today = formatDateKey();
    const roomDoc = await db.prepare("SELECT room_name FROM rooms WHERE room_id = ? LIMIT 1").bind(roomId).first();
    const roomName = roomDoc?.room_name || roomId;
    const docs = await getRoomQueues(db, roomId, ACTIVE_QUEUE_STATUSES, today);
    const items = [];
    for (const doc of docs) items.push(await toQueueView(db, doc));
    initialParam = encodeURIComponent(JSON.stringify({ type: "snapshot", roomId, roomName, items }));
  } catch {
    // snapshot optional — continue
  }

  const id = c.env.ROOM_HUB.idFromName(roomId);
  const stub = c.env.ROOM_HUB.get(id);
  const doUrl = `https://do/ws?initial=${initialParam}`;
  return stub.fetch(new Request(doUrl, c.req.raw));
});

/**
 * GET /v1/ws/public?room_id=<id>&date=YYYY-MM-DD
 * WebSocket stream for public display screens — no auth required.
 * Uses a separate DO instance keyed by "public:<roomId>".
 */
route.get("/v1/ws/public", async (c) => {
  const roomId = String(c.req.query("room_id") || "").trim();
  if (!roomId) return c.json({ ok: false, error: "room_id_required" }, 400);

  const dateParam = String(c.req.query("date") || "").trim();
  const db = getDb(c.env);
  let initialParam = "";
  try {
    const today = dateParam || formatDateKey();
    const roomDoc = await db.prepare("SELECT room_name FROM rooms WHERE room_id = ? LIMIT 1").bind(roomId).first();
    const roomName = roomDoc?.room_name || roomId;
    const docs = await getRoomQueues(db, roomId, WAITING_QUEUE_STATUSES, today);
    const items = [];
    for (const doc of docs) {
      const view = await toQueueView(db, doc);
      items.push(toPublicViewFromView(view));
    }
    initialParam = encodeURIComponent(JSON.stringify({ type: "snapshot", roomId, roomName, items, date: today }));
  } catch {
    // snapshot optional
  }

  // Use a separate DO name so public clients don't share the same WS hub as admin
  const id = c.env.ROOM_HUB.idFromName(`public:${roomId}`);
  const stub = c.env.ROOM_HUB.get(id);
  const doUrl = `https://do/ws?initial=${initialParam}`;
  return stub.fetch(new Request(doUrl, c.req.raw));
});

function toPublicViewFromView(view) {
  return {
    queue_id:      view.queue_id,
    patient_name:  view.patient_name || "",
    status:        view.status,
    is_priority:   view.is_priority,
    order_rank:    view.order_rank,
    gender:        view.gender        || "",
    year_of_birth: view.year_of_birth || "",
  };
}

export default route;
