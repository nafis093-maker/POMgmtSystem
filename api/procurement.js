// api/procurement.js — CRUD for procurement (material orders).
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
      const { rows } = await sql`SELECT * FROM procurement ORDER BY created_at DESC, id`;
      const procurement = rows.map(r => ({
        dbId: r.id, jobId: r.job_id, material: r.material, supplier: r.supplier,
        altSupplier: r.alt_supplier || '-', poIssued: fmtDate(r.po_issued),
        expectedArrival: fmtDate(r.expected), actualArrival: fmtDate(r.actual_arrival),
        unitCost: Number(r.unit_cost) || 0, qty: Number(r.qty) || 0,
        totalCost: Number(r.total_cost) || 0, leadTime: Number(r.lead_time) || 0,
        daysDelayed: Number(r.days_delayed) || 0, status: r.status, notes: r.notes || '',
        readiness: (r.status || '').includes('Received') ? 1 : 0, alert: ''
      }));
      return res.status(200).json({ ok: true, procurement });
    }
    if (req.method === 'POST') {
      const p = req.body || {};
      const { rows } = await sql`INSERT INTO procurement
        (job_id, material, supplier, alt_supplier, po_issued, expected, actual_arrival,
         unit_cost, qty, total_cost, lead_time, days_delayed, status, notes)
        VALUES (${p.jobId}, ${p.material}, ${p.supplier}, ${p.altSupplier || '-'},
         ${nz(p.poIssued)}, ${nz(p.expectedArrival)}, ${nz(p.actualArrival)},
         ${p.unitCost || 0}, ${p.qty || 0}, ${p.totalCost || 0}, ${p.leadTime || 0},
         ${p.daysDelayed || 0}, ${p.status}, ${p.notes || ''}) RETURNING id`;
      return res.status(200).json({ ok: true, id: rows[0].id });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      await sql`DELETE FROM procurement WHERE id=${id}`;
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
function nz(v) { return v ? v : null; }
function fmtDate(d) { if (!d) return ''; const dt=(d instanceof Date)?d:new Date(d); return isNaN(dt)?'':dt.toISOString().slice(0,10); }
