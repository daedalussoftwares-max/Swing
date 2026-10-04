-- 0002: dummy users the plane engine falls back to when no real person matches.
--
-- Ported 1:1 from the old Go seeders (seedDummyUsers + seedDummyUsersV3):
--   * 5 original India dummies (d1000001-...-00000000000N)
--   * 30 countries x 3 genders x 4 age bands = 360 dummies (d2000000-...)
-- Ids, emails, usernames and values match the Go output exactly, so on a
-- database that was already seeded every insert is a no-op (ON CONFLICT).
-- Countries must stay in sync with client/lib/countries.ts.

-- Original five.
INSERT INTO accounts (id, email, google_sub)
VALUES
    ('d1000001-0000-4000-8000-000000000001', 'dummy+aanya@swing.internal',  'swing-dummy-aanya'),
    ('d1000001-0000-4000-8000-000000000002', 'dummy+kabir@swing.internal',  'swing-dummy-kabir'),
    ('d1000001-0000-4000-8000-000000000003', 'dummy+mira@swing.internal',   'swing-dummy-mira'),
    ('d1000001-0000-4000-8000-000000000004', 'dummy+ishaan@swing.internal', 'swing-dummy-ishaan'),
    ('d1000001-0000-4000-8000-000000000005', 'dummy+priya@swing.internal',  'swing-dummy-priya')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (
    account_id, username, name, dob, gender, bio, interests,
    city, country, profile_complete, is_dummy
)
VALUES
    ('d1000001-0000-4000-8000-000000000001', 'dummy_aanya', 'Aanya', '2004-03-12', 'F',
     'Architecture student. Coffee snob. Will cry over a good sunset.', 'music,film,coffee', 'Mumbai', 'India', TRUE, TRUE),
    ('d1000001-0000-4000-8000-000000000002', 'dummy_kabir', 'Kabir', '2002-06-04', 'M',
     'Music producer by night, engineer by day.', 'music,vinyl,biryani', 'Bengaluru', 'India', TRUE, TRUE),
    ('d1000001-0000-4000-8000-000000000003', 'dummy_mira', 'Mira', '1999-04-19', 'NB',
     'Traveller, ex-journalist, full-time noticer of small things.', 'travel,writing,sunrises', 'Goa', 'India', TRUE, TRUE),
    ('d1000001-0000-4000-8000-000000000004', 'dummy_ishaan', 'Ishaan', '2003-01-15', 'M',
     'Book nerd pretending to be a grown-up.', 'books,poetry,chai', 'Delhi', 'India', TRUE, TRUE),
    ('d1000001-0000-4000-8000-000000000005', 'dummy_priya', 'Priya', '2005-08-21', 'F',
     'Designer who believes good type can fix most moods.', 'design,photography,walks', 'Pune', 'India', TRUE, TRUE)
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO profile_stats (account_id, last_active_at, planes_remaining)
SELECT id::uuid, NOW(), 0
FROM (VALUES
    ('d1000001-0000-4000-8000-000000000001'),
    ('d1000001-0000-4000-8000-000000000002'),
    ('d1000001-0000-4000-8000-000000000003'),
    ('d1000001-0000-4000-8000-000000000004'),
    ('d1000001-0000-4000-8000-000000000005')
) AS v(id)
ON CONFLICT (account_id) DO NOTHING;

