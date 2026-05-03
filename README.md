# backend-pfm

Backend foundation for PFM using Hono (JavaScript) and MongoDB Atlas.

## Node version

Project is pinned to `Node 20.18.1` via `.nvmrc`, `.node-version`, and `package.json` engines.

## Quick start

```bash
npm install
npm run db:init
npm run db:seed
npm run dev
```

Server runs at `http://localhost:3000`.

## Test routes

### 1. Check DB (no auth)

```bash
curl http://localhost:3000/api/check-db
```

### 2. Generate JWT test token

```bash
npm run gen:token
```

### 3. Check auth (requires bearer token)

```bash
curl -H "Authorization: Bearer <PASTE_TOKEN>" http://localhost:3000/api/check-auth
```

### 4. Login with seeded staff user

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"super_admiin"}'
```

## Seeded records

- `super_admiin`
- `staff_receptionist`
- `staff_sieu_am` (allowed room: `room_sieu_am`, floor: `floor2`)
- `staff_x_quang` (allowed room: `room_x_quang`, floor: `floor1`)

## Project structure

```text
src/
  index.js
  lib/mongo.js
  middleware/auth.js
  routes/check-db.js
  routes/check-auth.js
scripts/
  init-db.js
  generate-token.js
```

## Postman

Files:
- `postman/PFM_Backend.postman_collection.json`
- `postman/PFM_Backend.dev.postman_environment.json`
- `postman/PFM_Backend.prod.postman_environment.json`

Notes:
- Request `Login (Auto Save Token)` will auto save `token` into selected environment.
- Request `Create Patient + Queue (Auto Save IDs)` will auto save `patient_id`, `queue_id`, `queue_number`.
- Auth header for secured APIs is auto-injected from `{{token}}` by collection pre-request script.
