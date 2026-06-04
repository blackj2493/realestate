import { describe, it, expect } from 'vitest';
import { makeTimeoutFetch } from './timeoutFetch';

describe('makeTimeoutFetch', () => {
  it('passes a successful response through without aborting', async () => {
    const fakeResponse = { ok: true } as Response;
    let signalAbortedAtCall = true;
    const fetchImpl = (async (_input: unknown, init: { signal?: AbortSignal }) => {
      signalAbortedAtCall = !!init?.signal?.aborted;
      return fakeResponse;
    }) as unknown as typeof fetch;

    const tf = makeTimeoutFetch(fetchImpl, 1000);
    const res = await tf('https://example.com');

    expect(res).toBe(fakeResponse);
    expect(signalAbortedAtCall).toBe(false);
  });

  it('aborts the request once the timeout elapses (the dead-origin case)', async () => {
    // A fetch that only settles when its signal aborts — simulates a hung origin.
    const hangingFetch = ((_input: unknown, init: { signal: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(init.signal.reason ?? new Error('aborted')),
        );
      })) as unknown as typeof fetch;

    const tf = makeTimeoutFetch(hangingFetch, 20);
    await expect(tf('https://example.com')).rejects.toThrow(/exceeded 20ms/);
  });

  it('honours a caller signal that is already aborted', async () => {
    const hangingFetch = ((_input: unknown, init: { signal: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal.aborted) reject(init.signal.reason ?? new Error('aborted'));
        init.signal.addEventListener('abort', () =>
          reject(init.signal.reason ?? new Error('aborted')),
        );
      })) as unknown as typeof fetch;

    const caller = new AbortController();
    caller.abort(new Error('caller cancelled'));

    const tf = makeTimeoutFetch(hangingFetch, 1000);
    await expect(tf('https://example.com', { signal: caller.signal })).rejects.toThrow(
      /caller cancelled/,
    );
  });
});
