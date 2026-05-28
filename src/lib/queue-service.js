import {
  ACTIVE_QUEUE_STATUSES,
  QUEUE_STATUS,
  WAITING_QUEUE_STATUSES,
} from "./constants.js";

const HO_CHI_MINH_TIMEZONE = "Asia/Ho_Chi_Minh";

function isValidUUID(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));
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

  const uriMatch = value.match(/^pfm:\/\/checkin\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
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
    patient_id: patientDoc.id,
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
  const room = await db
    .prepare("SELECT * FROM rooms WHERE room_id = ? AND is_active = 1 LIMIT 1")
    .bind(roomId)
    .first();
  if (!room) throw new Error(`room_not_found:${roomId}`);
  return room;
}

export async function nextQueueNumber(db, roomId) {
  const dateKey = formatDateKey();
  const batchResults = await db.batch([
    db.prepare("INSERT OR IGNORE INTO counters (room_id, date_key, value) VALUES (?, ?, 0)").bind(roomId, dateKey),
    db.prepare("UPDATE counters SET value = value + 1 WHERE room_id = ? AND date_key = ?").bind(roomId, dateKey),
    db.prepare("SELECT value FROM counters WHERE room_id = ? AND date_key = ?").bind(roomId, dateKey),
  ]);
  return batchResults[2].results[0].value;
}

export async function appendQueueEvent(db, event) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO queue_events (id, event_type, queue_id, room_id, from_status, to_status,
         actor_user_id, note, payload, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      event.event_type || "STATUS_CHANGED",
      event.queue_id || null,
      event.room_id || null,
      event.from_status || null,
      event.to_status || null,
      event.actor_user_id || "system",
      event.note || "",
      event.payload ? JSON.stringify(event.payload) : null,
      event.occurred_at || now
    )
    .run();
}

async function nextOrderRank(db, roomId, isPriority) {
  const priorityRank = isPriority ? 0 : 1;
  const ph = WAITING_QUEUE_STATUSES.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT order_rank FROM queues WHERE room_id = ? AND status IN (${ph}) AND priority_rank = ? ORDER BY order_rank ASC`)
    .bind(roomId, ...WAITING_QUEUE_STATUSES, priorityRank)
    .all();
  if (results.length === 0) return 1;
  const ranks = results.map((r) => Number(r.order_rank || 0)).filter((n) => Number.isFinite(n));
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
  const now = Date.now();
  const priorityRank = isPriority ? 0 : 1;
  const orderRank = await nextOrderRank(db, roomId, isPriority);
  const queueId = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO queues
        (id, patient_id, patient_key, room_id, floor_id, queue_date, status,
         queue_number, is_priority, priority_rank, order_rank,
         arrived_at, called_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    )
    .bind(
      queueId,
      patient.id,
      patient.patient_key,
      roomId,
      room.floor_id || null,
      formatDateKey(),
      QUEUE_STATUS.CHO_KHAM,
      queueNumber,
      isPriority ? 1 : 0,
      priorityRank,
      orderRank,
      now,
      now,
      now
    )
    .run();

  await appendQueueEvent(db, {
    event_type: "QUEUE_CREATED",
    queue_id: queueId,
    room_id: roomId,
    from_status: null,
    to_status: QUEUE_STATUS.CHO_KHAM,
    actor_user_id: createdBy || "system",
    note: note || "created",
    payload: { queue_number: queueNumber, is_priority: !!isPriority },
  });

  return {
    id: queueId,
    patient_id: patient.id,
    patient_key: patient.patient_key,
    room_id: roomId,
    floor_id: room.floor_id || null,
    queue_date: formatDateKey(),
    status: QUEUE_STATUS.CHO_KHAM,
    queue_number: queueNumber,
    is_priority: isPriority ? 1 : 0,
    priority_rank: priorityRank,
    order_rank: orderRank,
    arrived_at: now,
    created_at: now,
    updated_at: now,
  };
}

export async function findQueueById(db, queueId) {
  if (!isValidUUID(queueId)) throw new Error("invalid_queue_id");
  return db.prepare("SELECT * FROM queues WHERE id = ? LIMIT 1").bind(queueId).first();
}

export async function findLatestActiveQueueForPatientRoom(db, patientId, roomId) {
  const ph = ACTIVE_QUEUE_STATUSES.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM queues WHERE patient_id = ? AND room_id = ? AND status IN (${ph}) ORDER BY created_at DESC, order_rank DESC LIMIT 1`)
    .bind(patientId, roomId, ...ACTIVE_QUEUE_STATUSES)
    .first();
}

