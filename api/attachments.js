// api/attachments.js — list or delete attachment records.
// GET /api/attachments?jobId=JOB-001  -> { ok, attachments: [...] }
// DELETE /api/attachments?id=5         -> removes the blob + the DB row
import { del } from '@vercel/blob';
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const jobId = req.query.jobId;
      const { rows } = jobId
        ? await sql`SELECT * FROM attachments WHERE job_id=${jobId} ORDER BY created_at DESC`
        : await sql`SELECT * FROM attachments ORDER BY created_at DESC`;
      return res.status(200).json({ ok: true, attachments: rows });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      const { rows } = await sql`SELECT url FROM attachments WHERE id=${id}`;
      if (rows[0] && rows[0].url) {
        try { await del(rows[0].url); } catch (e) { /* blob may already be gone */ }
      }
      await sql`DELETE FROM attachments WHERE id=${id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
