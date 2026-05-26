/**
 * PO Manager — Gmail IMAP Proxy Server
 * Run: node server.js
 * Serves the app on http://localhost:3000
 * Proxies Gmail IMAP so the browser can read emails
 */

const express = require('express');
const cors    = require('cors');
const imap    = require('imap-simple');
const { simpleParser } = require('mailparser');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Serve the main HTML app ──
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'app.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.send('<h2>app.html not found. Copy po_management_system_v3.html to this folder as app.html</h2>');
  }
});
app.use(express.static(__dirname));

// ── Test Gmail credentials ──
app.post('/api/gmail/test', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Email and password required' });

  const config = buildImapConfig(email, password);
  let connection;
  try {
    connection = await imap.connect(config);
    await connection.openBox('INBOX');
    connection.end();
    res.json({ ok: true, message: 'Connected to Gmail as ' + email });
  } catch (e) {
    if (connection) try { connection.end(); } catch(_) {}
    const msg = friendlyError(e.message);
    res.json({ ok: false, error: msg });
  }
});

// ── List emails matching keyword ──
app.post('/api/gmail/scan', async (req, res) => {
  const { email, password, keyword = 'Purchase Order', maxResults = 20 } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Credentials required' });

  const config = buildImapConfig(email, password);
  let connection;
  try {
    connection = await imap.connect(config);
    const box = await connection.openBox('INBOX');

    // Search for emails with keyword in subject containing attachments
    const searchCriteria = [['OR',
      ['SUBJECT', keyword],
      ['SUBJECT', keyword.toUpperCase()]
    ]];
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
      struct: true,
      markSeen: false
    };

    const results = await connection.search(searchCriteria, fetchOptions);
    connection.end();

    if (!results.length) {
      return res.json({ ok: true, emails: [], total: 0, scanned: box.messages.total });
    }

    // Parse emails and find PDF attachments
    const emails = [];
    for (const msg of results.slice(0, maxResults)) {
      try {
        const headerPart = msg.parts.find(p => p.which === 'HEADER.FIELDS (FROM TO SUBJECT DATE)');
        const headers = headerPart?.body || {};

        // Find PDF attachments in message structure
        const attachments = [];
        findAttachments(msg.attributes.struct, attachments);

        if (attachments.length) {
          emails.push({
            uid:     msg.attributes.uid,
            subject: (headers.subject?.[0] || '(no subject)').trim(),
            from:    (headers.from?.[0] || '').trim(),
            date:    (headers.date?.[0] || '').trim(),
            attachments: attachments
          });
        }
      } catch (e) { /* skip malformed */ }
    }

    res.json({ ok: true, emails, total: emails.length, scanned: results.length });
  } catch (e) {
    if (connection) try { connection.end(); } catch(_) {}
    res.json({ ok: false, error: friendlyError(e.message) });
  }
});

// ── Download a specific attachment ──
app.post('/api/gmail/attachment', async (req, res) => {
  const { email, password, uid, partID, filename } = req.body;
  if (!email || !password || !uid) return res.json({ ok: false, error: 'Missing parameters' });

  const config = buildImapConfig(email, password);
  let connection;
  try {
    connection = await imap.connect(config);
    await connection.openBox('INBOX');

    const searchCriteria = [['UID', String(uid)]];
    const fetchOptions   = { bodies: '', struct: true, markSeen: false };
    const results        = await connection.search(searchCriteria, fetchOptions);

    if (!results.length) {
      connection.end();
      return res.json({ ok: false, error: 'Email not found' });
    }

    const msg = results[0];
    // Re-find the attachment part
    const attachments = [];
    findAttachments(msg.attributes.struct, attachments);
    const target = attachments.find(a => a.partID === partID) || attachments[0];

    if (!target) {
      connection.end();
      return res.json({ ok: false, error: 'Attachment not found' });
    }

    // Fetch the specific part
    const partResults = await connection.search(
      [['UID', String(uid)]],
      { bodies: [target.partID], struct: false, markSeen: false }
    );

    const part = partResults[0]?.parts?.find(p => p.which === target.partID);
    if (!part) {
      connection.end();
      return res.json({ ok: false, error: 'Could not fetch attachment data' });
    }

    connection.end();

    // Decode the attachment
    const encoding = (target.encoding || 'BASE64').toUpperCase();
    let buffer;
    if (encoding === 'BASE64') {
      buffer = Buffer.from(part.body, 'base64');
    } else if (encoding === 'QUOTED-PRINTABLE') {
      buffer = Buffer.from(part.body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi,
        (_, hex) => String.fromCharCode(parseInt(hex, 16))));
    } else {
      buffer = Buffer.from(part.body, 'binary');
    }

    const b64 = buffer.toString('base64');
    res.json({
      ok:       true,
      filename: target.filename || filename || 'attachment.pdf',
      data:     b64,
      size:     buffer.length
    });

  } catch (e) {
    if (connection) try { connection.end(); } catch(_) {}
    res.json({ ok: false, error: friendlyError(e.message) });
  }
});

// ── Health check ──
app.get('/api/health', (_, res) => res.json({ ok: true, version: '1.0', time: new Date().toISOString() }));

// ── Helpers ──
function buildImapConfig(email, password) {
  return {
    imap: {
      user:          email,
      password:      password,
      host:          'imap.gmail.com',
      port:          993,
      tls:           true,
      tlsOptions:    { rejectUnauthorized: false },
      authTimeout:   10000,
      connTimeout:   15000
    }
  };
}

function findAttachments(struct, list, partID = '') {
  if (!struct) return;
  if (Array.isArray(struct)) {
    struct.forEach((part, i) => {
      const id = partID ? `${partID}.${i + 1}` : String(i + 1);
      findAttachments(part, list, id);
    });
    return;
  }
  if (typeof struct === 'object') {
    const disp = struct.disposition;
    const isPDF =
      (struct.type === 'application' && struct.subtype === 'pdf') ||
      (struct.params?.name || '').toLowerCase().endsWith('.pdf') ||
      (disp?.params?.filename || '').toLowerCase().endsWith('.pdf');

    if (isPDF) {
      list.push({
        partID:   partID || '1',
        filename: disp?.params?.filename || struct.params?.name || 'attachment.pdf',
        size:     struct.size || 0,
        encoding: struct.encoding || 'BASE64'
      });
    }
  }
}

function friendlyError(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('invalid credentials') || m.includes('authentication failed') || m.includes('auth') || m.includes('535'))
    return 'Invalid email or password. If you use 2-Step Verification, generate an App Password at myaccount.google.com → Security → App passwords.';
  if (m.includes('econnrefused') || m.includes('connect'))
    return 'Could not reach Gmail IMAP. Check your internet connection.';
  if (m.includes('timeout'))
    return 'Connection timed out. Try again.';
  if (m.includes('certificate') || m.includes('tls'))
    return 'TLS/SSL error connecting to Gmail.';
  return msg || 'Unknown error';
}

app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   PO Manager — Gmail Proxy Server      ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  App:    http://localhost:${PORT}           ║`);
  console.log(`║  Health: http://localhost:${PORT}/api/health ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log('║  Make sure app.html is in this folder  ║');
  console.log('╚════════════════════════════════════════╝\n');
});
