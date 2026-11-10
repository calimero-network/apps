/**
 * Each app's dev server, on its own origin as each app is on its own host in
 * production. `merod local` trusts passkey ceremonies from all three (the
 * setup passes `--origins`); every one is `localhost`, the relying party a
 * passkey belongs to, so one person's passkey signs them in to all three.
 */
export const ORIGINS = {
  home: "http://localhost:5173",
  chat: "http://localhost:3000",
  kv: "http://localhost:5174",
} as const;
