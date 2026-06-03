# backend-pfm

Backend PFM — Cloudflare Workers + Hono (JavaScript) + D1 (SQLite) + Durable Objects.

## Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono v4
- **Database**: Cloudflare D1 (SQLite)
- **Realtime**: Durable Objects (WebSocket)
- **Auth**: JWT via `jose`

## Yêu cầu

- Node.js >= 20
- `npm install -g wrangler` (>= 3.x)
- Tài khoản Cloudflare

## Quick start (local)

```bash
npm install

# Chạy với D1 SQLite local (không cần internet, không tốn quota)
npm run dev
# → http://localhost:8787

# Apply migrations vào SQLite local lần đầu
npm run db:migrate:local
```

## Local secrets

Tạo file `.dev.vars` (không commit — đã có trong `.gitignore`):
```
JWT_SECRET=dev_secret_change_me_min_32_chars_long
```
Wrangler tự load file này khi chạy `wrangler dev`.

## Scripts

| Script | Mô tả |
|---|---|
| `npm run dev` | Chạy local với D1 SQLite local |
| `npm run dev:remote` | Chạy local, kết nối D1 remote (env preview) |
| `npm run deploy` | Deploy production |
| `npm run deploy:preview` | Deploy preview/staging |
| `npm run db:migrate` | Apply migration lên D1 production |
| `npm run db:migrate:preview` | Apply migration lên D1 dev |
| `npm run db:migrate:local` | Apply migration local SQLite |
| `npm run db:seed` | Seed dữ liệu vào production DB |
| `npm run db:seed:preview` | Seed dữ liệu vào preview DB |
| `npm run logs` | Xem logs Workers real-time |
| `npm run logs:errors` | Xem chỉ error logs |

## Cài đặt & Deploy

Xem tài liệu đầy đủ tại [frontend-pfm/docs/03-deploy-va-kiem-soat.md](../frontend-pfm/docs/03-deploy-va-kiem-soat.md).

## Test routes (localhost:8787)

```bash
# Check DB
curl http://localhost:8787/api/check-db

# Login
curl -X POST http://localhost:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"superadmin123"}'

# Check auth (thay <TOKEN> bằng token từ login)
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8787/api/check-auth
```

## Postman

Files:
- `postman/PFM_Backend.postman_collection.json`
- `postman/PFM_Backend.dev.postman_environment.json`
- `postman/PFM_Backend.prod.postman_environment.json`

Request `Login (Auto Save Token)` tự lưu `token` vào environment đang chọn.

## Project structure

```
src/
  index.js
  durable-objects/
    RoomHub.js
  lib/
    auth.js
    constants.js
    db.js
    queue-events.js
    queue-service.js
  middleware/
    auth.js
  routes/
    auth.js
    check-auth.js
    check-db.js
    events.js
    modules.js
    patients.js
    queue.js
migrations/
  0001_schema.sql
  0002_seed.sql
```


## Node version

Project is pinned to `Node 20.18.1` via `.nvmrc`, `.node-version`, and `package.json` engines.

## Current scope

- Auth staff bang JWT 8h.
- Tao/update patient theo `patient_key = medical_code|identity_number`.
- Tao queue theo `room_id`.
- Quan ly queue `scan / call / complete / status / position`.
- Tra lai QR payload JSON de extension/room scan su dung.
- Auto transition `CHO_KET_QUA -> CHO_TAI_KHAM` khi scan lai dung room.

Chua co:

- Devices pairing.
- WebSocket realtime.
- Frontend integration that voi queue lifecycle.

## Quick start

```bash
npm install
npm run db:init
npm run db:seed
npm run dev
```

Server runs at `http://localhost:3000`.

## CI/CD (Cloudflare Worker)

Repo backend co workflow tu dong deploy tai `.github/workflows/cloudflare-worker-deploy.yml`.

Can cau hinh GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Sau khi push len `main`/`master`, GitHub Actions se chay `wrangler deploy`.

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
  -d '{"username":"superadmin"}'
```

### 5. Patient upsert

```bash
curl -X POST http://localhost:3000/api/v1/patients \
  -H "Authorization: Bearer <PASTE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "medical_code": "MT001",
    "identity_number": "012345678901",
    "full_name": "Nguyen Van A",
    "dob": "1985-01-01",
    "is_priority": true
  }'
```

### 6. Scan QR at room

```bash
curl -X POST http://localhost:3000/api/v1/queue/scan \
  -H "Authorization: Bearer <PASTE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "room_id": "room_sieu_am",
    "qr_content": "{\"patient_key\":\"MT001|012345678901\",\"medical_code\":\"MT001\",\"identity_number\":\"012345678901\",\"full_name\":\"Nguyen Van A\",\"is_priority\":true}"
  }'
```

## Seeded records

Seed chuan cho thiet ke hien tai xem tai:

- [Database Design](/Users/thuanluuquang/Documents/pfm-dts/docs/database-design.md#10-seed-db)

## Project structure

```text
src/
  index.js
  lib/mongo.js
  middleware/auth.js
  routes/auth.js
  routes/check-db.js
  routes/check-auth.js
  routes/modules.js
  routes/patients.js
  routes/queue.js
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
- Request `Create Patient + Queue (Auto Save IDs)` should be updated to patient upsert + scan flow.
- Auth header for secured APIs is auto-injected from `{{token}}` by collection pre-request script.
