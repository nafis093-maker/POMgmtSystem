// api/backup.js — full data export and restore.
// GET  /api/backup            -> JSON dump of all tables (jobs, procurement, quotations, settings, attachments metadata)
// POST /api/backup {data,mode} -> restore; mode 'merge' (default, upsert) or 'replace' (wipe then insert)
function ensurePgEnv() {
  if (!process.env.POSTGRES_URL) {
    const u = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (u) process.env.POSTGRES_URL = u;
  }
}

export const config = { api: { bodyParser: false }, maxDuration: 60 };

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

export default async function handler(req, res) {
  ensurePgEnv();
  if (!process.env.POSTGRES_URL)
    return res.status(500).json({ ok: false, error: 'Database not connected (no POSTGRES_URL/DATABASE_URL).' });
  let sql;
  try { ({ sql } = await import('@vercel/postgres')); }
  catch (e) { return res.status(500).json({ ok: false, error: '@vercel/postgres not installed', detail: e.message }); }

  // ---------- EXPORT ----------
  if (req.method === 'GET') {
    try {
      const [jobs, procurement, quotations, settings, attachments] = await Promise.all([
        sql`SELECT * FROM jobs ORDER BY id`,
        sql`SELECT * FROM procurement ORDER BY id`,
        sql`SELECT * FROM quotations ORDER BY id`,
        sql`SELECT * FROM settings`,
        sql`SELECT * FROM attachments ORDER BY id`
      ]);
      const backup = {
        meta: {
          app: 'MEW PO Management System',
          version: 1,
          exportedAt: new Date().toISOString(),
          counts: {
            jobs: jobs.rows.length, procurement: procurement.rows.length,
            quotations: quotations.rows.length, settings: settings.rows.length,
            attachments: attachments.rows.length
          }
        },
        jobs: jobs.rows,
        procurement: procurement.rows,
        quotations: quotations.rows,
        settings: settings.rows,
        attachments: attachments.rows
      };
      // Offer as a downloadable file
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition',
        'attachment; filename="MEW_backup_' + new Date().toISOString().slice(0,10) + '.json"');
      return res.status(200).send(JSON.stringify(backup, null, 2));
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ---------- RESTORE ----------
  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const data = body.data || body;          // accept {data:{...}} or the backup object directly
      const mode = body.mode || 'merge';        // 'merge' (upsert) | 'replace' (wipe first)
      if (!data || !Array.isArray(data.jobs)) {
        return res.status(400).json({ ok: false, error: 'Invalid backup file: missing jobs array.' });
      }

      if (mode === 'replace') {
        await sql`DELETE FROM jobs`;
        await sql`DELETE FROM procurement`;
        await sql`DELETE FROM quotations`;
        await sql`DELETE FROM attachments`;
        // settings replaced per-key below
      }

      let restored = { jobs: 0, procurement: 0, quotations: 0, settings: 0, attachments: 0 };

      // Jobs (upsert by id)
      for (const j of data.jobs) {
        await sql`INSERT INTO jobs
          (id, customer, po, product, qty, priority, factory, order_date, delivery_date,
           proc_start, mat_arrival, prod_start, qc_date, dispatch_date, status, completion,
           supervisor, remarks, materials, docs, tl, custom)
          VALUES (${j.id}, ${j.customer}, ${j.po}, ${j.product}, ${j.qty || 0}, ${j.priority},
           ${j.factory}, ${j.order_date || null}, ${j.delivery_date || null}, ${j.proc_start || null},
           ${j.mat_arrival || null}, ${j.prod_start || null}, ${j.qc_date || null}, ${j.dispatch_date || null},
           ${j.status}, ${j.completion || 0}, ${j.supervisor}, ${j.remarks},
           ${JSON.stringify(j.materials || [])}, ${JSON.stringify(j.docs || [])},
           ${JSON.stringify(j.tl || [])}, ${JSON.stringify(j.custom || {})})
          ON CONFLICT (id) DO UPDATE SET
            customer=EXCLUDED.customer, po=EXCLUDED.po, product=EXCLUDED.product, qty=EXCLUDED.qty,
            priority=EXCLUDED.priority, factory=EXCLUDED.factory, order_date=EXCLUDED.order_date,
            delivery_date=EXCLUDED.delivery_date, proc_start=EXCLUDED.proc_start, mat_arrival=EXCLUDED.mat_arrival,
            prod_start=EXCLUDED.prod_start, qc_date=EXCLUDED.qc_date, dispatch_date=EXCLUDED.dispatch_date,
            status=EXCLUDED.status, completion=EXCLUDED.completion, supervisor=EXCLUDED.supervisor,
            remarks=EXCLUDED.remarks, materials=EXCLUDED.materials, docs=EXCLUDED.docs,
            tl=EXCLUDED.tl, custom=EXCLUDED.custom, updated_at=now()`;
        restored.jobs++;
      }

      // Procurement (insert; ids regenerate to avoid clashes unless replace mode kept them)
      for (const p of (data.procurement || [])) {
        await sql`INSERT INTO procurement
          (job_id, material, supplier, alt_supplier, po_issued, expected, actual_arrival,
           unit_cost, qty, total_cost, lead_time, days_delayed, status, notes)
          VALUES (${p.job_id}, ${p.material}, ${p.supplier}, ${p.alt_supplier},
           ${p.po_issued || null}, ${p.expected || null}, ${p.actual_arrival || null},
           ${p.unit_cost || 0}, ${p.qty || 0}, ${p.total_cost || 0}, ${p.lead_time || 0},
           ${p.days_delayed || 0}, ${p.status}, ${p.notes})`;
        restored.procurement++;
      }

      // Quotations
      for (const q of (data.quotations || [])) {
        await sql`INSERT INTO quotations
          (ref, to_company, to_dept, quote_date, signatory, items, vat_percent, grand_total, terms)
          VALUES (${q.ref}, ${q.to_company}, ${q.to_dept}, ${q.quote_date || null}, ${q.signatory},
           ${JSON.stringify(q.items || [])}, ${q.vat_percent || 0}, ${q.grand_total || 0},
           ${JSON.stringify(q.terms || [])})`;
        restored.quotations++;
      }

      // Settings (upsert by key)
      for (const s of (data.settings || [])) {
        await sql`INSERT INTO settings (key, value, updated_at)
          VALUES (${s.key}, ${JSON.stringify(s.value)}, now())
          ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`;
        restored.settings++;
      }

      // Attachments metadata (the actual files remain in Blob; we restore the index)
      for (const a of (data.attachments || [])) {
        await sql`INSERT INTO attachments
          (job_id, filename, url, size_bytes, content_type, uploaded_by)
          VALUES (${a.job_id}, ${a.filename}, ${a.url}, ${a.size_bytes || 0},
           ${a.content_type}, ${a.uploaded_by})`;
        restored.attachments++;
      }

      return res.status(200).json({ ok: true, mode, restored });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
}
