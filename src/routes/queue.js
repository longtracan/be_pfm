import { Hono } from "hono";
import { ObjectId } from "mongodb";
import {
  authMiddleware,
  requireRole,
  requireRoomAccess,
} from "../middleware/auth.js";
import { getDb } from "../lib/mongo.js";
import { QUEUE_STATUS } from "../lib/constants.js";
import {
  createQueueItem,
  ensureRoomExists,
  parseQueueId,
  toQueueView,
} from "../lib/queue-service.js";

const route = new Hono();

route.get(
  "/v1/queue",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse", "receptionist"]),
  requireRoomAccess("room_id"),
  async (c) => {
    const db = getDb();
    const roomId = c.req.query("room_id");
    const statusRaw = c.req.query("status");
    const statuses = statusRaw
      ? statusRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [QUEUE_STATUS.WAITING, QUEUE_STATUS.PROCESSING];

    const docs = await db
      .collection("queues")
      .find({ room_id: roomId, status: { $in: statuses } })
      .sort({ order: 1, created_at: 1 })
      .toArray();

    const items = [];
    for (const doc of docs) {
      items.push(await toQueueView(db, doc));
    }

    return c.json({ ok: true, room_id: roomId, items, total: items.length });
  }
);

route.put(
  "/v1/queue/:id/call",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse"]),
  async (c) => {
    const db = getDb();
    const auth = c.get("auth");
    const queueId = parseQueueId(c.req.param("id"));
    const queue = await db.collection("queues").findOne({ _id: queueId });
    if (!queue) return c.json({ ok: false, error: "queue_not_found" }, 404);

    if (auth.role !== "super_admin" && !(auth.allowed_rooms || []).includes(queue.room_id)) {
      return c.json({ ok: false, error: "forbidden_room_access" }, 403);
    }

    const existingProcessing = await db.collection("queues").findOne({
      room_id: queue.room_id,
      status: QUEUE_STATUS.PROCESSING,
      _id: { $ne: queue._id },
    });
    if (existingProcessing) {
      return c.json({ ok: false, error: "another_patient_processing" }, 409);
    }

    await db.collection("queues").updateOne(
      { _id: queue._id },
      {
        $set: { status: QUEUE_STATUS.PROCESSING, updated_at: new Date() },
        $push: {
          logs: {
            status: QUEUE_STATUS.PROCESSING,
            time: new Date(),
            user_id: auth.user_id,
            note: "called",
          },
        },
      }
    );

    return c.json({ ok: true, queue_id: String(queue._id), status: QUEUE_STATUS.PROCESSING });
  }
);

route.post(
  "/v1/queue/scan",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse"]),
  requireRoomAccess("room_id"),
  async (c) => {
    const db = getDb();
    const auth = c.get("auth");
    const body = c.get("requestBody") || {};
    const roomId = String(body.room_id || "");
    const qrContent = String(body.qr_content || "");
    const match = qrContent.match(/^pfm:\/\/checkin\/([a-fA-F0-9]{24})$/);
    if (!match) return c.json({ ok: false, error: "invalid_qr_content" }, 400);

    const patientId = new ObjectId(match[1]);
    const queue = await db.collection("queues").findOne({
      patient_id: patientId,
      room_id: roomId,
      status: { $in: [QUEUE_STATUS.WAITING, QUEUE_STATUS.PROCESSING] },
    });
    if (!queue) return c.json({ ok: false, error: "queue_not_found_for_room" }, 404);

    await db.collection("queues").updateOne(
      { _id: queue._id },
      {
        $set: { status: QUEUE_STATUS.PROCESSING, updated_at: new Date() },
        $push: {
          logs: {
            status: QUEUE_STATUS.PROCESSING,
            time: new Date(),
            user_id: auth.user_id,
            note: "scan_kingpos",
          },
        },
      }
    );

    const patient = await db.collection("patients").findOne({ _id: patientId });
    return c.json({
      ok: true,
      queue_id: String(queue._id),
      patient_id: String(patientId),
      patient_name: patient?.full_name || "",
      status: QUEUE_STATUS.PROCESSING,
      room_id: roomId,
      auto_called: true,
    });
  }
);

