package planes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"runtime/debug"
	"time"

	"lib/stdid"

	"serving/app/pkg/logx"
)

// Async plane pipeline
//
//	POST /v1/planes ──► Send: spend 1 plane + INSERT plane (next_attempt_at = now)
//	                    in ONE statement, enqueue dispatch job, return 202.
//	worker pool ──────► dispatchPlane: lock plane FOR UPDATE SKIP LOCKED (guard:
//	                    status='pending' AND next_attempt_at IS NOT NULL), pick a
//	                    recipient, INSERT delivery, clear next_attempt_at, commit,
//	                    then notify (EventSink + plane.outbox.updated).
//	reject ───────────► delivery rejected + next_attempt_at = now → re-dispatch.
//	sweeper (ticker) ─► expire planes past expires_at, re-enqueue searching planes
//	                    whose next_attempt_at is due (retries / lost jobs), and
//	                    settle dummy auto-accepts.
//
// Double delivery is impossible: the plane row lock + status-guarded predicate
// serialises dispatchers, and uq_plane_deliveries_one_pending enforces at most
// one pending delivery per plane at the database level.
const (
	DispatchWorkers   = 4
	DispatchQueueSize = 1024
	SweepInterval     = 30 * time.Second
	SweepBatch        = 100
	jobTimeout        = 15 * time.Second
	retryBaseDelay    = 15 * time.Second
	retryMaxDelay     = 10 * time.Minute
)

type jobKind uint8

const (
	jobDispatch jobKind = iota + 1
	jobSettleDummy
)

type job struct {
	kind    jobKind
	planeID stdid.UUID
}

// Start launches the dispatcher workers and the sweeper. Safe to call once;
// later calls are no-ops.
func (s *Service) Start(parent context.Context) {
	if !s.started.CompareAndSwap(false, true) {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	s.runCtx = ctx
	s.cancel = cancel
	s.refreshBlocksSupport(ctx)
	for i := 0; i < DispatchWorkers; i++ {
		s.wg.Add(1)
		go s.worker(ctx)
	}
	s.wg.Add(1)
	go s.sweeper(ctx)
	logx.Info("plane dispatcher started", "workers", DispatchWorkers, "sweep_interval", SweepInterval.String())
}

// Stop cancels workers/sweeper and waits (bounded) for in-flight jobs.
func (s *Service) Stop() {
	if s.cancel == nil {
		return
	}
	s.cancel()
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		logx.Warn("plane dispatcher stop timed out")
	}
}

// enqueue never blocks: if the queue is full the sweeper picks the work up.
func (s *Service) enqueue(j job) bool {
	select {
	case s.jobs <- j:
		return true
	default:
		logx.Warn("plane dispatch queue full; sweeper will retry", "plane_id", j.planeID.String())
		return false
	}
}

func (s *Service) worker(ctx context.Context) {
	defer s.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case j := <-s.jobs:
			s.runJob(ctx, j)
		}
	}
}

func (s *Service) runJob(parent context.Context, j job) {
	defer func() {
		if r := recover(); r != nil {
			logx.Error("plane job panic", fmt.Errorf("%v", r), "plane_id", j.planeID.String(), "stack", string(debug.Stack()))
		}
	}()
	ctx, cancel := context.WithTimeout(parent, jobTimeout)
	defer cancel()
	var err error
	switch j.kind {
	case jobDispatch:
		err = s.dispatchPlane(ctx, j.planeID)
	case jobSettleDummy:
		err = s.settleDummyPlane(ctx, j.planeID)
	}
	if err != nil && !errors.Is(err, context.Canceled) {
		logx.Error("plane job failed", err, "plane_id", j.planeID.String(), "kind", int(j.kind))
	}
}

func (s *Service) sweeper(ctx context.Context) {
	defer s.wg.Done()
	t := time.NewTicker(SweepInterval)
	defer t.Stop()
	s.sweep(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.sweep(ctx)
		}
	}
}

