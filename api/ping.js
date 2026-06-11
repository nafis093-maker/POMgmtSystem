// Minimal test function — visit /api/ping to confirm serverless functions deploy at all
module.exports = (req, res) => {
  res.status(200).json({ ok: true, pong: true, time: new Date().toISOString() });
};
