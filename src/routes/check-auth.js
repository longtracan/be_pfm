import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { pingDb } from "../lib/mongo.js";

const route = new Hono();

route.get("/check-auth", authMiddleware, async (c) => {
  const auth = c.get("auth");
  await pingDb();

  return c.json({
    ok: true,
    message: "Authorized request",
    auth,
  });
});

export default route;