export async function findPatientById(db, patientId) {
  if (!isValidUUID(patientId)) return null;
  return db.prepare("SELECT * FROM patients WHERE id = ? LIMIT 1").bind(patientId).first();
}

export async function findPatientByKey(db, patientKey) {
  const key = String(patientKey || "").trim();
  if (!key) return null;
  return db.prepare("SELECT * FROM patients WHERE patient_key = ? LIMIT 1").bind(key).first();
}

export async function upsertPatient(db, patientData) {
  const now = Date.now();
  const medicalCode = String(patientData.medical_code || "").trim();
  const identityNumber = String(patientData.identity_number || "").trim();
  const patientKey = String(patientData.patient_key || "").trim();

  if (!medicalCode || !identityNumber || !patientKey) throw new Error("patient_key_required");

  const sourcePayloadJson = patientData.source_payload
    ? JSON.stringify(patientData.source_payload)
    : null;

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO patients
        (id, patient_key, medical_code, identity_number, full_name, dob, gender,
         address, address_cv30, is_priority, is_online_booking, source_payload,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(patient_key) DO UPDATE SET
         medical_code      = excluded.medical_code,
         identity_number   = excluded.identity_number,
         full_name         = excluded.full_name,
         dob               = excluded.dob,
         gender            = excluded.gender,
         address           = excluded.address,
         address_cv30      = excluded.address_cv30,
         is_priority       = excluded.is_priority,
         is_online_booking = excluded.is_online_booking,
         source_payload    = COALESCE(excluded.source_payload, patients.source_payload),
         updated_at        = excluded.updated_at`
    )
    .bind(
      id,
      patientKey,
      medicalCode,
      identityNumber,
      String(patientData.full_name || "").trim(),
      String(patientData.dob || "").trim(),
      String(patientData.gender || "").trim(),
      String(patientData.address || "").trim(),
      String(patientData.address_cv30 || "").trim(),
      patientData.is_priority ? 1 : 0,
      patientData.is_online_booking ? 1 : 0,
      sourcePayloadJson,
      now,
      now
    )
    .run();

  return db.prepare("SELECT * FROM patients WHERE patient_key = ? LIMIT 1").bind(patientKey).first();
}

export async function updateQueueStatus(db, {
  queue,
  status,
  actorUserId,
  note,
  eventType = "STATUS_CHANGED",
  payload = null,
}) {
  const now = Date.now();
  let calledAt = null;
  let completedAt = null;

  if (status === QUEUE_STATUS.DANG_KHAM) calledAt = now;
  if (status === QUEUE_STATUS.HOAN_THANH) completedAt = now;

  await db
    .prepare(
      `UPDATE queues SET status = ?,
        called_at    = CASE WHEN ? IS NOT NULL THEN ? ELSE called_at END,
        completed_at = CASE WHEN ? IS NOT NULL THEN ? ELSE completed_at END,
        updated_at   = ?
       WHERE id = ?`
    )
    .bind(status, calledAt, calledAt, completedAt, completedAt, now, queue.id)
    .run();

  await appendQueueEvent(db, {
    event_type: eventType,
    queue_id: queue.id,
    room_id: queue.room_id,
    from_status: queue.status,
    to_status: status,
    actor_user_id: actorUserId || "system",
    note: note || "",
    payload,
  });

  return {
    ...queue,
    status,
    updated_at: now,
    ...(calledAt !== null ? { called_at: calledAt } : {}),
    ...(completedAt !== null ? { completed_at: completedAt } : {}),
  };
}

export async function reindexRoomQueues(db, roomId) {
  const ph = WAITING_QUEUE_STATUSES.map(() => "?").join(",");
  const { results: docs } = await db
    .prepare(`SELECT id FROM queues WHERE room_id = ? AND status IN (${ph}) ORDER BY priority_rank ASC, order_rank ASC, created_at ASC`)
    .bind(roomId, ...WAITING_QUEUE_STATUSES)
    .all();

  const now = Date.now();
  const updates = docs.map((q, i) =>
    db.prepare("UPDATE queues SET order_rank = ?, updated_at = ? WHERE id = ?").bind(i + 1, now, q.id)
  );
  if (updates.length > 0) await db.batch(updates);
  return updates.length;
}

export async function getRoomQueues(db, roomId, statuses = ACTIVE_QUEUE_STATUSES, date = null) {
  let sql = `SELECT * FROM queues WHERE room_id = ?`;
  const bindings = [roomId];

  const ph = statuses.map(() => "?").join(",");
  sql += ` AND status IN (${ph})`;
  bindings.push(...statuses);

  if (date) {
    sql += " AND queue_date = ?";
    bindings.push(date);
  }

  sql += " ORDER BY priority_rank ASC, order_rank ASC, created_at ASC";
  const { results } = await db.prepare(sql).bind(...bindings).all();
  return results;
}

export async function moveQueuePosition(db, {
  queueId,
  roomId,
  targetQueueId = null,
  mode = "before",
  orderedIds = null,
}) {
  const current = await db.prepare("SELECT * FROM queues WHERE id = ? LIMIT 1").bind(queueId).first();
  if (!current) throw new Error("queue_not_found");
  if (current.room_id !== roomId) throw new Error("queue_room_mismatch");
  if (!WAITING_QUEUE_STATUSES.includes(current.status)) throw new Error("queue_not_movable");

  const ph = WAITING_QUEUE_STATUSES.map(() => "?").join(",");
  const { results: docs } = await db
    .prepare(`SELECT * FROM queues WHERE room_id = ? AND status IN (${ph}) ORDER BY priority_rank ASC, order_rank ASC, created_at ASC`)
    .bind(roomId, ...WAITING_QUEUE_STATUSES)
    .all();

  const currentIndex = docs.findIndex((item) => item.id === current.id);
  if (currentIndex < 0) throw new Error("queue_not_in_waiting_list");

  if (Array.isArray(orderedIds) && orderedIds.length > 0) {
    const requestedIds = orderedIds.map((item) => String(item)).filter(Boolean);
    const currentIds = docs.map((item) => item.id);
    if (requestedIds.length !== docs.length) throw new Error("ordered_ids_mismatch");
    const requestedSet = new Set(requestedIds);
    const currentSet = new Set(currentIds);
    for (const id of currentIds) {
      if (!requestedSet.has(id)) throw new Error("ordered_ids_mismatch");
    }
    for (const id of requestedIds) {
      if (!currentSet.has(id)) throw new Error("ordered_ids_mismatch");
    }
    const now = Date.now();
    const updates = requestedIds.map((id, i) =>
      db.prepare("UPDATE queues SET order_rank = ?, updated_at = ? WHERE id = ?").bind(i + 1, now, id)
    );
    await db.batch(updates);
    return { updated: updates.length, ordered_ids: requestedIds };
  }

  if (targetQueueId && targetQueueId === current.id) {
    return { updated: 0, ordered_ids: docs.map((item) => item.id) };
  }

  if (targetQueueId) {
    if (!["before", "after"].includes(mode)) throw new Error("invalid_position_mode");
    const targetIndex = docs.findIndex((item) => item.id === targetQueueId);
    if (targetIndex < 0) throw new Error("target_queue_not_found");
    docs.splice(currentIndex, 1);
    const nextIndex = docs.findIndex((item) => item.id === targetQueueId);
    if (nextIndex < 0) throw new Error("target_queue_not_found");
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

  const now = Date.now();
  const updates = docs.map((q, i) =>
    db.prepare("UPDATE queues SET order_rank = ?, updated_at = ? WHERE id = ?").bind(i + 1, now, q.id)
  );
  await db.batch(updates);
  return { updated: updates.length, ordered_ids: docs.map((item) => item.id) };
}

export async function sortQueueViewDocs(db, queueDocs) {
  const items = [];
  for (const doc of queueDocs) {
    items.push(await toQueueView(db, doc));
  }
  return items.sort((a, b) => {
    if (a.priority_rank !== b.priority_rank) return a.priority_rank - b.priority_rank;
    if (a.order_rank !== b.order_rank) return a.order_rank - b.order_rank;
    return (a.created_at || 0) - (b.created_at || 0);
  });
}

export async function toQueueView(db, queueDoc) {
  const patient = await db
    .prepare("SELECT * FROM patients WHERE id = ? LIMIT 1")
    .bind(queueDoc.patient_id)
    .first();

  const rawDob = String(patient?.dob || "").trim();
  let year_of_birth = "";
  if (rawDob) {
    if (/^\d{4}$/.test(rawDob)) {
      year_of_birth = rawDob;
    } else {
      const m = rawDob.match(/(\d{4})$/);
      if (m) year_of_birth = m[1];
    }
  }

  return {
    queue_id: queueDoc.id,
    queue_number: queueDoc.queue_number,
    patient_id: queueDoc.patient_id,
    patient_key: queueDoc.patient_key,
    patient_name: patient?.full_name || "",
    gender: patient?.gender || "",
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
  if (!isValidUUID(String(id || ""))) throw new Error("invalid_queue_id");
  return id;
}
