// Vercel automatically turns any file in /api into a live endpoint —
// this one becomes GET /api/health once deployed. No build step, no
// framework, no config needed for this to work.
module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'ZAP backend is alive on Vercel',
    timestamp: new Date().toISOString()
  });
};
