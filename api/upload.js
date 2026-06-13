// api/upload.js — store an uploaded file in Vercel Blob, record metadata in Postgres.
function ensurePgEnv() {
  if (!process.env.POSTGRES_URL) {
    const u = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (u) process.env.POSTGRES_URL = u;
  }
}

// Find a Blob read-write token under any name Vercel may have used.
function findBlobToken() {
  // 1) Manually-set variable (most reliable — you paste the token in Vercel env settings)
  if (process.env.MEW_BLOB_TOKEN) { process.env.BLOB_READ_WRITE_TOKEN = process.env.MEW_BLOB_TOKEN; return process.env.MEW_BLOB_TOKEN; }
  // 2) Standard auto-injected name
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  // 3) Custom-named stores create e.g. MYSTORE_READ_WRITE_TOKEN
  const key = Object.keys(process.env).find(k => /READ_WRITE_TOKEN$/.test(k) && process.env[k]);
  if (key) { process.env.BLOB_READ_WRITE_TOKEN = process.env[key]; return process.env[key]; }
  // 4) By token prefix
  const byPrefix = Object.keys(process.env).find(k => String(process.env[k]).startsWith('vercel_blob_rw_'));
  if (byPrefix) { process.env.BLOB_READ_WRITE_TOKEN = process.env[byPrefix]; return process.env[byPrefix]; }
  return null;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    try { return JSON.parse(req.body); } catch (e) {}
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  ensurePgEnv();

  const blobToken = findBlobToken();
  if (!blobToken) {
    return res.status(500).json({
      ok: false,
      error: 'No Blob read-write token found in environment.',
      hint: 'Connect the Blob store to this project (Storage -> Blob -> Connect Project) and redeploy without build cache.',
      envSeen: Object.keys(process.env).filter(k => /BLOB|TOKEN/i.test(k))
    });
  }

  let put, sql;
  try { ({ put } = await import('@vercel/blob')); ({ sql } = await import('@vercel/postgres')); }
  catch (e) { return res.status(500).json({ ok: false, error: 'Required package not installed', detail: e.message }); }

  try {
    const body = await readJsonBody(req);
    const { jobId, filename, contentType, dataBase64, uploadedBy } = body;
    if (!filename || !dataBase64) return res.status(400).json({ ok: false, error: 'filename and dataBase64 required' });

    const buffer = Buffer.from(dataBase64, 'base64');
    const path = (jobId ? jobId + '/' : 'misc/') + filename;
    const blob = await put(path, buffer, {
      access: 'public',
      contentType: contentType || 'application/octet-stream',
      addRandomSuffix: true,
      token: blobToken
    });

    const { rows } = await sql`INSERT INTO attachments (job_id, filename, url, size_bytes, content_type, uploaded_by)
      VALUES (${jobId || null}, ${filename}, ${blob.url}, ${buffer.length}, ${contentType || null}, ${uploadedBy || null})
      RETURNING id`;
    res.status(200).json({ ok: true, url: blob.url, id: rows[0].id, size: buffer.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
