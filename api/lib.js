/* 7GIONNY — helper KV Upstash (Vercel KV, via API REST) pour l'état du débat.
   Variables d'environnement Vercel :
     UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN */
'use strict';

const KEY = '7gionny:debate:state';

async function kv(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN manquants (Vercel → Settings → Environment Variables)');
  const r = await fetch(`${url}/${String(args[0]).toLowerCase()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

export async function getState() {
  try {
    const raw = await kv(['GET', KEY]);
    if (raw) {
      const s = JSON.parse(raw);
      // débat expiré sans clôture → on le clôture proprement
      if (s.mode === 'live' && Date.now() >= s.endsAt) {
        const va = s.va || 0, vb = s.vb || 0;
        const ended = {
          mode: 'ended', source: s.source, question: s.question, a: s.a, b: s.b,
          va, vb, startsAt: s.startsAt, endsAt: Date.now(),
          winner: va === vb ? null : (va > vb ? 'A' : 'B')
        };
        await setState(ended, 30);
        return ended;
      }
      if (s.mode === 'ended' && Date.now() >= s.endsAt + 6000) return { mode: 'idle' };
      return s;
    }
  } catch (e) { /* KV inatteignable → idle */ }
  return { mode: 'idle' };
}

export async function setState(s, ttlSec) {
  await kv(['SET', KEY, JSON.stringify(s), 'EX', Math.max(10, Math.round(ttlSec))]);
  return s;
}

export const idle = () => ({ mode: 'idle' });
