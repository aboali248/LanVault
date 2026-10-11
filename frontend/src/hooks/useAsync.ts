import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const value = await loader();
      if (mounted.current) setData(value);
      return value;
    } catch (caught) {
      const normalized = caught instanceof Error ? caught : new Error('Unknown error');
      if (mounted.current) setError(normalized);
      return undefined;
    } finally {
      if (mounted.current) setLoading(false);
    }
  // loader is intentionally passed by caller as a stable callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; };
  }, [reload]);

  return { data, error, loading, reload, setData };
}
