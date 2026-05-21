import { EventEmitter } from "events";

/**
 * Singleton EventEmitter cho SSE queue updates.
 * Mỗi khi có thay đổi queue trong một room, gọi emitQueueUpdate(roomId, items).
 */
const queueEvents = new EventEmitter();
queueEvents.setMaxListeners(200); // hỗ trợ nhiều SSE clients đồng thời

/**
 * Phát event "queue-update" cho một room cụ thể.
 * @param {string} roomId
 * @param {string} roomName — tên phòng tiếng Việt
 * @param {object[]} items — kết quả toQueueView[] đã serialized
 */
export function emitQueueUpdate(roomId, roomName, items) {
  queueEvents.emit("queue-update", { roomId, roomName: roomName || roomId, items });
}

export default queueEvents;
