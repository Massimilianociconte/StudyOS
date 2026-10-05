// Dataset BARB mostrato dalla PWA = seed verificato a mano + overlay sincronizzato
// (barb.synced.json, generato SOLO da `npm run barb:sync -- --apply` / `npm run barb:apply`).

import { BARB_SEED } from "./barb.seed";
import syncedJson from "./barb.synced.json" with { type: "json" };
import { mergeUniversityDataset } from "../../lib/university/merge";
import { contentHash } from "../../lib/university/validate";
import type { UniversitySyncedData } from "../../lib/university/types";

export const BARB_SYNCED = syncedJson as unknown as UniversitySyncedData;

export const BARB_DATASET = mergeUniversityDataset(BARB_SEED, BARB_SYNCED);

/** Cambia a ogni nuovo seed/overlay: usato per aggiornare il mirror IndexedDB solo quando serve. */
export const BARB_DATASET_VERSION = contentHash(
  `${BARB_SEED.exportedAt}|${BARB_SYNCED.generatedAt}|${BARB_DATASET.courses.length}|${BARB_DATASET.teachers.length}`
);
