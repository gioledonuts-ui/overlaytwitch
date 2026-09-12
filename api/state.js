import { getState } from './lib.js';

export default async function handler(req, res) {
  const state = await getState();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).send(JSON.stringify(state));
}
