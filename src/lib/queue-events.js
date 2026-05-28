/**
 * Queue events — broadcasts via Durable Object ROOM_HUB.
 * Broadcasts to both admin hub (roomId) and public hub (public:roomId).
 */

/**
 * @param {object} env - CF Workers env bindings
 * @param {string} roomId
 * @param {string} roomName
 * @param {object[]} items - toQueueView[] results (admin full view)
 */
export async function emitQueueUpdate(env, roomId, roomName, items) {
  const payload = JSON.stringify({ roomId, roomName: roomName || roomId, items });

  // Broadcast to admin hub
  try {
    const id = env.ROOM_HUB.idFromName(roomId);
    const stub = env.ROOM_HUB.get(id);
    await stub.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  } catch {
    // best-effort
  }

  // Broadcast to public hub (same payload — public screen filters on its end)
  try {
    const pubId = env.ROOM_HUB.idFromName(`public:${roomId}`);
    const pubStub = env.ROOM_HUB.get(pubId);
    await pubStub.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  } catch {
    // best-effort: public hub may have no listeners
  }
}
