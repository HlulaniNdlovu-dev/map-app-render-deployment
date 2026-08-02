-- Mapper — demo seed data (Phase 4). At least 10 rows in every table that
-- has a real code path reading/writing it. Safe to run against a fresh
-- database (after schema.sql) or layered on top of existing data — every
-- INSERT uses a `seed_` prefixed username/email so it can never collide
-- with the earlier hand-seeded demo accounts (driver_demo, admin_demo,
-- etc.) or anything a real user creates.
--
-- Password for every seeded user is the same as the earlier demo
-- accounts: @Test123 (bcrypt hash below, cost factor 10).
--
-- `admin_driver` (a many-to-many join, 0 rows live, no code anywhere
-- reads or writes it — confirmed in docs/IMPROVEMENT-PLAN.md) and
-- `schema_migrations` (migration-tooling bookkeeping, would corrupt real
-- tracking state if seeded) are deliberately left empty.

SET @seed_password = '$2b$10$nM1os0rdP7n1iCibHHNPs.r/4Ozyf/aHdoaEJULb9jT37Ivt86bn2';

-- ─────────────────────────────────────────────────────────────────────────
-- user + role subtypes — 10 of each role (50 users total)
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO `user` (email, password, username, firstname, lastname, date_created)
VALUES
  ('seed_driver01@mapper.test', @seed_password, 'seed_driver01', 'Thabo', 'Mokoena', NOW()),
  ('seed_driver02@mapper.test', @seed_password, 'seed_driver02', 'Naledi', 'Dlamini', NOW()),
  ('seed_driver03@mapper.test', @seed_password, 'seed_driver03', 'Sipho', 'Nkosi', NOW()),
  ('seed_driver04@mapper.test', @seed_password, 'seed_driver04', 'Lerato', 'Van Wyk', NOW()),
  ('seed_driver05@mapper.test', @seed_password, 'seed_driver05', 'Kagiso', 'Botha', NOW()),
  ('seed_driver06@mapper.test', @seed_password, 'seed_driver06', 'Zanele', 'Khumalo', NOW()),
  ('seed_driver07@mapper.test', @seed_password, 'seed_driver07', 'Pieter', 'Steyn', NOW()),
  ('seed_driver08@mapper.test', @seed_password, 'seed_driver08', 'Amahle', 'Mahlangu', NOW()),
  ('seed_driver09@mapper.test', @seed_password, 'seed_driver09', 'Johan', 'Pretorius', NOW()),
  ('seed_driver10@mapper.test', @seed_password, 'seed_driver10', 'Bontle', 'Sithole', NOW()),
  ('seed_admin01@mapper.test', @seed_password, 'seed_admin01', 'Karabo', 'Molefe', NOW()),
  ('seed_admin02@mapper.test', @seed_password, 'seed_admin02', 'Michelle', 'Naidoo', NOW()),
  ('seed_admin03@mapper.test', @seed_password, 'seed_admin03', 'Bongani', 'Zulu', NOW()),
  ('seed_admin04@mapper.test', @seed_password, 'seed_admin04', 'Elmarie', 'Coetzee', NOW()),
  ('seed_admin05@mapper.test', @seed_password, 'seed_admin05', 'Tumi', 'Radebe', NOW()),
  ('seed_admin06@mapper.test', @seed_password, 'seed_admin06', 'Ruan', 'Fourie', NOW()),
  ('seed_admin07@mapper.test', @seed_password, 'seed_admin07', 'Palesa', 'Moeketsi', NOW()),
  ('seed_admin08@mapper.test', @seed_password, 'seed_admin08', 'Werner', 'Kruger', NOW()),
  ('seed_admin09@mapper.test', @seed_password, 'seed_admin09', 'Nomvula', 'Mthembu', NOW()),
  ('seed_admin10@mapper.test', @seed_password, 'seed_admin10', 'Christo', 'Van der Merwe', NOW()),
  ('seed_traffic01@mapper.test', @seed_password, 'seed_traffic01', 'Andile', 'Ngcobo', NOW()),
  ('seed_traffic02@mapper.test', @seed_password, 'seed_traffic02', 'Suzette', 'Le Roux', NOW()),
  ('seed_traffic03@mapper.test', @seed_password, 'seed_traffic03', 'Mpho', 'Sekgobela', NOW()),
  ('seed_traffic04@mapper.test', @seed_password, 'seed_traffic04', 'Deon', 'Human', NOW()),
  ('seed_traffic05@mapper.test', @seed_password, 'seed_traffic05', 'Refilwe', 'Maake', NOW()),
  ('seed_traffic06@mapper.test', @seed_password, 'seed_traffic06', 'Willem', 'Nel', NOW()),
  ('seed_traffic07@mapper.test', @seed_password, 'seed_traffic07', 'Lindiwe', 'Buthelezi', NOW()),
  ('seed_traffic08@mapper.test', @seed_password, 'seed_traffic08', 'Francois', 'Du Plessis', NOW()),
  ('seed_traffic09@mapper.test', @seed_password, 'seed_traffic09', 'Nokuthula', 'Cele', NOW()),
  ('seed_traffic10@mapper.test', @seed_password, 'seed_traffic10', 'Herman', 'Botes', NOW()),
  ('seed_security01@mapper.test', @seed_password, 'seed_security01', 'Sibusiso', 'Mabaso', NOW()),
  ('seed_security02@mapper.test', @seed_password, 'seed_security02', 'Anelisa', 'Jantjies', NOW()),
  ('seed_security03@mapper.test', @seed_password, 'seed_security03', 'Riaan', 'Swanepoel', NOW()),
  ('seed_security04@mapper.test', @seed_password, 'seed_security04', 'Precious', 'Baloyi', NOW()),
  ('seed_security05@mapper.test', @seed_password, 'seed_security05', 'Jaco', 'Erasmus', NOW()),
  ('seed_security06@mapper.test', @seed_password, 'seed_security06', 'Thandeka', 'Gumede', NOW()),
  ('seed_security07@mapper.test', @seed_password, 'seed_security07', 'Marius', 'Joubert', NOW()),
  ('seed_security08@mapper.test', @seed_password, 'seed_security08', 'Boitumelo', 'Rakgoale', NOW()),
  ('seed_security09@mapper.test', @seed_password, 'seed_security09', 'Charl', 'Viljoen', NOW()),
  ('seed_security10@mapper.test', @seed_password, 'seed_security10', 'Nonhlanhla', 'Shabalala', NOW()),
  ('seed_analyst01@mapper.test', @seed_password, 'seed_analyst01', 'Katlego', 'Modise', NOW()),
  ('seed_analyst02@mapper.test', @seed_password, 'seed_analyst02', 'Simone', 'Adams', NOW()),
  ('seed_analyst03@mapper.test', @seed_password, 'seed_analyst03', 'Tebogo', 'Mokgatle', NOW()),
  ('seed_analyst04@mapper.test', @seed_password, 'seed_analyst04', 'Hendrik', 'Visagie', NOW()),
  ('seed_analyst05@mapper.test', @seed_password, 'seed_analyst05', 'Ayanda', 'Ntuli', NOW()),
  ('seed_analyst06@mapper.test', @seed_password, 'seed_analyst06', 'Corne', 'Meyer', NOW()),
  ('seed_analyst07@mapper.test', @seed_password, 'seed_analyst07', 'Busisiwe', 'Mahlaba', NOW()),
  ('seed_analyst08@mapper.test', @seed_password, 'seed_analyst08', 'Stefan', 'Bosman', NOW()),
  ('seed_analyst09@mapper.test', @seed_password, 'seed_analyst09', 'Ntombi', 'Skosana', NOW()),
  ('seed_analyst10@mapper.test', @seed_password, 'seed_analyst10', 'Gideon', 'Labuschagne', NOW());

