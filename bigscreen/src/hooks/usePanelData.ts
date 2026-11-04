import { useEffect, useState } from "react";

export interface PanelDataState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Load panel data with cancellation; errors surface as user-readable text. */
export function usePanelData<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): PanelDataState<T> {
  const [state, setState] = useState<PanelDataState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: null, loading: true });
    load()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // deps is owned by the caller; load is a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