-- Country x gender x age-band grid.
DROP TABLE IF EXISTS pg_temp.dummy_seed;
CREATE TEMP TABLE dummy_seed ON COMMIT DROP AS
WITH countries (ci, name, city, region, lat, lng) AS (VALUES
    (0,  'India',                'Mumbai',           'south_asia', 19.0760::float8,  72.8777::float8),
    (1,  'United States',        'New York',         'anglo',      40.7128::float8,  -74.0060::float8),
    (2,  'United Kingdom',       'London',           'anglo',      51.5074::float8,  -0.1278::float8),
    (3,  'Canada',               'Toronto',          'anglo',      43.6532::float8,  -79.3832::float8),
    (4,  'Australia',            'Sydney',           'anglo',      -33.8688::float8, 151.2093::float8),
    (5,  'Germany',              'Berlin',           'europe',     52.5200::float8,  13.4050::float8),
    (6,  'France',               'Paris',            'europe',     48.8566::float8,  2.3522::float8),
    (7,  'Italy',                'Rome',             'europe',     41.9028::float8,  12.4964::float8),
    (8,  'Spain',                'Madrid',           'europe',     40.4168::float8,  -3.7038::float8),
    (9,  'Netherlands',          'Amsterdam',        'europe',     52.3676::float8,  4.9041::float8),
    (10, 'Singapore',            'Singapore',        'se_asia',    1.3521::float8,   103.8198::float8),
    (11, 'Japan',                'Tokyo',            'east_asia',  35.6762::float8,  139.6503::float8),
    (12, 'South Korea',          'Seoul',            'east_asia',  37.5665::float8,  126.9780::float8),
    (13, 'Brazil',               'São Paulo',        'latam',      -23.5505::float8, -46.6333::float8),
    (14, 'Mexico',               'Mexico City',      'latam',      19.4326::float8,  -99.1332::float8),
    (15, 'Argentina',            'Buenos Aires',     'latam',      -34.6037::float8, -58.3816::float8),
    (16, 'United Arab Emirates', 'Dubai',            'mena',       25.2048::float8,  55.2708::float8),
    (17, 'Saudi Arabia',         'Riyadh',           'mena',       24.7136::float8,  46.6753::float8),
    (18, 'South Africa',         'Cape Town',        'africa',     -33.9249::float8, 18.4241::float8),
    (19, 'Nigeria',              'Lagos',            'africa',     6.5244::float8,   3.3792::float8),
    (20, 'Kenya',                'Nairobi',          'africa',     -1.2921::float8,  36.8219::float8),
    (21, 'Indonesia',            'Jakarta',          'se_asia',    -6.2088::float8,  106.8456::float8),
    (22, 'Philippines',          'Manila',           'se_asia',    14.5995::float8,  120.9842::float8),
    (23, 'Vietnam',              'Ho Chi Minh City', 'se_asia',    10.8231::float8,  106.6297::float8),
    (24, 'Thailand',             'Bangkok',          'se_asia',    13.7563::float8,  100.5018::float8),
    (25, 'Turkey',               'Istanbul',         'mena',       41.0082::float8,  28.9784::float8),
    (26, 'Sweden',               'Stockholm',        'europe',     59.3293::float8,  18.0686::float8),
    (27, 'Norway',               'Oslo',             'europe',     59.9139::float8,  10.7522::float8),
    (28, 'Denmark',              'Copenhagen',       'europe',     55.6761::float8,  12.5683::float8),
    (29, 'Finland',              'Helsinki',         'europe',     60.1699::float8,  24.9384::float8)
),
genders (gi, g) AS (VALUES (0, 'F'), (1, 'M'), (2, 'NB')),
-- Representative age per band: 18-24, 25-34, 35-44, 45+.
bands (band, age) AS (VALUES (0, 21), (1, 29), (2, 39), (3, 52)),
-- One name per age band, per gender, per region.
pools (region, g, names) AS (VALUES
    ('south_asia', 'F',  ARRAY['Aanvi', 'Riya', 'Meera', 'Kavita']),
    ('south_asia', 'M',  ARRAY['Arjun', 'Rohan', 'Vikram', 'Suresh']),
    ('south_asia', 'NB', ARRAY['Kiran', 'Ari', 'Noor', 'Sam']),
    ('anglo',      'F',  ARRAY['Emma', 'Olivia', 'Rachel', 'Susan']),
    ('anglo',      'M',  ARRAY['Liam', 'Jack', 'Daniel', 'Mark']),
    ('anglo',      'NB', ARRAY['River', 'Jordan', 'Casey', 'Morgan']),
    ('europe',     'F',  ARRAY['Lena', 'Chloé', 'Giulia', 'Ingrid']),
    ('europe',     'M',  ARRAY['Lukas', 'Hugo', 'Marco', 'Henrik']),
    ('europe',     'NB', ARRAY['Alex', 'Robin', 'Sasha', 'Charlie']),
    ('east_asia',  'F',  ARRAY['Yui', 'Ji-woo', 'Sakura', 'Keiko']),
    ('east_asia',  'M',  ARRAY['Haruto', 'Min-jun', 'Kenji', 'Hiroshi']),
    ('east_asia',  'NB', ARRAY['Hikaru', 'Yuki', 'Min', 'Ren']),
    ('se_asia',    'F',  ARRAY['Siti', 'Mai', 'Ploy', 'Maria']),
    ('se_asia',    'M',  ARRAY['Budi', 'Minh', 'Arif', 'Jose']),
    ('se_asia',    'NB', ARRAY['Ari', 'Kai', 'Linh', 'Jun']),
    ('latam',      'F',  ARRAY['Valentina', 'Camila', 'Lucía', 'Fernanda']),
    ('latam',      'M',  ARRAY['Mateo', 'Diego', 'Rafael', 'Carlos']),
    ('latam',      'NB', ARRAY['Ale', 'Cris', 'Dani', 'Gabi']),
    ('mena',       'F',  ARRAY['Layla', 'Aylin', 'Noura', 'Fatima']),
    ('mena',       'M',  ARRAY['Omar', 'Emre', 'Khalid', 'Yusuf']),
    ('mena',       'NB', ARRAY['Noor', 'Rami', 'Sami', 'Deniz']),
    ('africa',     'F',  ARRAY['Amara', 'Zanele', 'Wanjiru', 'Ngozi']),
    ('africa',     'M',  ARRAY['Tunde', 'Sipho', 'Kamau', 'Chidi']),
    ('africa',     'NB', ARRAY['Ayo', 'Imani', 'Kemi', 'Tumi'])
),
interest_sets (idx, tags) AS (VALUES
    (0, 'music,travel,coffee'),
    (1, 'books,poetry,tea'),
    (2, 'football,gaming,food'),
    (3, 'art,photography,walks'),
    (4, 'film,cooking,hiking'),
    (5, 'tech,startups,running'),
    (6, 'dance,fashion,brunch'),
    (7, 'yoga,nature,writing')
),
grid AS (
    SELECT c.*, gn.gi, gn.g, lower(gn.g) AS gl, b.band, b.age,
           gn.gi * 4 + b.band AS j
    FROM countries c CROSS JOIN genders gn CROSS JOIN bands b
)
SELECT
    ('d2000000-0000-4000-8000-' || lpad((gr.ci * 100 + gr.gi * 10 + gr.band)::text, 12, '0'))::uuid AS id,
    'dummy+c' || lpad(gr.ci::text, 2, '0') || gr.gl || gr.band || '@swing.internal'             AS email,
    'swing-dummy-c' || lpad(gr.ci::text, 2, '0') || '-' || gr.gl || '-' || gr.band              AS sub,
    'dummy_c' || lpad(gr.ci::text, 2, '0') || '_' || gr.gl || '_' || gr.band                    AS username,
    p.names[gr.band + 1]                                                                         AS name,
    gr.g                                                                                         AS gender,
    gr.age                                                                                       AS age,
    'Hi from ' || gr.city || '! Into ' || split_part(i.tags, ',', 1)
        || ' and ' || split_part(i.tags, ',', 2) || '.'                                          AS bio,
    i.tags                                                                                       AS interests,
    gr.city                                                                                      AS city,
    gr.name                                                                                      AS country,
    -- ~2 km grid jitter so dummies are not all on one point.
    gr.lat + ((gr.j % 4)::float8 - 1.5::float8) * 0.02::float8                                   AS lat,
    gr.lng + ((gr.j / 4)::float8 - 1::float8) * 0.02::float8                                     AS lng