INSERT INTO `driver` (user_id)
SELECT user_id FROM `user` WHERE username IN (
  'seed_driver01','seed_driver02','seed_driver03','seed_driver04','seed_driver05',
  'seed_driver06','seed_driver07','seed_driver08','seed_driver09','seed_driver10'
);

INSERT INTO `admin` (user_id)
SELECT user_id FROM `user` WHERE username IN (
  'seed_admin01','seed_admin02','seed_admin03','seed_admin04','seed_admin05',
  'seed_admin06','seed_admin07','seed_admin08','seed_admin09','seed_admin10'
);

INSERT INTO `traffic_authority` (user_id)
SELECT user_id FROM `user` WHERE username IN (
  'seed_traffic01','seed_traffic02','seed_traffic03','seed_traffic04','seed_traffic05',
  'seed_traffic06','seed_traffic07','seed_traffic08','seed_traffic09','seed_traffic10'
);

INSERT INTO `security_agency` (user_id)
SELECT user_id FROM `user` WHERE username IN (
  'seed_security01','seed_security02','seed_security03','seed_security04','seed_security05',
  'seed_security06','seed_security07','seed_security08','seed_security09','seed_security10'
);

INSERT INTO `data_analyst` (user_id)
SELECT user_id FROM `user` WHERE username IN (
  'seed_analyst01','seed_analyst02','seed_analyst03','seed_analyst04','seed_analyst05',
  'seed_analyst06','seed_analyst07','seed_analyst08','seed_analyst09','seed_analyst10'
);

