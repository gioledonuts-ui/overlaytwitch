import { getState, setState } from './lib.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).send(JSON.stringify({ ok: false }));

  try {
    const s = await getState();
    if (s.mode !== 'live') return res.status(409).send(JSON.stringify({ ok: false, err: 'aucun débat en cours', state: s }));

    const { choice, user } = req.body || {};
    const c = String(choice || '').toUpperCase().startsWith('B') ? 'B' : 'A';
    const u = String(user || 'anon').toLowerCase().slice(0, 64);

    s.votes = s.votes || {};
    const prev = s.votes[u];
    if (prev) {
      if (prev === c) return res.status(200).send(JSON.stringify({ ok: true, state: s }));
      s[prev === 'A' ? 'va' : 'vb'] = Math.max(0, (s[prev === 'A' ? 'va' : 'vb'] || 0) - 1);
      delete s.votes[u];
    }
    s[c === 'A' ? 'va' : 'vb'] = (s[c === 'A' ? 'va' : 'vb'] || 0) + 1;
    if (Object.keys(s.votes).length < 8000) s.votes[u] = c;   // cap mémoire

    const remaining = Math.max(15, (s.endsAt - Date.now()) / 1000 + 90);
    await setState(s, remaining);
    res.status(200).send(JSON.stringify({ ok: true, state: s }));
  } catch (e) {
    res.status(500).send(JSON.stringify({ ok: false, err: String(e.message || e) }));
  }
}
