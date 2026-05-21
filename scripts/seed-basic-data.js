import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "pfm_dts";

if (!uri) {
  throw new Error("Missing MONGODB_URI. Please set it in .env");
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const now = new Date();

  await db.collection("floors").updateOne(
    { floor_id: "floor2" },
    {
      $set: {
        floor_id: "floor2",
        floor_name: "Floor 2",
        order: 2,
        is_active: true,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true }
  );

  await db.collection("floors").updateOne(
    { floor_id: "floor3" },
    {
      $set: {
        floor_id: "floor3",
        floor_name: "Floor 3",
        order: 3,
        is_active: true,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true }
  );

  await db.collection("rooms").updateOne(
    { room_id: "room_sieu_am" },
    {
      $set: {
        room_id: "room_sieu_am",
        room_name: "Phòng Siêu Âm",
        floor_id: "floor2",
        order: 1,
        is_active: true,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true }
  );

  await db.collection("rooms").updateOne(
    { room_id: "room_noi" },
    {
      $set: {
        room_id: "room_noi",
        room_name: "Phòng Khám Nội",
        floor_id: "floor3",
        order: 1,
        is_active: true,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true }
  );

  const staffSeeds = [
    {
      username: "superadmin",
      full_name: "Super Admin",
      role: "super_admin",
      allowed_rooms: ["room_sieu_am", "room_noi"],
    },
    {
      username: "manager",
      full_name: "Manager",
      role: "admin",
      allowed_rooms: ["room_sieu_am", "room_noi"],
    },
    {
      username: "staff_sieu_am",
      full_name: "Staff Sieu Am",
      role: "nurse",
      allowed_rooms: ["room_sieu_am"],
    },
    {
      username: "staff_noi",
      full_name: "Staff Noi",
      role: "nurse",
      allowed_rooms: ["room_noi"],
    },
  ];

  for (const staff of staffSeeds) {
    await db.collection("staff_users").updateOne(
      { username: staff.username },
      {
        $set: {
          username: staff.username,
          full_name: staff.full_name,
          role: staff.role,
          allowed_rooms: staff.allowed_rooms,
          is_active: true,
          updated_at: now,
        },
        $setOnInsert: {
          created_at: now,
          password_hash: "",
        },
      },
      { upsert: true }
    );
  }

  console.log("[seed] floors, rooms, staff_users upserted successfully");
  await client.close();
}

main().catch((error) => {
  console.error("[seed-error]", error);
  process.exit(1);
});