-- ─────────────────────────────────────────────────────────────────────────
-- hazard_reports — 15 rows spread across Pretoria/Johannesburg, mixed
-- source/status, reported by a mix of drivers and staff.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO `hazard_reports` (user_id, latitude, longitude, hazard_type, source, status)
VALUES
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver01'), -25.7461, 28.1881, 'pothole', 'citizen', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver02'), -25.7569, 28.2041, 'accident', 'citizen', 'resolved'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver03'), -25.7699, 28.2294, 'hijacking', 'citizen', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver04'), -26.2041, 28.0473, 'crime_hotspot', 'citizen', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver05'), -26.1952, 28.0341, 'protest', 'citizen', 'resolved'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver06'), -25.8442, 28.1868, 'road_closure', 'citizen', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver07'), -25.7325, 28.2185, 'pothole', 'citizen', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver08'), -26.1076, 28.0567, 'armed_robbery', 'citizen', 'resolved'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_traffic01'), -25.7549, 28.2314, 'road_block', 'traffic_authority', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_traffic02'), -25.7801, 28.2755, 'construction', 'traffic_authority', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_traffic03'), -26.0522, 28.0323, 'road_closure', 'traffic_authority', 'resolved'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_security01'), -25.7146, 28.2312, 'crime_hotspot', 'security_agency', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_security02'), -26.1467, 28.0616, 'hijacking', 'security_agency', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_security03'), -25.9046, 28.1279, 'march', 'security_agency', 'resolved'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver09'), -25.6947, 28.1553, 'accident', 'citizen', 'active');

