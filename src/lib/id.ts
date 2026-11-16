export const createId = (prefix = "id") =>
  `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;

export const nowIso = () => new Date().toISOString();

/** FNV-1a a 32 bit con seme e moltiplicatore scelti: due passate diverse fanno 64 bit. */
const fnv = (value: string, seed: number, prime: number) => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), prime) >>> 0;
  return hash.toString(36).padStart(7, "0");
};

/**
 * Id stabile per una chiave esterna (externalRef) in un ambito (raccolta, quiz, account): due agenti
 * che creano la stessa chiave nello stesso istante scrivono la stessa riga, e il database rifiuta la
 * seconda versione (agent.sql) invece di lasciare un doppione. Se l'id è già usato (la scheda con
 * quella chiave è stata spostata altrove) se ne crea uno nuovo.
 */
export const stableId = (prefix: string, scope: string, ref: string, taken: (id: string) => boolean) => {
  const key = `${scope}\u0000${ref}`;
  const id = `${prefix}_x${fnv(key, 0x811c9dc5, 0x01000193)}${fnv(key, 0x9747b28c, 0x5bd1e995)}`;
  return taken(id) ? createId(prefix) : id;
};
