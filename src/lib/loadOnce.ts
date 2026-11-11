/**
 * Caricamento pigro condiviso: la prima chiamata avvia `load`, le altre (anche in contemporanea)
 * ricevono la stessa promessa. Se fallisce non resta in memoria: la chiamata dopo riprova.
 */
export const loadOnce = <T>(load: () => Promise<T>) => {
  let pending: Promise<T> | null = null;
  return (): Promise<T> => {
    if (!pending) {
      const loading = load();
      pending = loading;
      loading.catch(() => {
        if (pending === loading) pending = null;
      });
    }
    return pending;
  };
};
