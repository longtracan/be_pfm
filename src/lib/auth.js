import { SignJWT, jwtVerify } from "jose";

function getSecret(env) {
  const raw = (env && env.JWT_SECRET) ? env.JWT_SECRET : "pfm_dev_secret_change_me";
  return new TextEncoder().encode(raw);
}

export async function signStaffToken(staffUser, env) {
  const allowedRooms = Array.isArray(staffUser.allowed_rooms)
    ? staffUser.allowed_rooms
    : JSON.parse(staffUser.allowed_rooms || "[]");

  return new SignJWT({
    user_id: staffUser.id,
    username: staffUser.username,
    role: staffUser.role,
    allowed_rooms: allowedRooms,
    full_name: staffUser.full_name || "",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(getSecret(env));
}

export async function verifyToken(token, env) {
  const { payload } = await jwtVerify(token, getSecret(env));
  return payload;
}
