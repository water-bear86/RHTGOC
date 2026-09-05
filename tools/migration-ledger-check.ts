import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const projectId = process.env.SUPABASE_PROJECT_ID ?? "whkaenfnefhuezkutnxe";
const url = process.env.SUPABASE_URL ?? "https://" + projectId + ".supabase.co";
const mgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
const svcToken = process.env.SUPABASE_SERVICE_ROLE_KEY;
const strict = process.argv.includes("--strict");

interface Migration {
  version: string;
  name: string;
}

async function readLocal(): Promise<Migration[]> {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return files.map((file) => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      console.error("::error::Migration filename must be <timestamp>_<name>.sql, got: " + file);
      process.exit(1);
    }
    return { version: match[1], name: match[2] };
  });
}

async function fetchRemote(): Promise<Migration[]> {
  if (mgmtToken) {
    const res = await fetch("https://api.supabase.com/v1/projects/" + projectId + "/database/migrations", {
      headers: { Authorization: "Bearer " + mgmtToken },
    });
    if (!res.ok) {
      console.error("::error::Management API returned " + res.status + ": " + (await res.text()));
      process.exit(1);
    }
    const data = (await res.json()) as Array<{ version?: string; name?: string }>;
    return data.map((r) => ({ version: String(r.version ?? ""), name: String(r.name ?? "") }));
  }

  if (svcToken) {
    const endpoint = url + "/rest/v1/supabase_migrations/schema_migrations?select=version,name&order=version.asc";
    const res = await fetch(endpoint, {
      headers: {
        "apikey": svcToken,
        "Authorization": "Bearer " + svcToken,
      },
    });
    if (!res.ok) {
      console.error("::error::Service-role query returned " + res.status + ": " + (await res.text()));
      process.exit(1);
    }
    const data = (await res.json()) as Array<{ version?: string; name?: string }>;
    return data.map((r) => ({ version: String(r.version ?? ""), name: String(r.name ?? "") }));
  }

  return [];
}

function keyOf(m: Migration): string {
  return m.version + "_" + m.name;
}

async function main(): Promise<void> {
  const local = await readLocal();

  if (!mgmtToken && !svcToken) {
    if (strict) {
      console.error("::error::Migration ledger check requires SUPABASE_MANAGEMENT_TOKEN or SUPABASE_SERVICE_ROLE_KEY");
      process.exit(1);
    }
    console.log("migration-ledger-check: skipped (no SUPABASE_MANAGEMENT_TOKEN or SUPABASE_SERVICE_ROLE_KEY)");
    console.log("  Local migrations present: " + local.length);
    process.exit(0);
  }

  const remote = await fetchRemote();
  const localKeys = local.map(keyOf);
  const remoteKeys = remote.map(keyOf);

  if (localKeys.join("\n") === remoteKeys.join("\n")) {
    console.log("Migration ledger consistent: " + local.length + " migrations, local == remote");
    process.exit(0);
  }

  console.error("::error::Migration ledger mismatch - local does not match remote");
  console.error("");
  console.error("Local migrations (" + local.length + "):");
  for (const m of local) console.error("  " + m.version + "_" + m.name);
  console.error("");
  console.error("Remote migrations (" + remote.length + "):");
  for (const m of remote) console.error("  " + m.version + "_" + m.name);
  console.error("");

  const localSet = new Set(localKeys);
  const remoteSet = new Set(remoteKeys);
  const missingRemote = localKeys.filter((k) => !remoteSet.has(k));
  const extraRemote = remoteKeys.filter((k) => !localSet.has(k));
  if (missingRemote.length) {
    console.error("Present locally but NOT applied remotely (run supabase migration up):");
    for (const m of missingRemote) console.error("  " + m);
  }
  if (extraRemote.length) {
    console.error("Applied remotely but NOT present locally (check in the file or restore it):");
    for (const m of extraRemote) console.error("  " + m);
  }
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error("::error::Migration ledger check crashed:", err);
  process.exit(1);
});
