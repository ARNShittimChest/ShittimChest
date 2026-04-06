/**
 * arona/push/pending-store.ts
 * In-memory queue for pending push messages.
 *
 * The iOS app polls GET /arona/push/pending via BGAppRefreshTask.
 * Each poll drains (consume-once) the queue so messages are shown exactly once.
 *
 * Long-poll support: waitForPending() holds the connection open until a message
 * arrives or timeout expires, enabling near-instant notification delivery.
 *
 * No persistence needed — the gateway is local and messages are ephemeral.
 */

export type PendingMessage = {
  title: string;
  body: string;
  queuedAt: string; // ISO 8601
};

const queue: PendingMessage[] = [];

/** Waiters for long-poll — resolved when a message arrives. */
type LongPollWaiter = {
  resolve: (msgs: PendingMessage[]) => void;
  timer: ReturnType<typeof setTimeout>;
};
const waiters: LongPollWaiter[] = [];

/** Add a message to the pending queue and wake any long-poll waiters. */
export function enqueuePush(msg: { title: string; body: string }): void {
  queue.push({
    title: msg.title,
    body: msg.body,
    queuedAt: new Date().toISOString(),
  });
  // Wake all long-poll waiters immediately
  flushWaiters();
}

/**
 * Drain all pending messages and clear the queue.
 * Called by the iOS app on each background fetch.
 */
export function drainPending(): PendingMessage[] {
  return queue.splice(0);
}

/**
 * Long-poll: wait for pending messages up to `timeoutMs`.
 * If messages are already queued, returns immediately.
 * Otherwise, holds until a new message arrives or timeout.
 */
export function waitForPending(timeoutMs: number = 25000): Promise<PendingMessage[]> {
  // If messages are already queued, return immediately
  if (queue.length > 0) {
    return Promise.resolve(drainPending());
  }

  return new Promise<PendingMessage[]>((resolve) => {
    const timer = setTimeout(() => {
      // Timeout — remove this waiter and return whatever is queued (likely empty)
      const idx = waiters.findIndex((w) => w.resolve === resolve);
      if (idx >= 0) waiters.splice(idx, 1);
      resolve(drainPending());
    }, timeoutMs);

    waiters.push({ resolve, timer });
  });
}

/** Wake all long-poll waiters with current queue contents. */
function flushWaiters(): void {
  if (waiters.length === 0) return;
  const msgs = drainPending();
  const toNotify = waiters.splice(0);
  for (const w of toNotify) {
    clearTimeout(w.timer);
    w.resolve(msgs);
  }
}

/** Peek current queue length (for debug/status). */
export function pendingCount(): number {
  return queue.length;
}
