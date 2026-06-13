// api/db-init.js — one-time setup: creates all tables (and optionally seeds).
// Call GET /api/db-init once after the database is connected.
// Safe to call again: uses CREATE TABLE IF NOT EXISTS.
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    await sql`CREATE TABLE IF NOT EXISTS jobs (
      id            TEXT PRIMARY KEY,
      customer      TEXT,
      po            TEXT,
      product       TEXT,
      qty           INTEGER,
      priority      TEXT,
      factory       TEXT,
      order_date    DATE,
      delivery_date DATE,
      proc_start    DATE,
      mat_arrival   DATE,
      prod_start    DATE,
      qc_date       DATE,
      dispatch_date DATE,
      status        TEXT,
      completion    NUMERIC,
      supervisor    TEXT,
      remarks       TEXT,
      materials     JSONB DEFAULT '[]'::jsonb,
      docs          JSONB DEFAULT '[]'::jsonb,
      tl            JSONB DEFAULT '[]'::jsonb,
      custom        JSONB DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS procurement (
      id             SERIAL PRIMARY KEY,
      job_id         TEXT,
      material       TEXT,
      supplier       TEXT,
      alt_supplier   TEXT,
      po_issued      DATE,
      expected       DATE,
      actual_arrival DATE,
      unit_cost      NUMERIC,
      qty            INTEGER,
      total_cost     NUMERIC,
      lead_time      INTEGER,
      days_delayed   INTEGER,
      status         TEXT,
      notes          TEXT,
      created_at     TIMESTAMPTZ DEFAULT now()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS quotations (
      id          SERIAL PRIMARY KEY,
      ref         TEXT,
      to_company  TEXT,
      to_dept     TEXT,
      quote_date  DATE,
      signatory   TEXT,
      items       JSONB DEFAULT '[]'::jsonb,
      vat_percent NUMERIC,
      grand_total NUMERIC,
      terms       JSONB DEFAULT '[]'::jsonb,
      created_at  TIMESTAMPTZ DEFAULT now()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value JSONB,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`;

    // Attachments metadata (the file itself is stored in Vercel Blob — see api/upload.js)
    await sql`CREATE TABLE IF NOT EXISTS attachments (
      id          SERIAL PRIMARY KEY,
      job_id      TEXT,
      filename    TEXT,
      url         TEXT,
      size_bytes  BIGINT,
      content_type TEXT,
      uploaded_by TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    )`;

    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
    res.status(200).json({ ok: true, message: 'Tables ready', tables: tables.rows.map(r => r.table_name) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
