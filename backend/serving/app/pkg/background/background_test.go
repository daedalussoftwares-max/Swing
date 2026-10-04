package background

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestPool_RunsAllJobsAndDrainsOnShutdown(t *testing.T) {
	p := New(4, 100)
	var n atomic.Int64
	for i := 0; i < 100; i++ {
		if !p.Submit("count", func(context.Context) {
			time.Sleep(time.Millisecond)
			n.Add(1)
		}) {
			t.Fatalf("submit %d rejected", i)
		}
	}
	if err := p.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := n.Load(); got != 100 {
		t.Fatalf("ran %d jobs, want 100 (Shutdown must drain the queue)", got)
	}
}

func TestPool_BoundsConcurrency(t *testing.T) {
	const workers = 3
	p := New(workers, 50)
	var cur, peak atomic.Int64
	for i := 0; i < 30; i++ {
		p.Submit("peak", func(context.Context) {
			c := cur.Add(1)
			for {
				old := peak.Load()
				if c <= old || peak.CompareAndSwap(old, c) {
					break
				}
			}
			time.Sleep(2 * time.Millisecond)
			cur.Add(-1)
		})
	}
	if err := p.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if peak.Load() > workers {
		t.Fatalf("peak concurrency %d > %d workers", peak.Load(), workers)
	}
}

func TestPool_DropsWhenQueueFull(t *testing.T) {
	p := New(1, 2)
	release := make(chan struct{})
	started := make(chan struct{})
	p.Submit("blocker", func(context.Context) { close(started); <-release })
	<-started // the only worker is busy; queue is empty
	if !p.Submit("q1", func(context.Context) {}) || !p.Submit("q2", func(context.Context) {}) {
		t.Fatal("queue should accept 2 jobs")
	}
	if p.Submit("overflow", func(context.Context) {}) {
		t.Fatal("submit to a full queue should be rejected")
	}
	if p.Dropped() != 1 {
		t.Fatalf("dropped = %d, want 1", p.Dropped())
	}
	close(release)
	if err := p.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestPool_RejectsAfterShutdown(t *testing.T) {
	p := New(1, 1)
	if err := p.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if p.Submit("late", func(context.Context) { t.Error("must not run") }) {
		t.Fatal("submit after shutdown should be rejected")
	}
	if err := p.Shutdown(context.Background()); !errors.Is(err, ErrClosed) {
		t.Fatalf("second Shutdown = %v, want ErrClosed", err)
	}
}

func TestPool_ShutdownTimeoutCancelsJobContext(t *testing.T) {
	p := New(1, 1)
	cancelled := make(chan struct{})
	p.Submit("slow", func(ctx context.Context) {
		<-ctx.Done()
		close(cancelled)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := p.Shutdown(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Shutdown = %v, want DeadlineExceeded", err)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("job context was not cancelled after shutdown timeout")
	}
}

func TestPool_RecoversPanics(t *testing.T) {
	p := New(1, 4)
	var ran sync.WaitGroup
	ran.Add(1)
	p.Submit("boom", func(context.Context) { panic("boom") })
	p.Submit("after", func(context.Context) { ran.Done() })
	ran.Wait() // the worker survived the panic
	if err := p.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestPool_ConcurrentSubmitAndShutdown(t *testing.T) {
	// Must not panic with "send on closed channel" (run with -race).
	p := New(2, 8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				p.Submit("race", func(context.Context) {})
			}
		}()
	}
	time.Sleep(time.Millisecond)
	_ = p.Shutdown(context.Background())
	wg.Wait()
}
