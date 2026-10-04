// server_report_route.js: for your Node/Express key server (0camm/sentinelkeys).
//
// THE BUG (from your Render logs): the global JSON parser is limited to 10 KB
//   [error] POST /api/report: PayloadTooLargeError ... limit: 10240
// Scan logs are ~100 KB, so Express rejects them before your route runs.
//
// FIX 1 (required): give /api/report its own, larger limit. This line must come
// BEFORE your existing global parser (the one with limit '10kb'). body-parser skips
// a request that was already parsed, so every other route keeps the 10 KB cap.

app.use('/api/report', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '10kb' }));          // <- your existing line, unchanged

// FIX 2 (only if your current /api/report handler is broken or missing):
// replace it with this. Needs Node 18+ (built-in fetch / FormData / Blob).
// `isValidKey(key, device)` = whatever your /api/verify already uses to check a key.

app.post('/api/report', async (req, res) => {
  try {
    const webhook = (process.env.DISCORD_WEBHOOK_URL || '').trim();
    if (!webhook) return res.status(503).json({ error: 'DISCORD_WEBHOOK_URL not set on server' });

    const b = req.body || {};
    const key = String(b.key || req.get('x-sentinel-key') || '').trim();
    const device = String(b.device || req.get('x-sentinel-device') || '').trim();
    const discordId = String(b.discord_id || '').trim().slice(0, 20);
    const host = String(b.host || '').slice(0, 64);
    const scan = String(b.scan || '').slice(0, 32);
    const text = String(b.log || '').slice(0, 100000);

    if (!key) return res.status(401).json({ error: 'missing key' });
    if (!(await isValidKey(key, device))) return res.status(403).json({ error: 'invalid key' });
    if (!/^\d{1,20}$/.test(discordId) || !text) return res.status(400).json({ error: 'bad report' });

    const form = new FormData();
    form.append('payload_json', JSON.stringify({
      content: `**Sentinel: ${scan}**\nDiscord ID: \`${discordId}\`  |  Host: \`${host}\``,
      allowed_mentions: { parse: [] },              // logs can't ping anyone
    }));
    form.append('files[0]', new Blob([text], { type: 'text/plain' }), `${scan || 'scan'}_${discordId}.txt`);

    const r = await fetch(webhook, { method: 'POST', body: form });
    if (!r.ok) {
      console.error('[report] Discord returned', r.status, (await r.text()).slice(0, 300));
      return res.status(502).json({ error: `webhook returned ${r.status}` });
    }
    console.log(`[report] ${scan} for ${discordId} sent`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[report] failed:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});
