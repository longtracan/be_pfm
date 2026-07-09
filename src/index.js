import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import checkDbRoute from "./routes/check-db.js";
import checkAuthRoute from "./routes/check-auth.js";
import authRoute from "./routes/auth.js";
import modulesRoute from "./routes/modules.js";
import patientsRoute from "./routes/patients.js";
import queueRoute from "./routes/queue.js";
import eventsRoute from "./routes/events.js";
import { RoomHub } from "./durable-objects/RoomHub.js";

export { RoomHub };

const app = new Hono();
app.use("*", logger());
app.use("*", (c, next) => {
  const allowedOrigins = (c.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const requestUrl = new URL(c.req.url);
  const isLocalHost = requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1";
  const allowAll = allowedOrigins.includes("*") || isLocalHost;

  return cors({
    origin: (origin) => {
      if (allowAll) return origin || "*";
      if (!origin) return null;
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return origin;
      }
      return null;
    },
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })(c, next);
});

app.get("/", (c) =>
  c.json({
    service: "pfm-backend",
    status: "ok",
    version: "2.0.0-cloudflare",
  })
);

app.route("/api", checkDbRoute);
app.route("/api", checkAuthRoute);
app.route("/api", authRoute);
app.route("/api", modulesRoute);
app.route("/api", patientsRoute);
app.route("/api", queueRoute);
app.route("/api", eventsRoute);

export default app;
