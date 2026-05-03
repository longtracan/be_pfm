import { MongoClient } from "mongodb";

let client;
let db;

export async function connectMongo() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || "pfm_dts";

  if (!uri) {
    throw new Error("Missing MONGODB_URI in environment variables");
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error("MongoDB is not connected. Call connectMongo() first.");
  }
  return db;
}

export async function pingDb() {
  const database = getDb();
  await database.command({ ping: 1 });
  return true;
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}
