// api/settings.js — shared key/value settings (email alert recipients, custom fields, letterhead, etc.)
// GET /api/settings            -> { ok, settings: { key: value, ... } }
// GET /api/settings?key=foo    -> { ok, value }
// POST /api/settings { key, value }  -> upsert one setting
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
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
