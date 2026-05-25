import { ObjectId } from "mongodb";
import {
  ACTIVE_QUEUE_STATUSES,
  QUEUE_STATUS,
  WAITING_QUEUE_STATUSES,
} from "./constants.js";

const HO_CHI_MINH_TIMEZONE = "Asia/Ho_Chi_Minh";

function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  return new ObjectId(value);
}

export function formatDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: HO_CHI_MINH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

export function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

export function parsePatientPayload(raw = {}) {
  const medicalCode = normalizeText(
    raw.medical_code ?? raw.medicalCode ?? raw.mayte ?? raw.ma_y_te ?? ""
  );
  const identityNumber = normalizeText(
    raw.identity_number ?? raw.identityNumber ?? raw.socmt ?? raw.cccd ?? raw.cmnd ?? ""
  );

  return {
    medical_code: medicalCode,
    identity_number: identityNumber,
    patient_key: medicalCode && identityNumber ? `${medicalCode}|${identityNumber}` : "",
    full_name: String(raw.full_name ?? raw.fullName ?? raw.hoten ?? raw.name ?? "").trim(),
    dob: String(raw.dob ?? raw.namsinh ?? raw.ngaysinh ?? "").trim(),
    gender: String(raw.gender ?? raw.gioitinh ?? "").trim(),
    address: String(raw.address ?? raw.diachi ?? "").trim(),
    address_cv30: String(raw.address_cv30 ?? raw.diachi_cv30 ?? "").trim(),
    is_priority: toBoolean(raw.is_priority ?? raw.isPriority ?? false),
    is_online_booking: toBoolean(raw.is_online_booking ?? raw.isOnlineBooking ?? false),
    source_payload: raw,
  };
}

export function parseQrContent(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  const uriMatch = value.match(/^pfm:\/\/checkin\/([a-fA-F0-9]{24})$/);
  if (uriMatch) {
    return {
      type: "uri",
      patient_id: uriMatch[1],
      raw: value,
    };
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const patient = parsePatientPayload(parsed);
    return {
      type: "json",
      raw: value,
      patient,
      source_payload: parsed,
      qr_dts: parsed.QR_DTS === true,
    };
  } catch {
    return null;
  }
}

export function buildPatientQrPayload(patientDoc) {
  return {
    patient_id: String(patientDoc._id),
    patient_key: patientDoc.patient_key,
    medical_code: patientDoc.medical_code,
    identity_number: patientDoc.identity_number,
    full_name: patientDoc.full_name,
    dob: patientDoc.dob,
    gender: patientDoc.gender || "",
    address: patientDoc.address || "",
    address_cv30: patientDoc.address_cv30 || "",
    is_priority: !!patientDoc.is_priority,
    QR_DTS: true,
  };
}

export async function ensureRoomExists(db, roomId) {
  const room = await db.collection("rooms").findOne({ room_id: roomId, is_active: true });
  if (!room) {
    throw new Error(`room_not_found:${roomId}`);
  }
  return room;
}

