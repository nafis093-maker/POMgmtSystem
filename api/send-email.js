// ════════════════════════════════════════════════════════════════
//  Vercel Serverless Function: Send email via Gmail SMTP
//  Path: /api/send-email  (POST)
//  Body: { to, subject, text, html, from? }
//
//  Requires Environment Variables in Vercel:
//    SMTP_HOST  (default smtp.gmail.com)
//    SMTP_PORT  (default 587)
//    SMTP_USER  your Gmail address (e.g. you@gmail.com)
//    SMTP_PASS  a Gmail APP PASSWORD (NOT your normal password)
//    SMTP_FROM  optional default From (e.g. "PO Manager <you@gmail.com>")
//
//  Gmail app password: Google Account → Security → 2-Step Verification
//    must be ON → App passwords → generate one for "Mail".
// ════════════════════════════════════════════════════════════════
const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const configured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true, service: 'send-email',
      configured,
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || '587',
      user: process.env.SMTP_USER ? process.env.SMTP_USER.replace(/(.{2}).*(@.*)/, '$1***$2') : null,
      hint: configured ? 'Ready. POST {to, subject, text|html}.' : 'Set SMTP_USER + SMTP_PASS (Gmail app password) in Vercel env vars, then redeploy.'
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (!configured) return res.status(500).json({ ok: false, error: 'Email not configured. Set SMTP_USER + SMTP_PASS (Gmail app password) in Vercel.' });

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { to, subject, text, html, from } = body || {};
    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({ ok: false, error: 'to, subject, and text or html are required' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465, // true for 465, false for 587
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const info = await transporter.sendMail({
      from: from || process.env.SMTP_FROM || process.env.SMTP_USER,
      to, subject,
      text: text || undefined,
      html: html || undefined,
    });

    return res.status(200).json({ ok: true, messageId: info.messageId, accepted: info.accepted });
  } catch (err) {
    console.error('send-email error:', err);
    return res.status(500).json({ ok: false, error: (err && err.message) || 'Send failed' });
  }
};
