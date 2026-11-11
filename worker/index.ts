import { DurableObject } from "cloudflare:workers";
import { PUBLISHED_HOST } from "../src/agent/hubEndpoint";
import { HttpHub, type HubSnapshot } from "../src/agent/httpHub";
import { createCloudRunner } from "../src/agent/cloudRunner";

interface Env {
  HUB: DurableObjectNamespace<StudyHubObject>;
  STUDYOS_PAIR_KEY: string;
  /** URL del progetto Supabase e chiave publishable: solo per il connettore remoto. */
  STUDYOS_SUPABASE_URL?: string;
  STUDYOS_SUPABASE_KEY?: string;
}

const PUBLISHED_ORIGIN = `https://${PUBLISHED_HOST}`;

export class StudyHubObject extends DurableObject<Env> {
  private hub: HttpHub | null = null;
  private opening: Promise<HttpHub> | null = null;

  private open(issuer: string) {
    if (this.hub) return Promise.resolve(this.hub);
    this.opening ??= this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<HubSnapshot>("snapshot");
      const origin = stored?.issuer || issuer;
      // Connettore remoto di ogni account: legge e scrive i dati cloud con la chiave publishable.
      const cloud = this.env.STUDYOS_SUPABASE_URL && this.env.STUDYOS_SUPABASE_KEY
        ? createCloudRunner({ url: this.env.STUDYOS_SUPABASE_URL, key: this.env.STUDYOS_SUPABASE_KEY })
        : undefined;
      const hub = new HttpHub({
        cloud,
        issuer: origin,
        canonical: `${origin}/mcp`,
        secureCookies: origin.startsWith("https://"),
        pairMode: "key",
        pairKey: this.env.STUDYOS_PAIR_KEY ?? "",
        disconnectedHint: "StudyOS non risulta collegato. Apri il sito pubblicato, anche dal telefono, vai in Impostazioni → Agenti e collega questo browser con la chiave.",
        allowHost: (host) => {
          try {
            return new URL(origin).host.toLowerCase() === host.toLowerCase();
          } catch {
            return false;
          }
        },
        allowOrigin: (requestOrigin, mcp) => {
          if (!requestOrigin) return mcp;
          if (requestOrigin === PUBLISHED_ORIGIN || requestOrigin === origin) return true;
          if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(requestOrigin)) return true;
          // /mcp vuole sempre il token Bearer: qualsiasi client web in https (ChatGPT, Claude, Grok, Gemini, ispettori MCP) può chiamarlo.
          if (mcp && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(requestOrigin)) return true;
          return false;
        },
        persist: async () => {
          await this.ctx.storage.put("snapshot", hub.exportState());
        }
      });
      if (stored?.bridgeToken && stored.serviceToken) hub.importState(stored);
      await this.ctx.storage.put("snapshot", hub.exportState());
      this.hub = hub;
      return hub;
    });
    return this.opening;
  }

  async fetch(request: Request) {
    const hub = await this.open(new URL(request.url).origin);
    return hub.handle(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.HUB.getByName("owner").fetch(request);
  }
};
