/**
 * Local Firebase Admin probe (loads .env from project root).
 * Usage: node scripts/probe-firebase-admin.mjs
 * Does not print secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "repair-series";

const adminUrl = pathToFileURL(resolve(root, "src/lib/firebase/admin.ts")).href;
const errUrl = pathToFileURL(resolve(root, "src/lib/firebase/adminErrors.ts")).href;

const { getAdminCredentialDiagnostics, probeAdminFirestore } = await import(adminUrl);
const { diagnosticsForHealth } = await import(errUrl);

const diag = getAdminCredentialDiagnostics();
console.log(JSON.stringify({ diagnostics: diagnosticsForHealth(diag) }, null, 2));

try {
  const probe = await probeAdminFirestore();
  console.log(JSON.stringify({ probe }, null, 2));
  process.exit(probe.ok ? 0 : 1);
} catch (err) {
  console.error(
    JSON.stringify({
      probe: { ok: false, message: String(err?.message || err).slice(0, 200) },
    }),
  );
  process.exit(1);
}
