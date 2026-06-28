/**
 * /api/notes
 *
 * Proxy endpoints that forward requests to the notes app running on the same server.
 * The notes app must expose:
 *   GET http://localhost:3010/health
 *   GET http://localhost:3010/api/sync/state
 *   GET http://localhost:3010/api/logs?limit=N
 *
 * The notes app URL is configurable via NOTES_API_URL env var.
 * Default: http://localhost:3010
 *
 * Container control (start/stop/restart) is handled via the existing dockerode
 * containers route — this route adds notes-specific status and log proxying.
 *
 * Routes:
 *   GET  /api/notes/status          → notes /health + /api/sync/state merged
 *   GET  /api/notes/logs?limit=100  → notes /api/logs proxied
 */

import { Router } from 'express';

export const router = Router();

const NOTES_URL = (process.env.NOTES_API_URL || 'http://localhost:3010').replace(/\/$/, '');
const FETCH_TIMEOUT_MS = 5000;

// ── Helper: fetch with timeout ────────────────────────────────────────────────
async function fetchNotes(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${NOTES_URL}${path}`, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── GET /api/notes/status ─────────────────────────────────────────────────────
// Returns a merged object from /health and /api/sync/state so the dashboard
// only needs one call to render the notes status card.
router.get('/status', async (_req, res) => {
  let health = null;
  let syncState = null;
  let reachable = false;

  try {
    const [healthRes, syncRes] = await Promise.all([
      fetchNotes('/health'),
      fetchNotes('/api/sync/state'),
    ]);

    if (healthRes.ok) health = await healthRes.json();
    if (syncRes.ok)   syncState = await syncRes.json();
    reachable = true;
  } catch {
    reachable = false;
  }

  res.json({
    reachable,
    url: NOTES_URL,
    health:    health    ?? null,
    syncState: syncState ?? null,
  });
});

// ── GET /api/notes/logs?limit=100 ────────────────────────────────────────────
// Proxies the notes /api/logs endpoint.
// The notes app returns { logs: [ { ts, level, msg, ... } ] } or lines array.
// We forward whatever the notes app returns unchanged.
router.get('/logs', async (req, res) => {
  const limit = parseInt(req.query.limit ?? '100', 10);
  try {
    const r = await fetchNotes(`/api/logs?limit=${limit}`);
    if (!r.ok) {
      return res.status(r.status).json({ error: `Notes API returned ${r.status}` });
    }
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Notes app not reachable', detail: err.message });
  }
});
