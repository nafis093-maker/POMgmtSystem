// api/upload.js — store an uploaded file in Vercel Blob, record metadata in Postgres.
function ensurePgEnv() {
  if (!process.env.POSTGRES_URL) {
    const u = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (u) process.env.POSTGRES_URL = u;
  }
}
export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  ensurePgEnv();
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    return res.status(500).json({ ok: false, error: 'Blob store not connected (no BLOB_READ_WRITE_TOKEN).' });
  let put, sql;
  try { ({ put } = await import('@vercel/blob')); ({ sql } = await import('@vercel/postgres')); }
  catch (e) { return res.status(500).json({ ok: false, error: 'Required package not installed', detail: e.message }); }

  try {
    const { jobId, filename, contentType, dataBase64, uploadedBy } = req.body || {};
    if (!filename || !dataBase64) return res.status(400).json({ ok: false, error: 'filename and dataBase64 required' });
    const buffer = Buffer.from(dataBase64, 'base64');
    const path = (jobId ? jobId + '/' : 'misc/') + filename;
    const blob = await put(path, buffer, { access: 'public', contentType: contentType || 'application/octet-stream', addRandomSuffix: true });
    const { rows } = await sql`INSERT INTO attachments (job_id, filename, url, size_bytes, content_type, uploaded_by)
      VALUES (${jobId || null}, ${filename}, ${blob.url}, ${buffer.length}, ${contentType || null}, ${uploadedBy || null}) RETURNING id`;
    res.status(200).json({ ok: true, url: blob.url, id: rows[0].id, size: buffer.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
