/**
 * Does a migration grant Data API access to every table it creates in `public`?
 *
 * WHY. From 2026-10-30 Supabase stops granting new `public` tables to anon, authenticated
 * and service_role by default. A table created after that date answers every supabase-js /
 * PostgREST call — the SERVICE ROLE's included — with "permission denied" until a GRANT
 * runs. supabase-js returns that error instead of throwing it, and much of our server code
 * logs and moves on, so a missing grant loses data without an alert (the same shape as the
 * missing signup_attribution table, 2026-09-28 → 10-05).
 *
 * THE RULE. Each `create table` / `create view` / `create materialized view` in `public`
 * (or unqualified, which means `public`) needs, in the SAME file, a
 * `grant ... on [table] [public.]<name> to ... service_role ...`. Grant anon/authenticated
 * only when the browser reads the table under an RLS policy.
 *
 * An object that is only ever reached over a raw pg connection may opt out with a comment
 * in the file: `-- no-api-grant: <name> — <reason>`.
 */

export interface MissingGrant {
  /** Table or view name, without the schema. */
  name: string;
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;

const CREATE_RE = new RegExp(
  String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:(?:unlogged|materialized)\s+)?(table|view)\s+(?:if\s+not\s+exists\s+)?(${IDENT})(?:\s*\.\s*(${IDENT}))?`,
  "gi"
);

function unquote(id: string): string {
  return id.startsWith('"') ? id.slice(1, -1) : id.toLowerCase();
}

/** Drop comments and string literals, so a commented-out or quoted CREATE does not count. */
function stripSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Every public table/view the file creates. Temp tables and other schemas are skipped. */
export function createdPublicObjects(sql: string): string[] {
  const code = stripSql(sql);
  const out = new Set<string>();
  // CREATE_RE has no slot for TEMP/TEMPORARY, so a temp table never matches.
  for (const m of code.matchAll(CREATE_RE)) {
    const [schema, name] = m[3] ? [unquote(m[2]), unquote(m[3])] : ["public", unquote(m[2])];
    if (schema === "public") out.add(name);
  }
  return [...out];
}

function hasServiceRoleGrant(code: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const target = String.raw`(?:(?:"public"|public)\s*\.\s*)?(?:"${esc}"|${esc})`;
  const re = new RegExp(
    String.raw`\bgrant\s+[^;]*?\bon\s+(?:table\s+)?(?:[^;]*?,\s*)?${target}\b[^;]*?\bto\s+[^;]*\bservice_role\b`,
    "i"
  );
  return re.test(code);
}

/** Objects the migration creates in `public` without a service_role grant. */
export function missingGrants(sql: string): MissingGrant[] {
  const code = stripSql(sql);
  const optOuts = new Set(
    [...sql.matchAll(/--\s*no-api-grant:\s*(?:public\.)?("?[A-Za-z_][A-Za-z0-9_$]*"?)/gi)].map((m) =>
      unquote(m[1])
    )
  );
  return createdPublicObjects(sql)
    .filter((name) => !optOuts.has(name) && !hasServiceRoleGrant(code, name))
    .map((name) => ({ name }));
}

/**
 * Migrations up to and including this number predate the rule. Their objects already hold
 * the old default grants in production, so they are not re-checked.
 */
export const LAST_MIGRATION_BEFORE_GRANT_RULE = 155;

/** Leading number of a migration file name, or null. */
export function migrationNumber(file: string): number | null {
  const m = /^(\d+)_/.exec(file);
  return m ? Number(m[1]) : null;
}