-- ─────────────────────────────────────────────────────────────────────────
-- destination — 12 trips, 10 already ended (each gets a matching
-- trip_summary row below), 2 still in progress.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO `destination` (user_id, start_location, end_location, created_at, ended_at)
VALUES
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver01'), 'Hatfield, Pretoria', 'Menlyn Mall, Pretoria', NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 10 DAY + INTERVAL 22 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver02'), 'Sandton City, Johannesburg', 'Rosebank, Johannesburg', NOW() - INTERVAL 9 DAY, NOW() - INTERVAL 9 DAY + INTERVAL 18 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver03'), 'Centurion Mall', 'Irene, Centurion', NOW() - INTERVAL 8 DAY, NOW() - INTERVAL 8 DAY + INTERVAL 15 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver04'), 'Fourways, Johannesburg', 'Midrand', NOW() - INTERVAL 7 DAY, NOW() - INTERVAL 7 DAY + INTERVAL 27 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver05'), 'Brooklyn, Pretoria', 'Waterkloof, Pretoria', NOW() - INTERVAL 6 DAY, NOW() - INTERVAL 6 DAY + INTERVAL 12 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver06'), 'Melville, Johannesburg', 'Braamfontein', NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 5 DAY + INTERVAL 20 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver07'), 'Arcadia, Pretoria', 'Sunnyside, Pretoria', NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 4 DAY + INTERVAL 9 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver08'), 'Randburg', 'Roodepoort', NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY + INTERVAL 33 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver09'), 'Kempton Park', 'OR Tambo Airport', NOW() - INTERVAL 2 DAY, NOW() - INTERVAL 2 DAY + INTERVAL 14 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver10'), 'Pretoria CBD', 'Hatfield, Pretoria', NOW() - INTERVAL 1 DAY, NOW() - INTERVAL 1 DAY + INTERVAL 17 MINUTE),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver01'), 'Menlyn Mall, Pretoria', 'Faerie Glen, Pretoria', NOW() - INTERVAL 2 HOUR, NULL),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver02'), 'Rosebank, Johannesburg', 'Parktown, Johannesburg', NOW() - INTERVAL 1 HOUR, NULL);

-- One trip_summary row per ended destination above, computed from the
-- same created_at/ended_at values (mirrors what sp_end_trip would write).
INSERT INTO `trip_summary` (destination_id, user_id, start_location, end_location, duration_seconds, started_at, ended_at)
SELECT d.id, d.user_id, d.start_location, d.end_location, TIMESTAMPDIFF(SECOND, d.created_at, d.ended_at), d.created_at, d.ended_at
FROM `destination` d
WHERE d.ended_at IS NOT NULL
  AND d.user_id IN (SELECT user_id FROM `user` WHERE username LIKE 'seed_driver%')
  AND NOT EXISTS (SELECT 1 FROM `trip_summary` ts WHERE ts.destination_id = d.id);

-- ─────────────────────────────────────────────────────────────────────────
-- hazard_resolution_log — 10 rows, one per resolved seed hazard above,
-- resolved by the staff member who (per hazard_reports.source) would
-- plausibly have handled it.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO `hazard_resolution_log` (hazard_id, resolved_by, previous_status, new_status)
SELECT hr.id, (SELECT user_id FROM `user` WHERE username = 'seed_admin01'), 'active', 'resolved'
FROM `hazard_reports` hr
WHERE hr.status = 'resolved'
  AND hr.user_id IN (SELECT user_id FROM `user` WHERE username LIKE 'seed_%');

-- 5 resolved hazards above => 5 rows from the INSERT before this one.
-- Pad up to 10+ with re-opens / re-resolves on the same hazards, so the
-- report also has more than one entry per hazard to sort/filter through.
INSERT INTO `hazard_resolution_log` (hazard_id, resolved_by, previous_status, new_status, resolved_at)
SELECT hr.id, (SELECT user_id FROM `user` WHERE username = 'seed_traffic01'), 'resolved', 'active', NOW() - INTERVAL 3 DAY
FROM `hazard_reports` hr
WHERE hr.status = 'resolved'
  AND hr.user_id IN (SELECT user_id FROM `user` WHERE username LIKE 'seed_%');

INSERT INTO `hazard_resolution_log` (hazard_id, resolved_by, previous_status, new_status, resolved_at)
SELECT hr.id, (SELECT user_id FROM `user` WHERE username = 'seed_traffic01'), 'active', 'resolved', NOW() - INTERVAL 1 DAY
FROM `hazard_reports` hr
WHERE hr.status = 'resolved'
  AND hr.user_id IN (SELECT user_id FROM `user` WHERE username LIKE 'seed_%');

