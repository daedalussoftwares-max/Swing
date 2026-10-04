// Package background runs fire-and-forget work (push notifications, in-app
// notifications) on a fixed number of workers fed by a bounded queue, so a
// burst of messages can never spawn an unbounded number of goroutines, and
// shutdown can wait for in-flight work before the DB is closed.
package background

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"serving/app/pkg/logx"
)

const (
	// DefaultWorkers is the worker count of the process-wide Default pool.
	DefaultWorkers = 16
	// DefaultQueueSize is how many jobs may wait before Submit drops work.
	DefaultQueueSize = 1024
)

// ErrClosed is returned by Shutdown when called more than once.
var ErrClosed = errors.New("background: pool already shut down")

type job struct {
	name string
	fn   func(ctx context.Context)
}

// Pool is a fixed-size worker pool with a bounded queue. Safe for
// concurrent use.
type Pool struct {
	jobs   chan job
	ctx    context.Context // passed to jobs; cancelled if Shutdown times out
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu     sync.RWMutex // guards closed + sends on jobs vs close(jobs)
	closed bool

	dropped atomic.Int64
}

// New starts a pool with the given number of workers and queue capacity
// (both clamped to at least 1).
func New(workers, queueSize int) *Pool {
	if workers < 1 {
		workers = 1
	}
	if queueSize < 1 {
		queueSize = 1
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &Pool{
		jobs:   make(chan job, queueSize),
		ctx:    ctx,
		cancel: cancel,
	}
	p.wg.Add(workers)
	for i := 0; i < workers; i++ {
		go p.worker()
	}
	return p
}

func (p *Pool) worker() {
	defer p.wg.Done()
	for j := range p.jobs {
		p.run(j)
	}
}

func (p *Pool) run(j job) {
	defer func() {
		if r := recover(); r != nil {
			logx.Error("background: job panic", fmt.Errorf("%v", r), "job", j.name)
		}
	}()
	j.fn(p.ctx)
}

// Submit queues fn without blocking. It returns false (and logs) when the
// queue is full or the pool is shutting down; the work is then dropped.
// fn receives a context that is cancelled only if Shutdown runs out of
// time, so jobs should still apply their own timeouts.
func (p *Pool) Submit(name string, fn func(ctx context.Context)) bool {
	if fn == nil {
		return false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.closed {
		p.dropped.Add(1)
		logx.Warn("background: pool shut down, dropping job", "job", name)
		return false
	}
	select {
	case p.jobs <- job{name: name, fn: fn}:
		return true
	default:
		n := p.dropped.Add(1)
		logx.Warn("background: queue full, dropping job", "job", name, "dropped_total", n)
		return false
	}
}

// Dropped reports how many jobs were rejected so far.
func (p *Pool) Dropped() int64 { return p.dropped.Load() }

// Shutdown stops accepting work and waits until every queued and running
// job has finished, or ctx is done. On timeout the jobs' context is
// cancelled and ctx.Err() is returned (workers keep draining in the
// background with a cancelled context).
func (p *Pool) Shutdown(ctx context.Context) error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return ErrClosed
	}
	p.closed = true
	close(p.jobs)
	p.mu.Unlock()

	done := make(chan struct{})
	go func() {
		p.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		p.cancel()
		return nil
	case <-ctx.Done():
		p.cancel()
		return ctx.Err()
	}
}

var (
	defaultOnce sync.Once
	defaultPool *Pool
)

// Default returns the process-wide pool, starting it on first use.
func Default() *Pool {
	defaultOnce.Do(func() {
		defaultPool = New(DefaultWorkers, DefaultQueueSize)
	})
	return defaultPool
}

// Submit queues fn on the Default pool. See Pool.Submit.
func Submit(name string, fn func(ctx context.Context)) bool {
	return Default().Submit(name, fn)
}

// Shutdown drains the Default pool. See Pool.Shutdown.
func Shutdown(ctx context.Context) error {
	return Default().Shutdown(ctx)
}
