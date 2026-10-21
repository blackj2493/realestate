import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createdPublicObjects,
  missingGrants,
  migrationNumber,
  LAST_MIGRATION_BEFORE_GRANT_RULE,
} from "./migrationGrants";

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");

describe("every new migration grants its public tables to service_role", () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (migrationNumber(f) ?? 0) > LAST_MIGRATION_BEFORE_GRANT_RULE);

  it.each(files.length ? files : ["(none yet)"])("%s", (file) => {
    if (file === "(none yet)") return;
    const missing = missingGrants(fs.readFileSync(path.join(MIGRATIONS, file), "utf-8"));
    expect(
      missing.map((m) => m.name),
      `Since 2026-10-30 Supabase no longer grants new public tables to the API roles. Add, in ${file}:\n` +
        missing.map((m) => `  grant select, insert, update, delete on public.${m.name} to service_role;`).join("\n") +
        "\nSee supabase/MIGRATION_TEMPLATE.sql."
    ).toEqual([]);
  });
});

describe("missingGrants", () => {
  it("flags a public table with no grant, qualified or not", () => {
    expect(missingGrants("create table if not exists public.foo (id int);")).toEqual([{ name: "foo" }]);
    expect(missingGrants("CREATE TABLE bar (id int);")).toEqual([{ name: "bar" }]);
  });

  it("passes a table granted to service_role, in any grant form", () => {
    expect(missingGrants(`create table public.foo (id int);
      grant select, insert, update, delete on public.foo to service_role;`)).toEqual([]);
    expect(missingGrants(`CREATE TABLE "foo" (id int);
      GRANT ALL ON TABLE foo TO authenticated, service_role;`)).toEqual([]);
    expect(missingGrants(`create table public.a (id int); create table public.b (id int);
      grant select on public.a, public.b to service_role;`)).toEqual([]);
  });

  it("does not accept a grant to other roles only, or on another table", () => {
    expect(missingGrants(`create table public.foo (id int);
      grant select on public.foo to anon, authenticated;`)).toEqual([{ name: "foo" }]);
    expect(missingGrants(`create table public.foo (id int);
      grant select on public.foobar to service_role;`)).toEqual([{ name: "foo" }]);
  });

  it("covers views and materialized views", () => {
    expect(createdPublicObjects("create or replace view public.v as select 1;")).toEqual(["v"]);
    expect(createdPublicObjects("create materialized view if not exists mv as select 1;")).toEqual(["mv"]);
  });

  it("skips other schemas, temp tables, comments and function bodies", () => {
    expect(createdPublicObjects("create table private.secret (id int);")).toEqual([]);
    expect(createdPublicObjects("create temp table scratch (id int);")).toEqual([]);
    expect(createdPublicObjects("create temporary table scratch (id int);")).toEqual([]);
    // A name that merely contains "temp" is still a real table.
    expect(createdPublicObjects("create table public.email_templates (id int);")).toEqual(["email_templates"]);
    expect(createdPublicObjects("-- create table public.old (id int);")).toEqual([]);
    expect(
      createdPublicObjects("create function f() returns void language plpgsql as $$ begin create table t (id int); end $$;")
    ).toEqual([]);
  });

  it("honours an explicit opt-out for a pg-only table", () => {
    expect(missingGrants(`-- no-api-grant: public.pg_only — read by a raw pg script only
      create table public.pg_only (id int);`)).toEqual([]);
  });

  it("reads the migration number from the file name", () => {
    expect(migrationNumber("156_new_table.sql")).toBe(156);
    expect(migrationNumber("README.md")).toBeNull();
  });
});
