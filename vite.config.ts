import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Elenco dei file della build per il service worker (precache di tutte le viste lazy,
// così l'app funziona offline anche nelle sezioni mai aperte prima).
const precacheManifest = (): Plugin => ({
  name: "studyos-precache-manifest",
  apply: "build",
  generateBundle(_options, bundle) {
    const files = Object.keys(bundle)
      .filter((file) => /\.(js|css|woff2?|svg|png|webp)$/.test(file))
      .sort();
    this.emitFile({
      type: "asset",
      fileName: "precache-manifest.json",
      source: JSON.stringify({ builtAt: new Date().toISOString(), files }, null, 2)
    });
  }
});

export default defineConfig({
  base: "./",
  plugins: [react(), precacheManifest()]
});
