// api/settings.js — shared key/value settings.
function ensurePgEnv() {
  if (!process.env.POSTGRES_URL) {
    const u = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (u) process.env.POSTGRES_URL = u;
  }
}

export default async function handler(req, res) {
  ensurePgEnv();
  if (!process.env.POSTGRES_URL)
    return res.status(500).json({ ok: false, error: 'Database not connected (no POSTGRES_URL/DATABASE_URL).' });
  let sql;
  try { ({ sql } = await import('@vercel/postgres')); }
  catch (e) { return res.status(500).json({ ok: false, error: '@vercel/postgres not installed', detail: e.message }); }

  try {
    if (req.method === 'GET') {
      const key = req.query.key;
      if (key) {
        const { rows } = await sql`SELECT value FROM settings WHERE key=${key}`;
        return res.status(200).json({ ok: true, value: rows[0] ? rows[0].value : null });
      }
      const { rows } = await sql`SELECT key, value FROM settings`;
      const settings = {};
      rows.forEach(r => { settings[r.key] = r.value; });
      return res.status(200).json({ ok: true, settings });
    }

    if (req.method === 'POST') {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ ok: false, error: 'key required' });
      await sql`INSERT INTO settings (key, value, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}, now())
        ON CONFLICT (key) DO UPDATE SET value=${JSON.stringify(value)}, updated_at=now()`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
