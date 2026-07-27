'use client';
import { useEffect, useRef } from 'react';

// Generic polling hook extracted from EstablishConenction.jsx.
// Calls checkFn every `interval` ms until it returns a truthy value,
// then calls onSuccess. Stops after `timeout` ms.
export function usePolling<T>(
  checkFn: () => Promise<T | null | undefined | false>,
  onSuccess: (data: T) => void,
  {
    enabled = true,
    interval = 2000,
    timeout = 180000,
    onTimeout,
  }: {
    enabled?: boolean;
    interval?: number;
    timeout?: number;
    onTimeout?: () => void;
  } = {}
) {
  const successCalled = useRef(false);

  // checkFn/onSuccess/onTimeout are fresh closures every render (they capture
  // whatever state — e.g. oobId — was current at render time). The interval
  // below is only set up once per `enabled` toggle, so without these refs its
  // setInterval callback would keep calling the FIRST render's stale closure
  // forever once `enabled` settles to true — e.g. if a Strict Mode double-
  // invoke (or any re-render) changes which invitation ID checkFn polls for,
  // the interval would silently keep polling the old, already-abandoned one.
  const checkFnRef = useRef(checkFn);
  const onSuccessRef = useRef(onSuccess);
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => { checkFnRef.current = checkFn; }, [checkFn]);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  useEffect(() => {
    if (!enabled) return;
    successCalled.current = false;

    const intervalId = setInterval(async () => {
      try {
        const result = await checkFnRef.current();
        if (result && !successCalled.current) {
          successCalled.current = true;
          clearInterval(intervalId);
          clearTimeout(timeoutId);
          onSuccessRef.current(result as T);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, interval);

    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      onTimeoutRef.current?.();
    }, timeout);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [enabled, interval, timeout]);
}