func (s *Service) sweep(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, jobTimeout)
	defer cancel()
	s.refreshBlocksSupport(ctx)
	if err := s.expireDuePlanes(ctx); err != nil && ctx.Err() == nil {
		logx.Error("plane sweep: expire", err)
	}
	ids, err := s.dueSearchingPlanes(ctx)
	if err != nil && ctx.Err() == nil {
		logx.Error("plane sweep: searching", err)
	}
	for _, id := range ids {
		s.enqueue(job{kind: jobDispatch, planeID: id})
	}
	ids, err = s.dueDummySettles(ctx)
	if err != nil && ctx.Err() == nil {
		logx.Error("plane sweep: dummy settle", err)
	}
	for _, id := range ids {
		s.enqueue(job{kind: jobSettleDummy, planeID: id})
	}
}

func (s *Service) refreshBlocksSupport(ctx context.Context) {
	var ok bool
	if err := s.db.QueryRowContext(ctx, `SELECT to_regclass('public.user_blocks') IS NOT NULL`).Scan(&ok); err != nil {
		return
	}
	s.blocksEnabled.Store(ok)
}

func retryBackoff(attempt int) time.Duration {
	d := retryBaseDelay
	for i := 1; i < attempt && d < retryMaxDelay; i++ {
		d *= 2
	}
	return min(d, retryMaxDelay)
}

