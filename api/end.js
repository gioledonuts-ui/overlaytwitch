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
    if (s.mode !== 'live') return res.status(200).send(JSON.stringify({ ok: true, state: s }));
    const va = s.va || 0, vb = s.vb || 0;
    const ended = {
      mode: 'ended', source: s.source, question: s.question, a: s.a, b: s.b,
      va, vb, endsAt: Date.now(),
      winner: va === vb ? null : (va > vb ? 'A' : 'B')
    };
    await setState(ended, 30);
    res.status(200).send(JSON.stringify({ ok: true, state: ended }));
  } catch (e) {
    res.status(500).send(JSON.stringify({ ok: false, err: String(e.message || e) }));
  }
}