-- ─────────────────────────────────────────────────────────────────────────
-- ai_risk_candidates — 10 rows spanning pending/confirmed/rejected.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO `ai_risk_candidates`
  (raw_source_text, source_url, classified_category, confidence, suggested_lat, suggested_lng, suggested_location_text, summary, status)
VALUES
  ('Armed robbery reported outside a shopping centre in Menlyn overnight.', 'https://example-news.test/1', 'Crime', 0.910, -25.7825, 28.2773, 'Menlyn, Pretoria', 'Armed robbery near Menlyn Mall.', 'pending'),
  ('Protest march planned along Church Street this Friday morning.', 'https://example-news.test/2', 'Protest', 0.870, -25.7449, 28.1878, 'Church Street, Pretoria', 'Planned protest march, Church Street.', 'pending'),
  ('Flooding closes several roads in Alexandra after heavy overnight rain.', 'https://example-news.test/3', 'Natural Disaster', 0.940, -26.1036, 28.0925, 'Alexandra, Johannesburg', 'Flooding closes roads in Alexandra.', 'pending'),
  ('Multi-vehicle collision on the N1 near Woodmead causes long delays.', 'https://example-news.test/4', 'Accident', 0.880, -26.0432, 28.0876, 'N1 near Woodmead', 'Multi-vehicle collision on N1.', 'confirmed'),
  ('Water main burst has closed the intersection at Jan Smuts and Empire.', 'https://example-news.test/5', 'Infrastructure', 0.760, -26.1734, 28.0345, 'Jan Smuts Ave, Johannesburg', 'Water main burst closes intersection.', 'confirmed'),
  ('Community unrest reported near Mamelodi following a service delivery dispute.', 'https://example-news.test/6', 'Civil Unrest', 0.820, -25.7051, 28.3691, 'Mamelodi, Pretoria', 'Community unrest, service delivery dispute.', 'rejected'),
  ('Carjacking incident reported near Eastgate Shopping Centre.', 'https://example-news.test/7', 'Crime', 0.900, -26.1783, 28.1128, 'Eastgate, Johannesburg', 'Carjacking near Eastgate.', 'confirmed'),
  ('Taxi strike disrupts traffic along the M1 during morning peak.', 'https://example-news.test/8', 'Civil Unrest', 0.780, -26.1420, 28.0473, 'M1 Highway, Johannesburg', 'Taxi strike disrupts M1 traffic.', 'pending'),
  ('Sinkhole reported on a residential street in Centurion.', 'https://example-news.test/9', 'Infrastructure', 0.700, -25.8603, 28.1894, 'Centurion', 'Sinkhole on residential street.', 'rejected'),
  ('Hijacking hotspot flagged by residents near the Atterbury off-ramp.', 'https://example-news.test/10', 'Crime', 0.860, -25.7702, 28.2685, 'Atterbury off-ramp, Pretoria', 'Hijacking hotspot near Atterbury.', 'pending');