FROM grid gr
JOIN pools p ON p.region = gr.region AND p.g = gr.g
JOIN interest_sets i ON i.idx = (gr.ci + gr.j) % 8;

INSERT INTO accounts (id, email, google_sub)
SELECT id, email, sub FROM dummy_seed
ON CONFLICT (id) DO NOTHING;

-- DOB is pinned to June 15th of (current year - age) so the dummy sits inside its band.
INSERT INTO profiles (
    account_id, username, name, dob, gender, bio, interests,
    city, country, lat, lng, location_updated_at, profile_complete, is_dummy
)
SELECT
    id, username, name,
    make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int - age, 6, 15),
    gender, bio, interests, city, country, lat, lng, NOW(), TRUE, TRUE
FROM dummy_seed
ON CONFLICT (account_id) DO UPDATE
SET dob = EXCLUDED.dob, updated_at = NOW()
WHERE profiles.is_dummy AND profiles.dob IS DISTINCT FROM EXCLUDED.dob;

INSERT INTO profile_stats (account_id, last_active_at, planes_remaining)
SELECT id, NOW(), 0 FROM dummy_seed
ON CONFLICT (account_id) DO NOTHING;

DROP TABLE dummy_seed;

-- Give the original five (India) dummies a location too.
UPDATE profiles p
SET lat = v.lat, lng = v.lng, location_updated_at = NOW()
FROM (VALUES
    ('d1000001-0000-4000-8000-000000000001'::uuid, 19.0760::float8, 72.8777::float8),
    ('d1000001-0000-4000-8000-000000000002'::uuid, 12.9716::float8, 77.5946::float8),
    ('d1000001-0000-4000-8000-000000000003'::uuid, 15.4909::float8, 73.8278::float8),
    ('d1000001-0000-4000-8000-000000000004'::uuid, 28.6139::float8, 77.2090::float8),
    ('d1000001-0000-4000-8000-000000000005'::uuid, 18.5204::float8, 73.8567::float8)
) AS v(id, lat, lng)
WHERE p.account_id = v.id AND p.is_dummy AND p.lat IS NULL;
