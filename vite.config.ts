import { defineConfig, loadEnv, type Plugin } from "vite";
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

// Content Security Policy solo in build (in dev Vite inietta script inline per l'HMR).
// Script solo dal proprio origin: un eventuale XSS non può caricare codice esterno;
// le connessioni di rete sono limitate al progetto Supabase configurato.
const contentSecurityPolicy = (supabaseUrl: string | undefined): Plugin => {
  let supabase = "https://*.supabase.co wss://*.supabase.co";
  try {
    if (supabaseUrl) {
      const url = new URL(supabaseUrl);
      supabase = `${url.origin} ${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`;
    }
  } catch {
    // URL non valido: resta il fallback generico
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ");
  return {
    name: "studyos-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<meta charset=\"UTF-8\" />",
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`
      );
    }
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: "./",
    plugins: [react(), precacheManifest(), contentSecurityPolicy(env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)]
  };
});