export async function nextQueueNumber(db, roomId) {
  const res = await db.collection("counters").findOneAndUpdate(
    { room_id: roomId, date_key: formatDateKey(), type: "queue_number" },
    { $inc: { value: 1 }, $setOnInsert: { created_at: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  return res.value.value;
}

export async function appendQueueEvent(db, event) {
  const now = new Date();
  await db.collection("queue_events").insertOne({
    event_type: event.event_type || "STATUS_CHANGED",
    queue_id: event.queue_id ? toObjectId(event.queue_id) : null,
    room_id: event.room_id || null,
    from_status: event.from_status || null,
    to_status: event.to_status || null,
    actor_user_id: event.actor_user_id || "system",
    note: event.note || "",
    payload: event.payload || null,
    occurred_at: event.occurred_at || now,
  });
}

async function nextOrderRank(db, roomId, isPriority) {
  const priorityRank = isPriority ? 0 : 1;
  const filter = {
    room_id: roomId,
    status: { $in: WAITING_QUEUE_STATUSES },
    priority_rank: priorityRank,
  };
  const docs = await db
    .collection("queues")
    .find(filter)
    .sort({ order_rank: 1, created_at: 1 })
    .toArray();

  if (docs.length === 0) return 1;

  const ranks = docs.map((item) => Number(item.order_rank || 0)).filter((n) => Number.isFinite(n));
  if (ranks.length === 0) return 1;
  return Math.max(...ranks) + 1;
}

export async function createQueueItem({
  db,
  patient,
  roomId,
  isPriority,
  createdBy,
  note,
}) {
  const room = await ensureRoomExists(db, roomId);
  const queueNumber = await nextQueueNumber(db, roomId);
  const now = new Date();
  const priorityRank = isPriority ? 0 : 1;
  const orderRank = await nextOrderRank(db, roomId, isPriority);

  const item = {
    patient_id: toObjectId(patient._id),
    patient_key: patient.patient_key,
    room_id: roomId,
    floor_id: room.floor_id || null,
    queue_date: formatDateKey(now),
    status: QUEUE_STATUS.CHO_KHAM,
    queue_number: queueNumber,
    is_priority: !!isPriority,
    priority_rank: priorityRank,
    order_rank: orderRank,
    arrived_at: now,
    called_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };

  const inserted = await db.collection("queues").insertOne(item);
  const queueId = inserted.insertedId;

  await appendQueueEvent(db, {
    event_type: "QUEUE_CREATED",
    queue_id: queueId,
    room_id: roomId,
    from_status: null,
    to_status: QUEUE_STATUS.CHO_KHAM,
    actor_user_id: createdBy || "system",
    note: note || "created",
    payload: {
      queue_number: queueNumber,
      is_priority: !!isPriority,
    },
  });

  return { ...item, _id: queueId };
}

export async function findQueueById(db, queueId) {
  if (!ObjectId.isValid(String(queueId))) {
    throw new Error("invalid_queue_id");
  }
  return db.collection("queues").findOne({ _id: toObjectId(queueId) });
}

export async function findLatestActiveQueueForPatientRoom(db, patientId, roomId) {
  return db
    .collection("queues")
    .find({
      patient_id: toObjectId(patientId),
      room_id: roomId,
      status: { $in: ACTIVE_QUEUE_STATUSES },
    })
    .sort({ created_at: -1, order_rank: -1 })
    .limit(1)
    .next();
}

export async function findPatientById(db, patientId) {
  if (!ObjectId.isValid(String(patientId))) {
    return null;
  }
  return db.collection("patients").findOne({ _id: toObjectId(patientId) });
}

export async function findPatientByKey(db, patientKey) {
  const key = String(patientKey || "").trim();
  if (!key) {
    return null;
  }
  return db.collection("patients").findOne({ patient_key: key });
}

export async function upsertPatient(db, patientData) {
  const now = new Date();
  const medicalCode = String(patientData.medical_code || "").trim();
  const identityNumber = String(patientData.identity_number || "").trim();
  const patientKey = String(patientData.patient_key || "").trim();

  if (!medicalCode || !identityNumber || !patientKey) {
    throw new Error("patient_key_required");
  }

  const payload = {
    patient_key: patientKey,
    medical_code: medicalCode,
    identity_number: identityNumber,
    full_name: String(patientData.full_name || "").trim(),
    dob: String(patientData.dob || "").trim(),
    gender: String(patientData.gender || "").trim(),
    address: String(patientData.address || "").trim(),
    address_cv30: String(patientData.address_cv30 || "").trim(),
    is_priority: !!patientData.is_priority,
    is_online_booking: !!patientData.is_online_booking,
    updated_at: now,
  };

  const existing = await db.collection("patients").findOne({ patient_key: patientKey });
  if (existing) {
    if (patientData.source_payload !== undefined) {
      payload.source_payload = patientData.source_payload || null;
    } else if (existing.source_payload !== undefined) {
      payload.source_payload = existing.source_payload;
    }
    await db.collection("patients").updateOne({ _id: existing._id }, { $set: payload });
    return { ...existing, ...payload };
  }

  const inserted = await db.collection("patients").insertOne({
    ...payload,
    source_payload: patientData.source_payload || null,
    created_at: now,
  });
  return {
    _id: inserted.insertedId,
    ...payload,
    created_at: now,
  };
}

export async function updateQueueStatus(db, {
  queue,
  status,
  actorUserId,
  note,
  eventType = "STATUS_CHANGED",
  payload = null,
}) {
  const now = new Date();
  const update = {
    status,
    updated_at: now,
  };

  if (status === QUEUE_STATUS.DANG_KHAM) {
    update.called_at = now;
  }
  if (status === QUEUE_STATUS.HOAN_THANH) {
    update.completed_at = now;
  }

  await db.collection("queues").updateOne(
    { _id: queue._id },
    { $set: update }
  );

  await appendQueueEvent(db, {
    event_type: eventType,
    queue_id: queue._id,
    room_id: queue.room_id,
    from_status: queue.status,
    to_status: status,
    actor_user_id: actorUserId || "system",
    note: note || "",
    payload,
  });

  return {
    ...queue,
    ...update,
  };
}

export async function reindexRoomQueues(db, roomId) {
  const docs = await db
    .collection("queues")
    .find({
      room_id: roomId,
      status: { $in: WAITING_QUEUE_STATUSES },
    })
    .sort({ priority_rank: 1, order_rank: 1, created_at: 1 })
    .toArray();

  let updated = 0;
  for (let i = 0; i < docs.length; i += 1) {
    const queue = docs[i];
    const res = await db.collection("queues").updateOne(
      { _id: queue._id },
      { $set: { order_rank: i + 1, updated_at: new Date() } }
    );
    updated += res.modifiedCount;
  }
  return updated;
}

export async function getRoomQueues(db, roomId, statuses = ACTIVE_QUEUE_STATUSES, date = null) {
  const filter = { room_id: roomId, status: { $in: statuses } };
  if (date) filter.queue_date = date;
  return db
    .collection("queues")
    .find(filter)
    .sort({ priority_rank: 1, order_rank: 1, created_at: 1 })
    .toArray();
}

export async function moveQueuePosition(db, {
  queueId,
  roomId,
  targetQueueId = null,
  mode = "before",
  orderedIds = null,
}) {
  const current = await db.collection("queues").findOne({ _id: toObjectId(queueId) });
  if (!current) {
    throw new Error("queue_not_found");
  }

  if (String(current.room_id) !== String(roomId)) {
    throw new Error("queue_room_mismatch");
  }

  if (!WAITING_QUEUE_STATUSES.includes(current.status)) {
    throw new Error("queue_not_movable");
  }

  const docs = await db
    .collection("queues")
    .find({
      room_id: roomId,
      status: { $in: WAITING_QUEUE_STATUSES },
    })
    .sort({ priority_rank: 1, order_rank: 1, created_at: 1 })
    .toArray();

  const currentIndex = docs.findIndex((item) => String(item._id) === String(current._id));
  if (currentIndex < 0) {
    throw new Error("queue_not_in_waiting_list");
  }

  if (Array.isArray(orderedIds) && orderedIds.length > 0) {
    const requestedIds = orderedIds.map((item) => String(item)).filter(Boolean);
    const currentIds = docs.map((item) => String(item._id));
    const requestedSet = new Set(requestedIds);
    const currentSet = new Set(currentIds);

    if (requestedIds.length !== docs.length) {
      throw new Error("ordered_ids_mismatch");
    }

    for (const id of currentIds) {
      if (!requestedSet.has(id)) {
        throw new Error("ordered_ids_mismatch");
      }
    }

    for (const id of requestedIds) {
      if (!currentSet.has(id)) {
        throw new Error("ordered_ids_mismatch");
      }
    }

    const orderedDocs = requestedIds.map((id) => docs.find((item) => String(item._id) === id));
    let updated = 0;
    for (let i = 0; i < orderedDocs.length; i += 1) {
      const queue = orderedDocs[i];
      const res = await db.collection("queues").updateOne(
        { _id: queue._id },
        { $set: { order_rank: i + 1, updated_at: new Date() } }
      );
      updated += res.modifiedCount;
    }

    return { updated, ordered_ids: requestedIds };
  }

  if (targetQueueId && String(targetQueueId) === String(current._id)) {
    return { updated: 0, ordered_ids: docs.map((item) => String(item._id)) };
  }

  let nextIndex = currentIndex;
  if (targetQueueId) {
    if (!["before", "after"].includes(mode)) {
      throw new Error("invalid_position_mode");
    }
    const targetIndex = docs.findIndex((item) => String(item._id) === String(targetQueueId));
    if (targetIndex < 0) {
      throw new Error("target_queue_not_found");
    }
    docs.splice(currentIndex, 1);
    nextIndex = docs.findIndex((item) => String(item._id) === String(targetQueueId));
    if (nextIndex < 0) {
      throw new Error("target_queue_not_found");
    }
    const insertAt = mode === "after" ? nextIndex + 1 : nextIndex;
    docs.splice(insertAt, 0, current);
  } else if (mode === "top") {
    docs.splice(currentIndex, 1);
    docs.unshift(current);
  } else if (mode === "bottom") {
    docs.splice(currentIndex, 1);
    docs.push(current);
  } else {
    throw new Error("invalid_position_mode");
  }

  let updated = 0;
  for (let i = 0; i < docs.length; i += 1) {
    const queue = docs[i];
    const res = await db.collection("queues").updateOne(
      { _id: queue._id },
      { $set: { order_rank: i + 1, updated_at: new Date() } }
    );
    updated += res.modifiedCount;
  }

  return { updated, ordered_ids: docs.map((item) => String(item._id)) };
}

export async function sortQueueViewDocs(db, queueDocs) {
  const items = [];
  for (const doc of queueDocs) {
    items.push(await toQueueView(db, doc));
  }
  return items.sort((a, b) => {
    if (a.priority_rank !== b.priority_rank) return a.priority_rank - b.priority_rank;
    if (a.order_rank !== b.order_rank) return a.order_rank - b.order_rank;
    const aTime = new Date(a.created_at || 0).getTime();
    const bTime = new Date(b.created_at || 0).getTime();
    return aTime - bTime;
  });
}

export async function toQueueView(db, queueDoc) {
  const patient = await db.collection("patients").findOne({ _id: queueDoc.patient_id });

  // Trích năm sinh từ dob (hỗ trợ format YYYY hoặc DD/MM/YYYY)
  const rawDob = String(patient?.dob || queueDoc.patient_snapshot?.dob || '').trim();
  let year_of_birth = '';
  if (rawDob) {
    if (/^\d{4}$/.test(rawDob)) {
      year_of_birth = rawDob;
    } else {
      const m = rawDob.match(/(\d{4})$/);
      if (m) year_of_birth = m[1];
    }
  }

  return {
    queue_id: String(queueDoc._id),
    queue_number: queueDoc.queue_number,
    patient_id: String(queueDoc.patient_id),
    patient_key: queueDoc.patient_key,
    patient_name: patient?.full_name || queueDoc.patient_snapshot?.full_name || "",
    gender: patient?.gender || queueDoc.patient_snapshot?.gender || "",
    year_of_birth,
    status: queueDoc.status,
    room_id: queueDoc.room_id,
    floor_id: queueDoc.floor_id,
    is_priority: !!queueDoc.is_priority,
    priority_rank: Number(queueDoc.priority_rank || 1),
    order_rank: Number(queueDoc.order_rank || 0),
    created_at: queueDoc.created_at,
    updated_at: queueDoc.updated_at,
    arrived_at: queueDoc.arrived_at,
    called_at: queueDoc.called_at,
    completed_at: queueDoc.completed_at,
  };
}

export function parseQueueId(id) {
  if (!ObjectId.isValid(String(id))) throw new Error("invalid_queue_id");
  return toObjectId(id);
}
