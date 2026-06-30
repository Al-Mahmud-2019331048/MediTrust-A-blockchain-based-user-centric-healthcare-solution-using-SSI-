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

  useEffect(() => {
    if (!enabled) return;
    successCalled.current = false;

    const intervalId = setInterval(async () => {
      try {
        const result = await checkFn();
        if (result && !successCalled.current) {
          successCalled.current = true;
          clearInterval(intervalId);
          clearTimeout(timeoutId);
          onSuccess(result as T);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, interval);

    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      onTimeout?.();
    }, timeout);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [enabled]);
}
