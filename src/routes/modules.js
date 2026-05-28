import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { getDb } from "../lib/db.js";

const route = new Hono();

route.get("/v1/modules/floor-room", authMiddleware, async (c) => {
  const db = getDb(c.env);
  // Note: 'order' is a reserved word in SQLite — must use sort_order column
  const { results: floors } = await db
    .prepare("SELECT * FROM floors WHERE is_active = 1 ORDER BY sort_order ASC")
    .all();
  const { results: rooms } = await db
    .prepare("SELECT * FROM rooms WHERE is_active = 1 ORDER BY sort_order ASC")
    .all();

  const floorMap = floors.map((floor) => ({
    floor_id: floor.floor_id,
    floor_name: floor.floor_name,
    sort_order: floor.sort_order,
    rooms: rooms
      .filter((room) => room.floor_id === floor.floor_id)
      .map((room) => ({
        room_id: room.room_id,
        room_name: room.room_name,
        sort_order: room.sort_order,
      })),
  }));

  return c.json({ ok: true, items: floorMap });
});

export default route;

