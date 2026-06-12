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
const PROCESSOR = () => process.env.GCP_PROCESSOR_ID || 'e19000df7a9f652b';

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
  if (req.method === 'GET') {
    // Health check: visit /api/extract-po in a browser to verify configuration
    const oauth = !!(process.env.GCP_OAUTH_CLIENT_ID && process.env.GCP_OAUTH_CLIENT_SECRET && process.env.GCP_OAUTH_REFRESH_TOKEN);
    const sa = !!(process.env.GCP_CLIENT_EMAIL && process.env.GCP_PRIVATE_KEY);
    return res.status(200).json({
      ok: true, service: 'extract-po',
      authMode: oauth ? 'oauth' : (sa ? 'service-account' : 'NOT CONFIGURED'),
      project: PROJECT(), location: LOCATION(), processor: PROCESSOR(),
      hint: oauth||sa ? 'Ready. POST a PDF as {fileBase64, mimeType}.' : 'Set GCP_OAUTH_CLIENT_ID + GCP_OAUTH_CLIENT_SECRET + GCP_OAUTH_REFRESH_TOKEN in Vercel env vars, then redeploy.'
    });
  }
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
    const pageCount = (result.document && result.document.pages && result.document.pages.length) || 0;
    const out = { ok: true, poNumber: '', poDate: '', dueDate: '', vendorName: '', amount: 0, currency: 'BDT', materials: [], pageCount: pageCount, warnings: [] };

    // DEBUG: expose what Document AI actually returned (entity types + values)
    const debug = {
      entityCount: entities.length,
      types: entities.map(e => ({
        type: e.type || '(none)',
        text: (e.mentionText || '').slice(0, 50),
        norm: e.normalizedValue ? (e.normalizedValue.text || JSON.stringify(e.normalizedValue).slice(0,60)) : null,
        props: (e.properties || []).map(p => ({ type: p.type, text: (p.mentionText||'').slice(0,30) }))
      })),
      docTextSnippet: ((result.document && result.document.text) || '').slice(0, 200)
    };

    for (const e of entities) {
      const ty = (e.type || '').toLowerCase();
      if (/(invoice_id|purchase_order|po_number|order_id|receipt_id)/.test(ty)) { out.poNumber = out.poNumber || val(e); }
      else if (/(invoice_date|order_date|purchase_order_date|^date$|receipt_date)/.test(ty)) { out.poDate = out.poDate || val(e); }
      else if (/due_date|delivery_date/.test(ty)) { out.dueDate = out.dueDate || val(e); }
      else if (/(supplier_name|remit_to_name|vendor_name|customer_name|ship_to_name|bill_to_name|receiver_name)/.test(ty)) { out.vendorName = out.vendorName || val(e); }
      else if (/(total_amount|net_amount|total_tax_amount|grand_total|amount_due|total)/.test(ty)) { const a = num(val(e)); if (a > out.amount) out.amount = a; }
      else if (/currency/.test(ty)) { out.currency = val(e) || out.currency; }
      else if (/line_item/.test(ty)) {
        const m = { sl: String(out.materials.length + 1), item: '', material: '', qty: '', unit: '', rate: '', amount: '' };
        for (const p of (e.properties || [])) {
          const pt = (p.type || '').toLowerCase();
          const pv = val(p);
          if (/product_code|line_item\/code|\bcode\b|product_id|item_id|sku/.test(pt)) m.item = pv;
          else if (/description|product_name|line_item\/product/.test(pt)) m.material = pv;
          else if (/quantity|qty/.test(pt)) m.qty = pv;
          else if (/unit_of_measure|\bunit\b/.test(pt)) m.unit = pv;
          else if (/unit_price|price/.test(pt)) m.rate = pv;
          else if (/amount/.test(pt)) m.amount = pv;
        }
        // if no explicit code, leave item blank (user fills); keep description in material
        if (m.material || m.amount || m.item) out.materials.push(m);
      }
    }
    if (!out.poNumber) out.warnings.push('PO number not detected — please enter manually');
    if (!out.materials.length) out.warnings.push('No line items detected — add materials manually');
    const wantDebug = (req.query && (req.query.debug==='1'||req.query.debug==='true')) || (body && body.debug);
    if (wantDebug) out.debug = debug;
    return res.status(200).json(out);
  } catch (err) {
    console.error('extract-po error:', err);
    return res.status(500).json({ ok: false, error: (err && err.message) || 'Extraction failed' });
  }
};