-- Every confirmed/rejected candidate implies a human already reviewed it
-- (that's the whole point of the human-in-the-loop step) — only 'pending'
-- ones have no reviewer yet.
UPDATE `ai_risk_candidates`
SET reviewed_by = (SELECT user_id FROM `user` WHERE username = 'seed_admin02'), reviewed_at = NOW() - INTERVAL 2 DAY
WHERE status IN ('confirmed', 'rejected')
  AND source_url LIKE 'https://example-news.test/%';

-- Confirming a candidate always creates a real hazard_reports row
-- (source='ai_confirmed', reported "by" whoever confirmed it — mirrors
-- POST /api/ai/candidates/:id/confirm exactly) — three of the ten
-- candidates above are 'confirmed', so give each one its resulting hazard.
INSERT INTO `hazard_reports` (user_id, latitude, longitude, hazard_type, source, status)
VALUES
  ((SELECT user_id FROM `user` WHERE username = 'seed_admin02'), -26.0432, 28.0876, 'accident', 'ai_confirmed', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_admin02'), -26.1734, 28.0345, 'road_closure', 'ai_confirmed', 'active'),
  ((SELECT user_id FROM `user` WHERE username = 'seed_admin02'), -26.1783, 28.1128, 'hijacking', 'ai_confirmed', 'active');

UPDATE `ai_risk_candidates` SET resulting_hazard_id = (SELECT id FROM `hazard_reports` WHERE latitude = -26.0432 AND longitude = 28.0876) WHERE source_url = 'https://example-news.test/4';
UPDATE `ai_risk_candidates` SET resulting_hazard_id = (SELECT id FROM `hazard_reports` WHERE latitude = -26.1734 AND longitude = 28.0345) WHERE source_url = 'https://example-news.test/5';
UPDATE `ai_risk_candidates` SET resulting_hazard_id = (SELECT id FROM `hazard_reports` WHERE latitude = -26.1783 AND longitude = 28.1128) WHERE source_url = 'https://example-news.test/7';

-- ─────────────────────────────────────────────────────────────────────────
-- driver_notifications — 12 rows, mixed read/unread, each tied to a
-- specific seeded hazard (matched by its exact lat/lng from the INSERT
-- above, since hazard_reports has no natural/unique text key to join on).
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO `driver_notifications` (user_id, hazard_id, message, is_read)
VALUES
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver01'), (SELECT id FROM `hazard_reports` WHERE latitude = -25.7461 AND longitude = 28.1881), 'New pothole hazard reported at -25.7461, 28.1881.', 0),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver02'), (SELECT id FROM `hazard_reports` WHERE latitude = -25.7699 AND longitude = 28.2294), 'New hijacking hazard reported at -25.7699, 28.2294.', 1),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver03'), (SELECT id FROM `hazard_reports` WHERE latitude = -26.2041 AND longitude = 28.0473), 'New crime hotspot hazard reported at -26.2041, 28.0473.', 0),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver04'), (SELECT id FROM `hazard_reports` WHERE latitude = -25.8442 AND longitude = 28.1868), 'New road closure hazard reported at -25.8442, 28.1868.', 1),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver05'), (SELECT id FROM `hazard_reports` WHERE latitude = -25.7549 AND longitude = 28.2314), 'New road block hazard reported at -25.7549, 28.2314.', 0),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver06'), (SELECT id FROM `hazard_reports` WHERE latitude = -25.7801 AND longitude = 28.2755), 'New construction hazard reported at -25.7801, 28.2755.', 1),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver07'), (SELECT id FROM `hazard_reports` WHERE latitude = -25.7146 AND longitude = 28.2312), 'New crime hotspot hazard reported at -25.7146, 28.2312.', 0),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver08'), (SELECT id FROM `hazard_reports` WHERE latitude = -26.1467 AND longitude = 28.0616), 'New hijacking hazard reported at -26.1467, 28.0616.', 1),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver09'), (SELECT id FROM `hazard_reports` WHERE latitude = -25.6947 AND longitude = 28.1553), 'New accident hazard reported at -25.6947, 28.1553.', 0),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver10'), (SELECT id FROM `hazard_reports` WHERE latitude = -25.7461 AND longitude = 28.1881), 'New pothole hazard reported at -25.7461, 28.1881.', 1),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver01'), (SELECT id FROM `hazard_reports` WHERE latitude = -26.1076 AND longitude = 28.0567), 'New armed robbery hazard reported at -26.1076, 28.0567.', 0),
  ((SELECT user_id FROM `user` WHERE username = 'seed_driver02'), (SELECT id FROM `hazard_reports` WHERE latitude = -25.9046 AND longitude = 28.1279), 'New march hazard reported at -25.9046, 28.1279.', 0);
