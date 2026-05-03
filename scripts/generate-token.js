import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const secret = process.env.JWT_SECRET || "pfm_dev_secret_change_me";

const token = jwt.sign(
  {
    user_id: "staff_001",
    clinic_id: "clinic_001",
    role: "admin",
    allowed_rooms: ["ROOM_01", "ROOM_02"],
  },
  secret,
  { expiresIn: "8h" }
);

console.log(token);
