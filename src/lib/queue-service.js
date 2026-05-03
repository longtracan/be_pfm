import { ObjectId } from "mongodb";
import { QUEUE_STATUS } from "./constants.js";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function nextQueueNumber(db, clinicId) {
  const res = await db.collection("counters").findOneAndUpdate(
    { clinic_id: clinicId, date_key: todayKey(), type: "queue_number" },
    { $inc: { value: 1 }, $setOnInsert: { created_at: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  return res.value.value;
}

export async function ensureRoomExists(db, roomId) {
  const room = await db.collection("rooms").findOne({ room_id: roomId, is_active: true });
  if (!room) {
    throw new Error(`room_not_found:${roomId}`);
  }
  return room;
}

export async function createQueueItem({
  db,
  patientId,
  clinicId,
  roomId,
  isPriority,
  createdBy,
  note,
}) {
  const queueNumber = await nextQueueNumber(db, clinicId);
  const now = new Date();

  const item = {
    patient_id: new ObjectId(patientId),
    clinic_id: clinicId,
    room_id: roomId,
    floor_id: null,
    status: QUEUE_STATUS.WAITING,
    queue_number: queueNumber,
    is_priority: !!isPriority,
    order: queueNumber,
    created_at: now,
    updated_at: now,
    logs: [
      {
        status: QUEUE_STATUS.WAITING,
        time: now,
        user_id: createdBy || "system",
        note: note || "created",
      },
    ],
  };

  const room = await ensureRoomExists(db, roomId);
  item.floor_id = room.floor_id;

  const inserted = await db.collection("queues").insertOne(item);
  return { ...item, _id: inserted.insertedId };
}

export async function toQueueView(db, queueDoc) {
  const patient = await db.collection("patients").findOne({ _id: queueDoc.patient_id });
  return {
    queue_id: String(queueDoc._id),
    queue_number: queueDoc.queue_number,
    patient_id: String(queueDoc.patient_id),
    patient_name: patient?.full_name || "",
    status: queueDoc.status,
    room_id: queueDoc.room_id,
    floor_id: queueDoc.floor_id,
    is_priority: queueDoc.is_priority,
    order: queueDoc.order,
    updated_at: queueDoc.updated_at,
  };
}

export function parseQueueId(id) {
  if (!ObjectId.isValid(id)) throw new Error("invalid_queue_id");
  return new ObjectId(id);
}
