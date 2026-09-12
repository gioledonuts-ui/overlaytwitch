import { setState } from './lib.js';

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
    const { question, a, b, duration } = req.body || {};
    if (!question || !a || !b) return res.status(400).send(JSON.stringify({ ok: false, err: 'question, a, b requis' }));
    const dur = Math.min(600, Math.max(15, Math.round(+duration || 120)));
    const state = {
      mode: 'live', source: 'api',
      question: String(question).slice(0, 140),
      a: String(a).slice(0, 60),
      b: String(b).slice(0, 60),
      va: 0, vb: 0, votes: {},
      startsAt: Date.now(),
      endsAt: Date.now() + dur * 1000
    };
    await setState(state, dur + 90);
    res.status(200).send(JSON.stringify({ ok: true, state }));
  } catch (e) {
    res.status(500).send(JSON.stringify({ ok: false, err: String(e.message || e) }));
  }
}
