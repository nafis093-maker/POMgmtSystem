// api/jobs.js — CRUD for jobs. GET list, POST create, PUT update, DELETE remove.
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
      const { rows } = await sql`SELECT * FROM jobs ORDER BY created_at DESC, id`;
      const jobs = rows.map(r => ({
        id: r.id, customer: r.customer, po: r.po, product: r.product, qty: r.qty,
        priority: r.priority, factory: r.factory,
        orderDate: fmtDate(r.order_date), deliveryDate: fmtDate(r.delivery_date),
        procStart: fmtDate(r.proc_start), matArrival: fmtDate(r.mat_arrival),
        prodStart: fmtDate(r.prod_start), qcDate: fmtDate(r.qc_date),
        dispatchDate: fmtDate(r.dispatch_date), status: r.status,
        completion: r.completion == null ? 0 : Number(r.completion),
        supervisor: r.supervisor, remarks: r.remarks,
        materials: r.materials || [], docs: r.docs || [], tl: r.tl || [],
        custom: r.custom || {}
      }));
      return res.status(200).json({ ok: true, jobs });
    }

    if (req.method === 'POST') {
      const j = req.body || {};
      await sql`INSERT INTO jobs
        (id, customer, po, product, qty, priority, factory, order_date, delivery_date,
         proc_start, mat_arrival, prod_start, qc_date, dispatch_date, status, completion,
         supervisor, remarks, materials, docs, tl, custom)
        VALUES (${j.id}, ${j.customer}, ${j.po}, ${j.product}, ${j.qty || 0}, ${j.priority},
         ${j.factory}, ${nz(j.orderDate)}, ${nz(j.deliveryDate)}, ${nz(j.procStart)},
         ${nz(j.matArrival)}, ${nz(j.prodStart)}, ${nz(j.qcDate)}, ${nz(j.dispatchDate)},
         ${j.status}, ${j.completion || 0}, ${j.supervisor}, ${j.remarks},
         ${JSON.stringify(j.materials || [])}, ${JSON.stringify(j.docs || [])},
         ${JSON.stringify(j.tl || [])}, ${JSON.stringify(j.custom || {})})
        ON CONFLICT (id) DO NOTHING`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT') {
      const j = req.body || {};
      await sql`UPDATE jobs SET
        customer=${j.customer}, po=${j.po}, product=${j.product}, qty=${j.qty || 0},
        priority=${j.priority}, factory=${j.factory}, order_date=${nz(j.orderDate)},
        delivery_date=${nz(j.deliveryDate)}, proc_start=${nz(j.procStart)},
        mat_arrival=${nz(j.matArrival)}, prod_start=${nz(j.prodStart)},
        qc_date=${nz(j.qcDate)}, dispatch_date=${nz(j.dispatchDate)}, status=${j.status},
        completion=${j.completion || 0}, supervisor=${j.supervisor}, remarks=${j.remarks},
        materials=${JSON.stringify(j.materials || [])}, docs=${JSON.stringify(j.docs || [])},
        tl=${JSON.stringify(j.tl || [])}, custom=${JSON.stringify(j.custom || {})},
        updated_at=now()
        WHERE id=${j.id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      await sql`DELETE FROM jobs WHERE id=${id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

function nz(v) { return v ? v : null; }
function fmtDate(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
}
