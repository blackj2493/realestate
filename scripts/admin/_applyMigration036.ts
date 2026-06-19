// Scratch: apply migration 036 (viewing_requests) via the Session pooler
// (DATABASE_URL — see CLAUDE.md §12). Instant DDL, idempotent (IF NOT EXISTS).
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (session pooler) not set');
  const sql = readFileSync('supabase/migrations/036_viewing_requests.sql', 'utf8');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='viewing_requests' ORDER BY ordinal_position`
    );
    console.log('✅ migration 036 applied. viewing_requests columns:', rows.map((r) => r.column_name).join(', '));
    const rls = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname='viewing_requests'`
    );
    console.log('RLS enabled:', rls.rows[0]?.relrowsecurity);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
