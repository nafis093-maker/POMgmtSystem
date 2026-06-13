// api/attachments.js — list or delete attachment records.
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
  let del, sql;
  try { ({ del } = await import('@vercel/blob')); ({ sql } = await import('@vercel/postgres')); }
  catch (e) { return res.status(500).json({ ok: false, error: 'Required package not installed', detail: e.message }); }

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
      if (rows[0] && rows[0].url) { try { await del(rows[0].url); } catch (e) {} }
      await sql`DELETE FROM attachments WHERE id=${id}`;
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
