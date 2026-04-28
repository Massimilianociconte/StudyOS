export const createId = (prefix = "id") =>
  `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;

export const nowIso = () => new Date().toISOString();
