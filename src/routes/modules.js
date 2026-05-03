import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { getDb } from "../lib/mongo.js";

const route = new Hono();

route.get("/v1/modules/floor-room", authMiddleware, async (c) => {
  const db = getDb();
  const floors = await db.collection("floors").find({ is_active: true }).sort({ order: 1 }).toArray();
  const rooms = await db.collection("rooms").find({ is_active: true }).sort({ order: 1 }).toArray();

  const floorMap = floors.map((floor) => ({
    floor_id: floor.floor_id,
    floor_name: floor.floor_name,
    order: floor.order,
    rooms: rooms
      .filter((room) => room.floor_id === floor.floor_id)
      .map((room) => ({
        room_id: room.room_id,
        room_name: room.room_name,
        order: room.order,
      })),
  }));

  return c.json({ ok: true, items: floorMap });
});

export default route;
