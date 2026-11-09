import { DurableObject } from "cloudflare:workers";
import { PUBLISHED_HOST } from "../src/agent/hubEndpoint";
import { HttpHub, type HubSnapshot } from "../src/agent/httpHub";

interface Env {
  HUB: DurableObjectNamespace<StudyHubObject>;
  STUDYOS_PAIR_KEY: string;
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
      const hub = new HttpHub({
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
          if (mcp && /^https:\/\/([a-z0-9-]+\.)?(chatgpt\.com|chat\.openai\.com|claude\.ai|claude\.com)$/.test(requestOrigin)) return true;
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
