-- Migration 0001: Initial schema for PFM D1 database

CREATE TABLE IF NOT EXISTS patients (
  id                TEXT PRIMARY KEY,
  patient_key       TEXT UNIQUE NOT NULL,
  medical_code      TEXT NOT NULL DEFAULT '',
  identity_number   TEXT NOT NULL DEFAULT '',
  full_name         TEXT NOT NULL DEFAULT '',
  dob               TEXT NOT NULL DEFAULT '',
  gender            TEXT NOT NULL DEFAULT '',
  address           TEXT NOT NULL DEFAULT '',
  address_cv30      TEXT NOT NULL DEFAULT '',
  is_priority       INTEGER NOT NULL DEFAULT 0,
  is_online_booking INTEGER NOT NULL DEFAULT 0,
  source_payload    TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patients_identifiers ON patients(medical_code, identity_number);
CREATE INDEX IF NOT EXISTS idx_patients_created_at  ON patients(created_at DESC);

CREATE TABLE IF NOT EXISTS queues (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  patient_id    TEXT NOT NULL,
  patient_key   TEXT,
  floor_id      TEXT,
  queue_date    TEXT NOT NULL,
  queue_number  INTEGER NOT NULL,
  status        TEXT NOT NULL,
  priority_rank INTEGER NOT NULL DEFAULT 1,
  order_rank    INTEGER NOT NULL DEFAULT 1,
  is_priority   INTEGER NOT NULL DEFAULT 0,
  arrived_at    INTEGER,
  called_at     INTEGER,
  completed_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(room_id, queue_date, queue_number)
);
CREATE INDEX IF NOT EXISTS idx_queues_room_status  ON queues(room_id, status, priority_rank, order_rank);
CREATE INDEX IF NOT EXISTS idx_queues_patient      ON queues(patient_id);
CREATE INDEX IF NOT EXISTS idx_queues_pk_room      ON queues(patient_key, room_id, status);
CREATE INDEX IF NOT EXISTS idx_queues_date         ON queues(queue_date, room_id);

CREATE TABLE IF NOT EXISTS counters (
  room_id  TEXT NOT NULL,
  date_key TEXT NOT NULL,
  value    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, date_key)
);

CREATE TABLE IF NOT EXISTS queue_events (
  id            TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  queue_id      TEXT,
  room_id       TEXT,
  from_status   TEXT,
  to_status     TEXT,
  actor_user_id TEXT NOT NULL DEFAULT 'system',
  note          TEXT NOT NULL DEFAULT '',
  payload       TEXT,
  occurred_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qevents_queue ON queue_events(queue_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_qevents_room  ON queue_events(room_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_qevents_type  ON queue_events(event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS staff_users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL,
  allowed_rooms TEXT NOT NULL DEFAULT '[]',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_role   ON staff_users(role);
CREATE INDEX IF NOT EXISTS idx_staff_active ON staff_users(is_active);

CREATE TABLE IF NOT EXISTS floors (
  id         TEXT PRIMARY KEY,
  floor_id   TEXT UNIQUE NOT NULL,
  floor_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_floors_active ON floors(is_active, sort_order);

CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  room_id    TEXT UNIQUE NOT NULL,
  room_name  TEXT NOT NULL,
  floor_id   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_floor  ON rooms(floor_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active);

CREATE TABLE IF NOT EXISTS devices (
  id             TEXT PRIMARY KEY,
  binding_id     TEXT,
  pairing_code   TEXT,
  device_type    TEXT,
  last_heartbeat INTEGER,
  metadata       TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_binding   ON devices(binding_id);
CREATE INDEX IF NOT EXISTS idx_devices_heartbeat ON devices(last_heartbeat DESC);
