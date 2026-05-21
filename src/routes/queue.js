import { Hono } from "hono";
import {
  ACTIVE_QUEUE_STATUSES,
  QUEUE_STATUS,
  WAITING_QUEUE_STATUSES,
} from "../lib/constants.js";
import { authMiddleware, requireRole, requireRoomAccess } from "../middleware/auth.js";
import { getDb } from "../lib/mongo.js";
import {
  createQueueItem,
  ensureRoomExists,
  findLatestActiveQueueForPatientRoom,
  findPatientById,
  findQueueById,
  getRoomQueues,
  moveQueuePosition,
  parsePatientPayload,
  parseQrContent,
  parseQueueId,
  toQueueView,
  updateQueueStatus,
  upsertPatient,
} from "../lib/queue-service.js";

const route = new Hono();

function canAccessRoom(auth, roomId) {
  if (!auth) return false;
  if (auth.role === "super_admin") return true;
  return Array.isArray(auth.allowed_rooms) && auth.allowed_rooms.includes(roomId);
}

function isValidQueueStatus(status) {
  return Object.values(QUEUE_STATUS).includes(status);
}

async function ensureQueueRoomAccessOrThrow(c, queue) {
  const auth = c.get("auth");
  if (!canAccessRoom(auth, queue.room_id)) {
    return c.json({ ok: false, error: "forbidden_room_access" }, 403);
  }
  return null;
}

route.get(
  "/v1/queue",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse", "receptionist"]),
  requireRoomAccess("room_id"),
  async (c) => {
    const db = getDb();
    const roomId = String(c.req.query("room_id") || "").trim();
    const statusRaw = String(c.req.query("status") || "").trim();
    if (!roomId) {
      return c.json({ ok: false, error: "room_id_required" }, 400);
    }
    const statuses = statusRaw
      ? statusRaw
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item && isValidQueueStatus(item))
      : ACTIVE_QUEUE_STATUSES;
    const effectiveStatuses = statuses.length > 0 ? statuses : ACTIVE_QUEUE_STATUSES;

    const docs = await getRoomQueues(db, roomId, effectiveStatuses);
    const items = [];
    for (const doc of docs) {
      items.push(await toQueueView(db, doc));
    }

    return c.json({ ok: true, room_id: roomId, items, total: items.length });
  }
);

route.post(
  "/v1/queue/scan",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse", "receptionist"]),
  requireRoomAccess("room_id"),
  async (c) => {
    const db = getDb();
    const auth = c.get("auth");
    const body = c.get("requestBody") || {};
    const roomId = String(body.room_id || "").trim();
    const rawQrContent = String(body.qr_content || body.qr || "").trim();

    if (!roomId) {
      return c.json({ ok: false, error: "room_id_required" }, 400);
    }

    const parsedQr = parseQrContent(rawQrContent);
    if (!parsedQr) {
      return c.json({ ok: false, error: "invalid_qr_content" }, 400);
    }

    let patient = null;

    if (parsedQr.type === "uri") {
      patient = await findPatientById(db, parsedQr.patient_id);
      if (!patient) {
        return c.json({ ok: false, error: "patient_not_found" }, 404);
      }
    } else {
      patient = await upsertPatient(db, parsedQr.patient || parsePatientPayload(parsedQr.source_payload || {}));
    }

    await ensureRoomExists(db, roomId);

    const existingQueue = await findLatestActiveQueueForPatientRoom(db, patient._id, roomId);
    if (existingQueue) {
      if (existingQueue.status === QUEUE_STATUS.CHO_KET_QUA) {
        const updatedQueue = await updateQueueStatus(db, {
          queue: existingQueue,
          status: QUEUE_STATUS.CHO_TAI_KHAM,
          actorUserId: auth.user_id,
          note: "auto_return_for_result_scan",
          eventType: "AUTO_RETURN_FOR_RESULT",
        });

        return c.json({
          ok: true,
          action: "AUTO_CHO_TAI_KHAM",
          patient: {
            id: String(patient._id),
            patient_key: patient.patient_key,
            full_name: patient.full_name,
            is_priority: !!patient.is_priority,
          },
          queue: await toQueueView(db, updatedQueue),
        });
      }

      return c.json({
        ok: true,
        action: "QUEUE_EXISTS",
        patient: {
          id: String(patient._id),
          patient_key: patient.patient_key,
          full_name: patient.full_name,
          is_priority: !!patient.is_priority,
        },
        queue: await toQueueView(db, existingQueue),
      });
    }

    const newQueue = await createQueueItem({
      db,
      patient,
      roomId,
      isPriority: !!patient.is_priority,
      createdBy: auth.user_id,
      note: "scan_create_queue",
    });

    return c.json({
      ok: true,
      action: "QUEUE_CREATED",
      patient: {
        id: String(patient._id),
        patient_key: patient.patient_key,
        full_name: patient.full_name,
        is_priority: !!patient.is_priority,
      },
      queue: await toQueueView(db, newQueue),
    });
  }
);