route.put(
  "/v1/queue/:id/skip",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse"]),
  async (c) => {
    const db = getDb();
    const auth = c.get("auth");
    const body = await c.req.json().catch(() => ({}));
    const queueId = parseQueueId(c.req.param("id"));
    const queue = await db.collection("queues").findOne({ _id: queueId });
    if (!queue) return c.json({ ok: false, error: "queue_not_found" }, 404);

    await db.collection("queues").updateOne(
      { _id: queue._id },
      {
        $set: { status: QUEUE_STATUS.SKIPPED, updated_at: new Date() },
        $push: {
          logs: {
            status: QUEUE_STATUS.SKIPPED,
            time: new Date(),
            user_id: auth.user_id,
            note: body.note || "skipped",
          },
        },
      }
    );
    return c.json({ ok: true, status: QUEUE_STATUS.SKIPPED });
  }
);

route.put(
  "/v1/queue/:id/complete",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse"]),
  async (c) => {
    const db = getDb();
    const auth = c.get("auth");
    const body = await c.req.json().catch(() => ({}));
    const queueId = parseQueueId(c.req.param("id"));
    const queue = await db.collection("queues").findOne({ _id: queueId });
    if (!queue) return c.json({ ok: false, error: "queue_not_found" }, 404);

    const nextRoomId = body.next_room_id ? String(body.next_room_id) : null;
    const endVisit = !!body.end_visit;
    if ((nextRoomId && endVisit) || (!nextRoomId && !endVisit)) {
      return c.json({ ok: false, error: "must_choose_next_room_or_end_visit" }, 400);
    }

    await db.collection("queues").updateOne(
      { _id: queue._id },
      {
        $set: { status: QUEUE_STATUS.COMPLETED, updated_at: new Date() },
        $push: {
          logs: {
            status: QUEUE_STATUS.COMPLETED,
            time: new Date(),
            user_id: auth.user_id,
            note: body.note || "completed",
          },
        },
      }
    );

    if (nextRoomId) {
      await ensureRoomExists(db, nextRoomId);
      const newQueue = await createQueueItem({
        db,
        patientId: queue.patient_id,
        clinicId: queue.clinic_id,
        roomId: nextRoomId,
        isPriority: queue.is_priority,
        createdBy: auth.user_id,
        note: "next_room_after_complete",
      });
      return c.json({
        ok: true,
        status: QUEUE_STATUS.COMPLETED,
        next_action: "NEXT_ROOM",
        next_queue_id: String(newQueue._id),
      });
    }

    return c.json({
      ok: true,
      status: QUEUE_STATUS.COMPLETED,
      next_action: "END_VISIT",
    });
  }
);

route.put(
  "/v1/queue/:id/transfer",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse"]),
  async (c) => {
    const db = getDb();
    const auth = c.get("auth");
    const body = await c.req.json().catch(() => ({}));
    const toRoomId = String(body.to_room_id || "");
    if (!toRoomId) return c.json({ ok: false, error: "to_room_id_required" }, 400);
    await ensureRoomExists(db, toRoomId);

    const queueId = parseQueueId(c.req.param("id"));
    const queue = await db.collection("queues").findOne({ _id: queueId });
    if (!queue) return c.json({ ok: false, error: "queue_not_found" }, 404);

    await db.collection("queues").updateOne(
      { _id: queue._id },
      {
        $set: { status: QUEUE_STATUS.TRANSFERRED, updated_at: new Date() },
        $push: {
          logs: {
            status: QUEUE_STATUS.TRANSFERRED,
            time: new Date(),
            user_id: auth.user_id,
            note: body.note || "manual_transfer",
          },
        },
      }
    );

    const newQueue = await createQueueItem({
      db,
      patientId: queue.patient_id,
      clinicId: queue.clinic_id,
      roomId: toRoomId,
      isPriority: queue.is_priority,
      createdBy: auth.user_id,
      note: "transfer",
    });

    return c.json({
      ok: true,
      new_queue_id: String(newQueue._id),
      status: QUEUE_STATUS.WAITING,
      room_id: toRoomId,
    });
  }
);

route.patch(
  "/v1/queue/reorder",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse"]),
  requireRoomAccess("room_id"),
  async (c) => {
    const db = getDb();
    const body = c.get("requestBody") || {};
    const roomId = String(body.room_id || "");
    const orderList = Array.isArray(body.order) ? body.order : [];
    if (!roomId || orderList.length === 0) {
      return c.json({ ok: false, error: "room_id_and_order_required" }, 400);
    }

    let updated = 0;
    for (let i = 0; i < orderList.length; i += 1) {
      const id = orderList[i];
      if (!ObjectId.isValid(id)) continue;
      const res = await db.collection("queues").updateOne(
        { _id: new ObjectId(id), room_id: roomId },
        { $set: { order: i + 1, updated_at: new Date() } }
      );
      updated += res.modifiedCount;
    }

    return c.json({ ok: true, updated });
  }
);

export default route;
