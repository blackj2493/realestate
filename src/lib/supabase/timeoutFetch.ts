/**
 * Wraps a fetch implementation with an AbortController timeout so a dead or
 * unreachable origin fails fast and retryable instead of hanging.
 *
 * Background: the Supabase clients inject `cross-fetch` with NO timeout. During
 * the 2026-06-04 outage (compute Unhealthy → Cloudflare 522) every call hung on a
 * half-open TCP connection until the OS gave up — ~20 s+ per request, surfaced as
 * `undefined`. A bounded timeout turns that into a prompt rejection that the ETL's
 * own retry/backoff can handle.
 *
 * Any caller-supplied AbortSignal (supabase-js may pass one via `.abortSignal(...)`)
 * is chained, so this never clobbers caller-initiated cancellation.
 */
export function makeTimeoutFetch(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Supabase request exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );

    const callerSignal = init?.signal;
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort(callerSignal.reason);
      } else {
        callerSignal.addEventListener('abort', () => controller.abort(callerSignal.reason), {
          once: true,
        });
      }
    }

    return fetchImpl(input, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  };
}
