// api/upload.js — store an uploaded file in Vercel Blob, record metadata in Postgres.
// POST /api/upload  body: { jobId, filename, contentType, dataBase64, uploadedBy }
//   -> { ok, url, id }
// The front-end reads the file, base64-encodes it, and posts it here.
import { put } from '@vercel/blob';
import { sql } from '@vercel/postgres';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST')
      return res.status(405).json({ ok: false, error: 'Method not allowed' });

    const { jobId, filename, contentType, dataBase64, uploadedBy } = req.body || {};
    if (!filename || !dataBase64)
      return res.status(400).json({ ok: false, error: 'filename and dataBase64 required' });

    const buffer = Buffer.from(dataBase64, 'base64');
    // store under a path that groups by job; addRandomSuffix avoids name clashes
    const path = (jobId ? jobId + '/' : 'misc/') + filename;
    const blob = await put(path, buffer, {
      access: 'public',
      contentType: contentType || 'application/octet-stream',
      addRandomSuffix: true
    });

    const { rows } = await sql`INSERT INTO attachments
      (job_id, filename, url, size_bytes, content_type, uploaded_by)
      VALUES (${jobId || null}, ${filename}, ${blob.url}, ${buffer.length},
              ${contentType || null}, ${uploadedBy || null})
      RETURNING id`;

    res.status(200).json({ ok: true, url: blob.url, id: rows[0].id, size: buffer.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
