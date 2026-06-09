// ════════════════════════════════════════════════════════════════
//  Vercel Serverless Function: Google Document AI — Invoice Parser
//  Path: /api/extract-po   (POST)
//  Body: { fileBase64: "<base64 of PDF or image>", mimeType: "application/pdf" }
//  Returns: { ok, poNumber, poDate, dueDate, vendorName, amount, currency, materials:[], raw }
//
//  Requires these Environment Variables in Vercel (Project → Settings → Environment Variables):
//    GCP_PROJECT_ID        e.g. my-po-project-123456
//    GCP_LOCATION          e.g. us   (or eu)
//    GCP_PROCESSOR_ID      the Invoice Parser processor id
//    GCP_CLIENT_EMAIL      service-account email
//    GCP_PRIVATE_KEY       service-account private key (with \n escaped — see setup guide)
// ════════════════════════════════════════════════════════════════
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

function getClient() {
  const privateKey = (process.env.GCP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return new DocumentProcessorServiceClient({
    credentials: {
      client_email: process.env.GCP_CLIENT_EMAIL,
      private_key: privateKey,
    },
    projectId: process.env.GCP_PROJECT_ID,
    // Document AI in eu/us needs the regional endpoint
    apiEndpoint: `${process.env.GCP_LOCATION || 'us'}-documentai.googleapis.com`,
  });
}

// Pull a normalized field value from the invoice entity
function val(entity) {
  if (!entity) return '';
  // normalizedValue gives clean dates/money; fall back to mentionText
  if (entity.normalizedValue) {
    if (entity.normalizedValue.text) return entity.normalizedValue.text;
    if (entity.normalizedValue.moneyValue) {
      const m = entity.normalizedValue.moneyValue;
      const units = Number(m.units || 0);
      const nanos = Number(m.nanos || 0) / 1e9;
      return String(units + nanos);
    }
    if (entity.normalizedValue.dateValue) {
      const d = entity.normalizedValue.dateValue;
      if (d.year) return `${d.year}-${String(d.month||1).padStart(2,'0')}-${String(d.day||1).padStart(2,'0')}`;
    }
  }
  return (entity.mentionText || '').trim();
}

function num(s) {
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

module.exports = async (req, res) => {
  // CORS (same-origin in prod, but allow during testing)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // Check env vars are set
  const need = ['GCP_PROJECT_ID', 'GCP_LOCATION', 'GCP_PROCESSOR_ID', 'GCP_CLIENT_EMAIL', 'GCP_PRIVATE_KEY'];
  const missing = need.filter(k => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ ok: false, error: 'Server not configured. Missing: ' + missing.join(', ') });
  }

  try {
    // Vercel parses JSON body automatically when Content-Type: application/json
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { fileBase64, mimeType } = body || {};
    if (!fileBase64) return res.status(400).json({ ok: false, error: 'fileBase64 required' });

    const client = getClient();
    const name = `projects/${process.env.GCP_PROJECT_ID}/locations/${process.env.GCP_LOCATION}/processors/${process.env.GCP_PROCESSOR_ID}`;

    const [result] = await client.processDocument({
      name,
      rawDocument: {
        content: fileBase64,
        mimeType: mimeType || 'application/pdf',
      },
    });

    const doc = result.document || {};
    const entities = doc.entities || [];

    const out = {
      ok: true, poNumber: '', poDate: '', dueDate: '', vendorName: '',
      amount: 0, currency: 'BDT', materials: [], warnings: [],
    };

    // Map Invoice Parser entity types → our fields
    for (const e of entities) {
      const type = e.type || '';
      switch (type) {
        case 'invoice_id':
        case 'purchase_order':        out.poNumber = out.poNumber || val(e); break;
        case 'invoice_date':          out.poDate   = out.poDate   || val(e); break;
        case 'due_date':              out.dueDate  = out.dueDate  || val(e); break;
        case 'supplier_name':
        case 'remit_to_name':         out.vendorName = out.vendorName || val(e); break;
        case 'total_amount':
        case 'net_amount':            { const a = num(val(e)); if (a > out.amount) out.amount = a; } break;
        case 'currency':              out.currency = val(e) || out.currency; break;
        case 'line_item': {
          // line_item has child properties
          const m = { sl: String(out.materials.length + 1), material: '', qty: '', unit: '', rate: '', amount: '' };
          for (const p of (e.properties || [])) {
            const pv = val(p);
            switch (p.type) {
              case 'line_item/description': m.material = pv; break;
              case 'line_item/quantity':    m.qty = pv; break;
              case 'line_item/unit':        m.unit = pv; break;
              case 'line_item/unit_price':  m.rate = pv; break;
              case 'line_item/amount':      m.amount = pv; break;
            }
          }
          if (m.material || m.amount) out.materials.push(m);
          break;
        }
      }
    }

    // Fallbacks: if buyer was captured as supplier, or PO# missing, leave for user to edit
    if (!out.poNumber) out.warnings.push('PO number not detected — please enter manually');
    if (!out.materials.length) out.warnings.push('No line items detected — add materials manually');

    return res.status(200).json(out);
  } catch (err) {
    console.error('Document AI error:', err);
    return res.status(500).json({ ok: false, error: (err && err.message) || 'Extraction failed' });
  }
};
