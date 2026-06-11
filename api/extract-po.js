// ════════════════════════════════════════════════════════════════
//  Vercel Serverless Function: Google Document AI — Invoice Parser
//  Path: /api/extract-po   (POST)
//  Body: { fileBase64, mimeType }
//
//  AUTH — two modes, checked in this order:
//  1) OAuth refresh token (no service-account key needed — works with
//     org policy "disableServiceAccountKeyCreation"):
//       GCP_OAUTH_CLIENT_ID
//       GCP_OAUTH_CLIENT_SECRET
//       GCP_OAUTH_REFRESH_TOKEN
//  2) Service-account key (fallback if the above are absent):
//       GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY
//
//  Optional overrides (defaults baked in):
//       GCP_PROJECT_ID   (default 475352192712)
//       GCP_LOCATION     (default us)
//       GCP_PROCESSOR_ID (default 3c0164cda01a3fac)
// ════════════════════════════════════════════════════════════════

const PROJECT   = () => process.env.GCP_PROJECT_ID   || '475352192712';
const LOCATION  = () => process.env.GCP_LOCATION     || 'us';
const PROCESSOR = () => process.env.GCP_PROCESSOR_ID || '3c0164cda01a3fac';

// ── OAuth: exchange refresh token for an access token ──
async function getAccessTokenViaOAuth() {
  const params = new URLSearchParams({
    client_id: process.env.GCP_OAUTH_CLIENT_ID,
    client_secret: process.env.GCP_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.GCP_OAUTH_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error('OAuth token exchange failed: ' + (data.error_description || data.error || r.status));
  }
  return data.access_token;
}

// ── Service account: sign a JWT and exchange it (no SDK needed) ──
async function getAccessTokenViaServiceAccount() {
  const crypto = require('crypto');
  const email = process.env.GCP_CLIENT_EMAIL;
  const key = (process.env.GCP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })).toString('base64url');
  const unsigned = header + '.' + claims;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  const jwt = unsigned + '.' + signature;

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error('SA token exchange failed: ' + (data.error_description || data.error || r.status));
  }
  return data.access_token;
}

function val(entity) {
  if (!entity) return '';
  const nv = entity.normalizedValue;
  if (nv) {
    if (nv.text) return nv.text;
    if (nv.moneyValue) {
      const m = nv.moneyValue;
      return String(Number(m.units || 0) + Number(m.nanos || 0) / 1e9);
    }
    if (nv.dateValue && nv.dateValue.year) {
      const d = nv.dateValue;
      return `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}`;
    }
  }
  return (entity.mentionText || '').trim();
}
const num = s => { const n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const hasOAuth = process.env.GCP_OAUTH_CLIENT_ID && process.env.GCP_OAUTH_CLIENT_SECRET && process.env.GCP_OAUTH_REFRESH_TOKEN;
  const hasSA = process.env.GCP_CLIENT_EMAIL && process.env.GCP_PRIVATE_KEY;
  if (!hasOAuth && !hasSA) {
    return res.status(500).json({ ok: false, error: 'Server not configured. Set either GCP_OAUTH_CLIENT_ID + GCP_OAUTH_CLIENT_SECRET + GCP_OAUTH_REFRESH_TOKEN, or GCP_CLIENT_EMAIL + GCP_PRIVATE_KEY.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { fileBase64, mimeType } = body || {};
    if (!fileBase64) return res.status(400).json({ ok: false, error: 'fileBase64 required' });

    const token = hasOAuth ? await getAccessTokenViaOAuth() : await getAccessTokenViaServiceAccount();

    const url = `https://${LOCATION()}-documentai.googleapis.com/v1/projects/${PROJECT()}/locations/${LOCATION()}/processors/${PROCESSOR()}:process`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawDocument: { content: fileBase64, mimeType: mimeType || 'application/pdf' } }),
    });
    const result = await r.json();
    if (!r.ok) {
      const msg = (result.error && result.error.message) || ('HTTP ' + r.status);
      return res.status(502).json({ ok: false, error: 'Document AI: ' + msg });
    }

    const entities = (result.document && result.document.entities) || [];
    const out = { ok: true, poNumber: '', poDate: '', dueDate: '', vendorName: '', amount: 0, currency: 'BDT', materials: [], warnings: [] };

    for (const e of entities) {
      switch (e.type || '') {
        case 'invoice_id':
        case 'purchase_order':   out.poNumber = out.poNumber || val(e); break;
        case 'invoice_date':     out.poDate = out.poDate || val(e); break;
        case 'due_date':         out.dueDate = out.dueDate || val(e); break;
        case 'supplier_name':
        case 'remit_to_name':    out.vendorName = out.vendorName || val(e); break;
        case 'total_amount':
        case 'net_amount':       { const a = num(val(e)); if (a > out.amount) out.amount = a; } break;
        case 'currency':         out.currency = val(e) || out.currency; break;
        case 'line_item': {
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
    if (!out.poNumber) out.warnings.push('PO number not detected — please enter manually');
    if (!out.materials.length) out.warnings.push('No line items detected — add materials manually');
    return res.status(200).json(out);
  } catch (err) {
    console.error('extract-po error:', err);
    return res.status(500).json({ ok: false, error: (err && err.message) || 'Extraction failed' });
  }
};
