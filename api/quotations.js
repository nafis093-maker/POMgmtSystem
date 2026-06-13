// api/quotations.js — store and list quotations.
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
      const { rows } = await sql`SELECT * FROM quotations ORDER BY created_at DESC, id`;
      const quotations = rows.map(r => ({
        id: r.id, ref: r.ref, toCompany: r.to_company, toDept: r.to_dept,
        date: fmtDate(r.quote_date), signatory: r.signatory,
        items: r.items || [], vatPercent: Number(r.vat_percent) || 0,
        grandTotal: Number(r.grand_total) || 0, terms: r.terms || [],
        createdAt: r.created_at
      }));
      return res.status(200).json({ ok: true, quotations });
    }
    if (req.method === 'POST') {
      const q = req.body || {};
      const { rows } = await sql`INSERT INTO quotations
        (ref, to_company, to_dept, quote_date, signatory, items, vat_percent, grand_total, terms)
        VALUES (${q.ref || ''}, ${q.toCompany || ''}, ${q.toDept || ''}, ${nz(q.date)},
         ${q.signatory || ''}, ${JSON.stringify(q.items || [])}, ${q.vatPercent || 0},
         ${q.grandTotal || 0}, ${JSON.stringify(q.terms || [])}) RETURNING id`;
      return res.status(200).json({ ok: true, id: rows[0].id });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      await sql`DELETE FROM quotations WHERE id=${id}`;
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
function nz(v) { return v ? v : null; }
function fmtDate(d) { if (!d) return ''; const dt=(d instanceof Date)?d:new Date(d); return isNaN(dt)?'':dt.toISOString().slice(0,10); }
