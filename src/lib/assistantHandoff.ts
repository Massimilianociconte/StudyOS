// Ponte verso gli assistenti per le richieste «Spiegami meglio» e «Chiedi un'analisi». ChatGPT e Claude
// usano StudyOS solo quando la persona scrive loro: con MCP è l'assistente che chiama gli strumenti, e
// nessun server può scrivere in una sua chat, neanche se è aperta. La richiesta parte quindi da un
// messaggio della persona. Il messaggio non porta il testo della scheda né il dubbio (finirebbero
// nell'indirizzo): l'assistente li legge con studyos_list_ai_requests. Porta solo il nome del profilo,
// che il connettore principale usa per scegliere l'account (il remoto lo ignora).
import { requestStatusAt } from "./learningModel";
import type { AiRequest } from "../types";

/** Nuova chat di ChatGPT con il messaggio già scritto (se il sito non lo inserisce, la persona lo incolla). */
export const chatGptUrl = (message: string) => `https://chatgpt.com/?q=${encodeURIComponent(message)}`;

/** Nuova chat di Claude con il messaggio già scritto (se il sito non lo inserisce, la persona lo incolla). */
export const claudeUrl = (message: string) => `https://claude.ai/new?q=${encodeURIComponent(message)}`;

/** Richieste che nessun assistente ha ancora preso: sono quelle per cui serve il messaggio. */
export const waitingRequests = (requests: readonly AiRequest[], at = new Date()) =>
  requests.filter((request) => requestStatusAt(request, at) === "pending").length;
