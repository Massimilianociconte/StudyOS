// I due account di prova dello stack LOCALE (scripts/supabase/local-stack.md). Esistono solo lì:
// il global setup li crea se mancano. Non sono credenziali di un servizio reale.

export interface TestAccount {
  label: "alice" | "bob";
  email: string;
  password: string;
  /** Nome che l'app mostra senza un nome nel profilo: la parte locale dell'email. */
  name: string;
}

const LOCAL_PASSWORD = process.env.E2E_PASSWORD ?? "Prova-Locale-2026!";

export const ACCOUNTS: Record<"alice" | "bob", TestAccount> = {
  alice: { label: "alice", email: "alice@studyos.test", password: LOCAL_PASSWORD, name: "alice" },
  bob: { label: "bob", email: "bob@studyos.test", password: LOCAL_PASSWORD, name: "bob" }
};
