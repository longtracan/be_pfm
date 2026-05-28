-- Migration 0002: Seed initial data

INSERT OR IGNORE INTO floors (id, floor_id, floor_name, sort_order, is_active, created_at, updated_at)
VALUES
  ('11111111-1111-4111-a111-111111111111', 'floor2', 'Tầng 2', 2, 1, unixepoch('now') * 1000, unixepoch('now') * 1000),
  ('22222222-2222-4222-a222-222222222222', 'floor3', 'Tầng 3', 3, 1, unixepoch('now') * 1000, unixepoch('now') * 1000);

INSERT OR IGNORE INTO rooms (id, room_id, room_name, floor_id, sort_order, is_active, created_at, updated_at)
VALUES
  ('33333333-3333-4333-a333-333333333333', 'room_sieu_am',  'Phòng Siêu Âm',     'floor2', 1, 1, unixepoch('now') * 1000, unixepoch('now') * 1000),
  ('44444444-4444-4444-a444-444444444444', 'room_noi',       'Phòng Khám Nội',    'floor3', 1, 1, unixepoch('now') * 1000, unixepoch('now') * 1000),
  ('55555555-5555-4555-a555-555555555555', 'room_xet_nghiem','Phòng Xét Nghiệm',  'floor2', 2, 1, unixepoch('now') * 1000, unixepoch('now') * 1000);

INSERT OR IGNORE INTO staff_users (id, username, full_name, role, allowed_rooms, is_active, created_at, updated_at)
VALUES
  ('66666666-6666-4666-a666-666666666666', 'admin',         'Administrator',         'super_admin',   '[]',                                         1, unixepoch('now') * 1000, unixepoch('now') * 1000),
  ('77777777-7777-4777-a777-777777777777', 'le_tan',        'Lễ Tân',                'receptionist',  '["room_sieu_am","room_noi","room_xet_nghiem"]',1, unixepoch('now') * 1000, unixepoch('now') * 1000),
  ('88888888-8888-4888-a888-888888888888', 'dieu_duong_sa', 'Điều Dưỡng Siêu Âm',   'nurse',         '["room_sieu_am"]',                           1, unixepoch('now') * 1000, unixepoch('now') * 1000),
  ('99999999-9999-4999-a999-999999999999', 'dieu_duong_noi','Điều Dưỡng Nội',        'nurse',         '["room_noi"]',                               1, unixepoch('now') * 1000, unixepoch('now') * 1000);
