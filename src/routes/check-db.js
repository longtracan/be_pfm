import { Hono } from "hono";
import { getDb, pingDb } from "../lib/mongo.js";

const route = new Hono();

route.get("/check-db", async (c) => {
  try {
    await pingDb();
    const db = getDb();
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();

    return c.json({
      ok: true,
      message: "MongoDB connection is healthy",
      dbName: db.databaseName,
      collections: collections.map((item) => item.name),
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        message: "MongoDB connection failed",
        error: error.message,
      },
      500
    );
  }
});

export default route;
