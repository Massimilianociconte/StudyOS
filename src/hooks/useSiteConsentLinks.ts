import { useEffect, useState } from "react";
import { readSiteConsent, saveSiteConsent, SITE_CONSENT_EVENT, siteConsentIdFromUrl, urlWithoutSiteConsent } from "../lib/siteConsentLink";

/**
 * Link `#collega=<id>` della pagina di consenso del connettore remoto: all'avvio (o se cambia il
 * frammento) lo ricorda e pulisce l'URL. Il dialogo compare quando l'app è pronta (anche dopo lo sblocco).
 */
export function useSiteConsentLinks() {
  useEffect(() => {
    const capture = () => {
      const id = siteConsentIdFromUrl(window.location.href);
      if (!id) return;
      saveSiteConsent(id);
      window.history.replaceState(window.history.state, "", urlWithoutSiteConsent(window.location.href));
    };
    capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);
}

/** Richiesta di collegamento in attesa di conferma su questo dispositivo ("" = nessuna). */
export function usePendingSiteConsent() {
  const [id, setId] = useState(() => readSiteConsent());
  useEffect(() => {
    const update = () => setId(readSiteConsent());
    window.addEventListener(SITE_CONSENT_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(SITE_CONSENT_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return id;
}
