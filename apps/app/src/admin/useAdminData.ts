import { useCallback, useEffect, useState } from "react";

export function useAdminData<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await loader());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Request failed"));
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    let current = true;
    void loader()
      .then((next) => {
        if (current) setData(next);
      })
      .catch((cause: unknown) => {
        if (current) {
          setError(
            cause instanceof Error ? cause : new Error("Request failed"),
          );
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [loader]);

  return { data, error, loading, refresh };
}