// dispatchPlane delivers a searching plane to its next recipient.
func (s *Service) dispatchPlane(ctx context.Context, planeID stdid.UUID) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var (
		senderID    stdid.UUID
		message     string
		filtersJSON []byte
		expiresAt   time.Time
		attempts    int
	)
	err = tx.QueryRowContext(ctx, `
		SELECT sender_account_id, message, filters, expires_at, dispatch_attempts
		FROM planes
		WHERE id = $1 AND status = 'pending' AND next_attempt_at IS NOT NULL
		FOR UPDATE SKIP LOCKED
	`, planeID).Scan(&senderID, &message, &filtersJSON, &expiresAt, &attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return nil // already handled / locked by another worker / not searching
	}
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	if !now.Before(expiresAt) {
		if _, err := tx.ExecContext(ctx, `
			UPDATE planes SET status = 'expired', next_attempt_at = NULL, updated_at = NOW()
			WHERE id = $1 AND status = 'pending'
		`, planeID); err != nil {
			return err
		}
		hops, rejections, err := planeCounts(ctx, tx, planeID)
		if err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		s.notifyOutbox(senderID, OutboxEvent{
			PlaneID: planeID.String(), State: StateExpired, Status: StatusExpired,
			Hops: hops, Rejections: rejections,
		})
		return nil
	}

	sender, err := s.loadProfileTx(ctx, tx, senderID)
	if err != nil {
		return err
	}
	var filters Filters
	_ = json.Unmarshal(filtersJSON, &filters)

	res, err := s.pickRecipient(ctx, tx, sender, filters, planeID)
	if errors.Is(err, ErrNoCandidates) {
		attempts++
		next := now.Add(retryBackoff(attempts))
		if next.After(expiresAt) {
			next = expiresAt
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE planes SET dispatch_attempts = $2, next_attempt_at = $3, updated_at = NOW()
			WHERE id = $1
		`, planeID, attempts, next); err != nil {
			return err
		}
		logx.Warn("plane dispatch: no candidates; will retry",
			"plane_id", planeID.String(), "attempt", attempts, "next_attempt_at", next.Format(time.RFC3339))
		return tx.Commit()
	}
	if err != nil {
		return err
	}

	deliveryID, err := stdid.New()
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO plane_deliveries (id, plane_id, recipient_account_id, status, delivered_at)
		VALUES ($1, $2, $3, 'pending', $4)
	`, deliveryID, planeID, res.AccountID, now); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE planes
		SET next_attempt_at = NULL, dispatch_attempts = 0, recipient_is_dummy = $2, updated_at = NOW()
		WHERE id = $1
	`, planeID, res.IsDummy); err != nil {
		return err
	}
	hops, rejections, err := planeCounts(ctx, tx, planeID)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	logPick(planeID, senderID, res)

	if res.IsDummy {
		s.scheduleDummySettle(planeID)
	} else if s.events != nil {
		if err := s.events.PlaneDelivered(ctx, res.AccountID, coalesceName(sender.Name, sender.Username),
			planeID.String(), messagePreview(message)); err != nil {
			logx.Warn("plane delivered event failed", "plane_id", planeID.String(), "recipient_id", res.AccountID.String(), "err", err)
		}
	}
	s.notifyOutbox(senderID, OutboxEvent{
		PlaneID: planeID.String(), State: StateDelivered, Status: StatusPending,
		Hops: hops, Rejections: rejections, RecipientIsDummy: res.IsDummy,
		Recipient: recipientPreview(res.Candidate),
	})
	return nil
}

func (s *Service) scheduleDummySettle(planeID stdid.UUID) {
	ctx := s.runCtx
	if ctx == nil {
		return // dispatcher not started; the sweeper (if any) will settle it
	}
	time.AfterFunc(DummyAcceptDelay+250*time.Millisecond, func() {
		if ctx.Err() == nil {
			s.enqueue(job{kind: jobSettleDummy, planeID: planeID})
		}
	})
}

func planeCounts(ctx context.Context, q queryer, planeID stdid.UUID) (hops, rejections int, err error) {
	err = q.QueryRowContext(ctx, `
		SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE status = 'rejected')::int
		FROM plane_deliveries WHERE plane_id = $1
	`, planeID).Scan(&hops, &rejections)
	return hops, rejections, err
}

// expireDuePlanes closes pending planes past their lifetime and tells both the
// sender (outbox) and the current recipient (inbox) about it.
func (s *Service) expireDuePlanes(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `
		WITH due AS (
			SELECT id FROM planes
			WHERE status = 'pending' AND expires_at <= NOW()
			ORDER BY expires_at
			LIMIT 200
			FOR UPDATE SKIP LOCKED
		)
		UPDATE planes pl
		SET status = 'expired', next_attempt_at = NULL, updated_at = NOW()
		FROM due
		WHERE pl.id = due.id
		RETURNING
			pl.id, pl.sender_account_id,
			(SELECT pd.recipient_account_id FROM plane_deliveries pd
			 WHERE pd.plane_id = pl.id AND pd.status = 'pending' LIMIT 1),
			(SELECT COUNT(*)::int FROM plane_deliveries pd WHERE pd.plane_id = pl.id),
			(SELECT COUNT(*)::int FROM plane_deliveries pd WHERE pd.plane_id = pl.id AND pd.status = 'rejected')
	`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	type expired struct {
		id, sender       stdid.UUID
		recipient        sql.Null[stdid.UUID]
		hops, rejections int
	}
	var out []expired
	for rows.Next() {
		var e expired
		if err := rows.Scan(&e.id, &e.sender, &e.recipient, &e.hops, &e.rejections); err != nil {
			return err
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, e := range out {
		s.notifyOutbox(e.sender, OutboxEvent{
			PlaneID: e.id.String(), State: StateExpired, Status: StatusExpired,
			Hops: e.hops, Rejections: e.rejections,
		})
		if e.recipient.Valid {
			s.notifyInboxRemoved(e.recipient.V, e.id, "expired")
		}
	}
	if len(out) > 0 {
		logx.Info("planes expired", "count", len(out))
	}
	return nil
}

func (s *Service) dueSearchingPlanes(ctx context.Context) ([]stdid.UUID, error) {
	return s.collectIDs(ctx, `
		SELECT id FROM planes
		WHERE status = 'pending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW()
		ORDER BY next_attempt_at
		LIMIT $1
	`, SweepBatch)
}

func (s *Service) dueDummySettles(ctx context.Context) ([]stdid.UUID, error) {
	return s.collectIDs(ctx, `
		SELECT pl.id
		FROM planes pl
		JOIN plane_deliveries pd ON pd.plane_id = pl.id AND pd.status = 'pending'
		WHERE pl.status = 'pending'
		  AND pl.recipient_is_dummy
		  AND pd.delivered_at <= NOW() - $2::interval
		ORDER BY pd.delivered_at
		LIMIT $1
	`, SweepBatch, dummyDelayInterval())
}

func (s *Service) collectIDs(ctx context.Context, query string, args ...any) ([]stdid.UUID, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var ids []stdid.UUID
	for rows.Next() {
		var id stdid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func dummyDelayInterval() string {
	return fmt.Sprintf("%d milliseconds", DummyAcceptDelay.Milliseconds())
}

func messagePreview(message string) string {
	r := []rune(message)
	if len(r) > 80 {
		return string(r[:80]) + "…"
	}
	return message
}
