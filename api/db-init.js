// api/db-init.js — one-time setup: creates all tables.
// Defensive version: reports the real reason instead of crashing.
export default async function handler(req, res) {
  // 1) Check that a Postgres connection string actually exists
  const url = process.env.POSTGRES_URL
           || process.env.DATABASE_URL
           || process.env.POSTGRES_PRISMA_URL
           || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    return res.status(500).json({
      ok: false,
      error: 'No Postgres connection string found in environment.',
      hint: 'The database is not connected to this project, or the redeploy did not pick up the env vars. In Vercel: Storage -> your Postgres DB -> Connect Project, then redeploy.',
      envVarsSeen: Object.keys(process.env).filter(k => /POSTGRES|DATABASE|NEON/i.test(k))
    });
  }

  // 2) Lazy-import the driver so a missing package reports cleanly
  let sql;
  try {
    ({ sql } = await import('@vercel/postgres'));
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: '@vercel/postgres package is not installed in the deployment.',
      hint: 'Redeploy with "Use existing Build Cache" UNCHECKED so npm installs the new dependencies.',
      detail: e.message
    });
  }

  // 3) If Vercel named the var DATABASE_URL (newer Neon), @vercel/postgres
  //    looks for POSTGRES_URL — bridge it at runtime.
  if (!process.env.POSTGRES_URL && url) {
    process.env.POSTGRES_URL = url;
  }

  // 4) Create the tables
  try {
    await sql`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, customer TEXT, po TEXT, product TEXT, qty INTEGER,
      priority TEXT, factory TEXT, order_date DATE, delivery_date DATE,
      proc_start DATE, mat_arrival DATE, prod_start DATE, qc_date DATE,
      dispatch_date DATE, status TEXT, completion NUMERIC, supervisor TEXT,
      remarks TEXT, materials JSONB DEFAULT '[]'::jsonb, docs JSONB DEFAULT '[]'::jsonb,
      tl JSONB DEFAULT '[]'::jsonb, custom JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`;

    await sql`CREATE TABLE IF NOT EXISTS procurement (
      id SERIAL PRIMARY KEY, job_id TEXT, material TEXT, supplier TEXT,
      alt_supplier TEXT, po_issued DATE, expected DATE, actual_arrival DATE,
      unit_cost NUMERIC, qty INTEGER, total_cost NUMERIC, lead_time INTEGER,
      days_delayed INTEGER, status TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT now())`;

    await sql`CREATE TABLE IF NOT EXISTS quotations (
      id SERIAL PRIMARY KEY, ref TEXT, to_company TEXT, to_dept TEXT, quote_date DATE,
      signatory TEXT, items JSONB DEFAULT '[]'::jsonb, vat_percent NUMERIC,
      grand_total NUMERIC, terms JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT now())`;

    await sql`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT now())`;

    await sql`CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY, job_id TEXT, filename TEXT, url TEXT, size_bytes BIGINT,
      content_type TEXT, uploaded_by TEXT, created_at TIMESTAMPTZ DEFAULT now())`;

    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
    return res.status(200).json({ ok: true, message: 'Tables ready', tables: tables.rows.map(r => r.table_name) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Query failed', detail: e.message });
  }
}
