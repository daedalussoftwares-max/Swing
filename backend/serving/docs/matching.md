# Paper-plane matching & dispatch

Code: `app/cmd/planes/` (`dispatcher.go`, `match.go`, `scoring.go`, `filters.go`),
migration `lib/pg/migrate_planes_v3.go`.

## Lifecycle

```
POST /v1/planes ─► validate + normalise filters
                   ONE SQL statement: spend 1 plane (profile_stats) + INSERT plane
                   (status='pending', next_attempt_at=now)  ──► 202 {plane, planesRemaining}
                   enqueue dispatch job (non-blocking)

worker (4 goroutines, queue 1024)
  dispatchPlane: BEGIN; SELECT … FROM planes WHERE id=$1 AND status='pending'
                 AND next_attempt_at IS NOT NULL FOR UPDATE SKIP LOCKED
                 → pick recipient → INSERT plane_deliveries(pending)
                 → next_attempt_at=NULL; COMMIT
                 → EventSink.PlaneDelivered (real users) / dummy-accept timer
                 → plane.outbox.updated to the sender
  no candidate → dispatch_attempts++, next_attempt_at = now + backoff (15s·2ⁿ, ≤10m)

reject  ─► delivery 'rejected', plane next_attempt_at=now → re-dispatch (async)
accept  ─► friendship + chat (unchanged) + plane.outbox.updated
dummy   ─► auto-accept DummyAcceptDelay (10s) after delivery, no chat/friendship

sweeper (every 30s): expire planes past expires_at (notify sender + recipient),
re-enqueue due searching planes, settle overdue dummy accepts.
```

Sender-facing `state`: `searching` (pending, no live delivery) → `delivered`
(exactly one pending delivery) → `accepted` | `expired`. Rejections send the
plane back to `searching`; `hops` / `rejections` count deliveries.

No double delivery: the plane row lock + status-guarded predicate serialise
workers, and `uq_plane_deliveries_one_pending` (unique partial index on
`plane_deliveries(plane_id) WHERE status='pending'`) enforces it in the DB.

## Candidate selection (hard rules, SQL)

Excluded: self; incomplete profiles; anyone this plane already reached;
friends and existing chat partners; blocked in either direction
(`user_blocks`, only when the table exists — checked with `to_regclass` at
start and on every sweep); real users who already hold a live plane from this
sender or rejected one of this sender's planes within 7 days.

Filters: gender (`F`/`M`/`NB`), age (DOB range, sargable), country
(case-insensitive), radius (bounding-box prefilter on `profiles(lat,lng)` +
exact haversine). Radius needs the sender's location (`PUT /v1/me/location`,
rounded to 2 decimals ≈ 1 km); without it the radius constraint is dropped.
Candidates without a location are excluded only when a radius applies.

Pool: up to 300 rows, real users first, most recently active first; scoring
signals (inbox load, 24h deliveries, 90-day accept history, last-used filters)
are computed by LATERAL joins only for pooled rows.

## Tiers

1. real users matching all filters, under the 24h cap (5 deliveries)
2. real users matching all filters, over the cap (fairness/penalty still apply)
3. dummy users matching all filters
4. dummy users with filters relaxed in order radius → age → country → gender
   (gender kept as long as possible); scored against the original filters so
   distance still prefers the nearest dummy.

Dummies: 360 seeded (30 countries from `client/lib/countries.ts` × F/M/NB ×
age bands 18-24/25-34/35-44/45+) plus the 5 original India dummies; all have a
city location. DOB is pinned to mid-year so each stays inside its band.

## Score (0–100)

| entity | weight | formula |
|---|---|---|
| recently active | 50 % | 50 · (1 − hours since last active / 72); 0 after 72 h |
| shared interests | 30 % | 30 · shared tags / min(sender tags, candidate tags) |
| pending planes | 20 % | 20 · (1 − min(unanswered planes in inbox, 4) / 4) |

Distance, age, gender and country are hard filters (applied before scoring),
not score components.

Selection: weighted random among the top 8 with weight
`exp((score − best)/6)` — a 6-point gap is a 2.7× lower chance, so the best
match usually wins but the same people don't receive every plane.

Tunables are constants at the top of `scoring.go` / `dispatcher.go`.

## Indexes added

`idx_planes_searching`, `idx_planes_pending_dummy`, `uq_plane_deliveries_one_pending`,
`idx_profile_stats_last_active`, `idx_profiles_matchable (is_dummy, gender)`,
`idx_profiles_country_norm (lower(trim(country)))`, `idx_profiles_geo (lat, lng)`.
