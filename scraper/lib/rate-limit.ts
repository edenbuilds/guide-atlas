/**
 * Rate limiting primitives for the Firecrawl client.
 *
 * Firecrawl enforces two independent limits:
 *   1. a per-team concurrency cap (see GET /v2/concurrency-check) — exceeding it queues jobs
 *      server-side and slows everything down;
 *   2. a requests-per-minute cap per endpoint — exceeding it returns HTTP 429 with Retry-After.
 *
 * We model (1) with a semaphore and (2) with a token bucket, and wrap calls in a retry loop that
 * honours Retry-After and backs off exponentially with jitter on 429 / 5xx / network failures.
 */

export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private max: number) {
    if (max < 1) throw new Error("Semaphore max must be >= 1");
  }

  setMax(max: number) {
    this.max = Math.max(1, max);
    this.drain();
  }

  get inFlight() {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    // drain() reserves the slot (active++) on our behalf before resolving.
    await new Promise<void>((resolve) => this.queue.push(resolve));
    return () => this.release();
  }

  private release() {
    this.active--;
    this.drain();
  }

  private drain() {
    while (this.active < this.max && this.queue.length > 0) {
      this.active++;
      this.queue.shift()!();
    }
  }
}

export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();

  /**
   * @param capacity   maximum burst size
   * @param refillPerMs tokens added per millisecond (e.g. 60/min => 60 / 60_000)
   */
  constructor(
    private capacity: number,
    private refillPerMs: number,
  ) {
    this.tokens = capacity;
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = now;
    }
  }

  async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
      await sleep(Math.min(waitMs, 5_000));
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 429 || error.status === 408 || error.status >= 500;
  }
  if (error instanceof Error) {
    // undici / fetch network failures
    const code = (error as NodeJS.ErrnoException).code ?? "";
    return (
      /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|UND_ERR|fetch failed|aborted/i.test(
        `${code} ${error.message}`,
      )
    );
  }
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 1_500;
  const max = opts.maxDelayMs ?? 45_000;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt > retries || !isRetryable(error)) throw error;

      const retryAfter = error instanceof HttpError ? error.retryAfterMs : undefined;
      const exponential = Math.min(max, base * 2 ** (attempt - 1));
      const jitter = Math.random() * 0.4 * exponential;
      const delayMs = Math.max(retryAfter ?? 0, exponential + jitter);

      opts.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