route.put(
  "/v1/queue/:id/call",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse"]),
  async (c) => {
    const db = getDb();
    const auth = c.get("auth");
    let queueId;
    try {
      queueId = parseQueueId(c.req.param("id"));
    } catch {
      return c.json({ ok: false, error: "invalid_queue_id" }, 400);
    }
    const queue = await findQueueById(db, queueId);
    if (!queue) {
      return c.json({ ok: false, error: "queue_not_found" }, 404);
    }

    const accessError = await ensureQueueRoomAccessOrThrow(c, queue);
    if (accessError) return accessError;

    if (!WAITING_QUEUE_STATUSES.includes(queue.status)) {
      return c.json({ ok: false, error: "queue_not_in_waiting_state" }, 409);
    }

    const existingProcessing = await db.collection("queues").findOne({
      room_id: queue.room_id,
      status: QUEUE_STATUS.DANG_KHAM,
      _id: { $ne: queue._id },
    });
    if (existingProcessing) {
      return c.json({ ok: false, error: "another_patient_processing" }, 409);
    }

    const updated = await updateQueueStatus(db, {
      queue,
      status: QUEUE_STATUS.DANG_KHAM,
      actorUserId: auth.user_id,
      note: "called_to_exam",
      eventType: "CALL_PATIENT",
    });

    return c.json({ ok: true, queue: await toQueueView(db, updated) });
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
    let queueId;
    try {
      queueId = parseQueueId(c.req.param("id"));
    } catch {
      return c.json({ ok: false, error: "invalid_queue_id" }, 400);
    }
    const queue = await findQueueById(db, queueId);
    if (!queue) {
      return c.json({ ok: false, error: "queue_not_found" }, 404);
    }

    const accessError = await ensureQueueRoomAccessOrThrow(c, queue);
    if (accessError) return accessError;

    if (queue.status !== QUEUE_STATUS.DANG_KHAM) {
      return c.json({ ok: false, error: "queue_not_in_exam_state" }, 409);
    }

    const updated = await updateQueueStatus(db, {
      queue,
      status: QUEUE_STATUS.HOAN_THANH,
      actorUserId: auth.user_id,
      note: body.note || "completed",
      eventType: "COMPLETE_PATIENT",
    });

    return c.json({ ok: true, queue: await toQueueView(db, updated) });
  }
);

route.patch(
  "/v1/queue/:id/status",
  authMiddleware,
  async (c) => {
    const db = getDb();
    const auth = c.get("auth");
    const body = await c.req.json().catch(() => ({}));
    const nextStatus = String(body.status || "").trim();
    const note = String(body.note || "").trim();

    if (!isValidQueueStatus(nextStatus)) {
      return c.json({ ok: false, error: "invalid_status" }, 400);
    }

    let queueId;
    try {
      queueId = parseQueueId(c.req.param("id"));
    } catch {
      return c.json({ ok: false, error: "invalid_queue_id" }, 400);
    }
    const queue = await findQueueById(db, queueId);
    if (!queue) {
      return c.json({ ok: false, error: "queue_not_found" }, 404);
    }

    const accessError = await ensureQueueRoomAccessOrThrow(c, queue);
    if (accessError) return accessError;

    if (nextStatus === QUEUE_STATUS.DANG_KHAM) {
      const existingProcessing = await db.collection("queues").findOne({
        room_id: queue.room_id,
        status: QUEUE_STATUS.DANG_KHAM,
        _id: { $ne: queue._id },
      });
      if (existingProcessing) {
        return c.json({ ok: false, error: "another_patient_processing" }, 409);
      }
    }

    const updated = await updateQueueStatus(db, {
      queue,
      status: nextStatus,
      actorUserId: auth.user_id,
      note: note || "manual_status_update",
      eventType: "STATUS_MANUAL_OVERRIDE",
      payload: {
        source: "manual",
      },
    });

    return c.json({ ok: true, queue: await toQueueView(db, updated) });
  }
);

route.patch(
  "/v1/queue/:id/position",
  authMiddleware,
  requireRole(["super_admin", "admin", "nurse"]),
  requireRoomAccess("room_id"),
  async (c) => {
    const db = getDb();
    const body = c.get("requestBody") || {};
    const roomId = String(body.room_id || "").trim();
    const targetQueueId = body.target_queue_id ? String(body.target_queue_id).trim() : null;
    const mode = String(body.mode || "before").trim();
    const orderedIds = Array.isArray(body.ordered_ids) ? body.ordered_ids : null;

    if (!roomId) {
      return c.json({ ok: false, error: "room_id_required" }, 400);
    }

    let queueId;
    try {
      queueId = parseQueueId(c.req.param("id"));
    } catch {
      return c.json({ ok: false, error: "invalid_queue_id" }, 400);
    }
    const queue = await findQueueById(db, queueId);
    if (!queue) {
      return c.json({ ok: false, error: "queue_not_found" }, 404);
    }

    const accessError = await ensureQueueRoomAccessOrThrow(c, queue);
    if (accessError) return accessError;

    try {
      await moveQueuePosition(db, {
        queueId,
        roomId,
        targetQueueId,
        mode,
        orderedIds,
      });
    } catch (error) {
      const message = String(error?.message || "");
      const statusCode =
        message === "queue_not_found" ? 404 :
        message === "queue_room_mismatch" ? 400 :
        message === "queue_not_movable" ? 409 :
        message === "queue_not_in_waiting_list" ? 409 :
        message === "target_queue_not_found" ? 404 :
        message === "invalid_position_mode" ? 400 :
        message === "ordered_ids_mismatch" ? 400 :
        400;
      return c.json({ ok: false, error: message || "position_update_failed" }, statusCode);
    }

    const items = [];
    const docs = await getRoomQueues(db, roomId, ACTIVE_QUEUE_STATUSES);
    for (const doc of docs) {
      items.push(await toQueueView(db, doc));
    }

    return c.json({ ok: true, room_id: roomId, items, total: items.length });
  }
);

export default route;
