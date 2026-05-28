import { Hono } from "hono";
import { getDb } from "../lib/db.js";

const route = new Hono();

route.get("/check-db", async (c) => {
  try {
    const db = getDb(c.env);
    const { results: tables } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();

    return c.json({
      ok: true,
      message: "D1 connection is healthy",
      tables: tables.map((t) => t.name),
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        message: "D1 connection failed",
        error: error.message,
      },
      500
    );
  }
});

export default route;

