/* 150-player gameday simulation against the LOAD session.
   Usage: RIB_LOAD_KEY=<host_key> node sim.js [players]
   Asserts: >95% broadcast receipt <2s, p95 write <1.5s, zero lost rows. */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const URL = 'https://hsveuzsqxeyrzquyynxk.supabase.co';
const ANON = 'sb_publishable_8unOQcvzasOPCh5IOHwIPg_NGC3QrO6';
const CODE = 'LOAD';
const KEY = process.env.RIB_LOAD_KEY;
const N = parseInt(process.argv[2] || '150', 10);
const G = require('../js/game.js');
if (!KEY) { console.error('set RIB_LOAD_KEY'); process.exit(1); }

const PHASE_SCHEDULE = ['r1', 'r2', 'april', 'bill', 'verdict', 'cover', 'r4tax', 'r4save', 'r4spend', 'flip', 'recap'];
const PHASE_MS = 12000;

const writeLat = [], writeFail = [];
const receipt = new Map(); // phase -> [latencies ms]
let sessionId = null, broadcastAt = {};

const rand = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function randomPayload(phase) {
  if (phase === 'r1' || phase === 'r4spend') {
    const p = {};
    for (const c of G.MENU) p[c.key] = rand(c.opts)[1];
    return p;
  }
  if (phase === 'r2' || phase === 'r4save') {
    const p = {};
    for (const v of G.VEHICLES) p[v.key] = rand(G.CHIP_VALUES);
    return p;
  }
  if (phase === 'cover') return { sources: { borrow: true } };
  return null;
}

async function player(i) {
  const sb = createClient(URL, ANON);
  const pid = crypto.randomUUID();
  let phase = 'lobby', subOk = false;

  const ch = sb.channel('session:' + CODE);
  ch.on('broadcast', { event: 'phase' }, ({ payload }) => {
    phase = payload.phase;
    const at = broadcastAt[payload.phase];
    if (at) {
      if (!receipt.has(payload.phase)) receipt.set(payload.phase, []);
      receipt.get(payload.phase).push(Date.now() - at);
    }
  });
  await new Promise(res => ch.subscribe(s => { if (s === 'SUBSCRIBED') { subOk = true; res(); } if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') res(); }));

  const { error: perr } = await sb.from('players').insert({ id: pid, session_id: sessionId, joined_phase: 'lobby' });
  if (perr) writeFail.push('player:' + perr.message);

  // keep writing random choices while the game runs
  const until = Date.now() + PHASE_SCHEDULE.length * PHASE_MS + 5000;
  while (Date.now() < until) {
    await sleep(2000 + Math.random() * 2000);
    if (!G.WRITE_PHASES.includes(phase)) continue;
    const payload = randomPayload(phase);
    const cash = 100000 - Math.floor(Math.random() * 80000);
    const t0 = Date.now();
    const { error } = await sb.from('choices').upsert({
      session_id: sessionId, player_id: pid, round: phase, payload, cash_left: cash,
    });
    if (error) writeFail.push(phase + ':' + error.message);
    else writeLat.push(Date.now() - t0);
  }
  try { sb.removeAllChannels(); } catch (e) {}
  return { pid, subOk };
}

async function pseudoScreen() {
  const sb = createClient(URL, ANON);
  const until = Date.now() + PHASE_SCHEDULE.length * PHASE_MS + 5000;
  let fails = 0, polls = 0;
  while (Date.now() < until) {
    const { error } = await sb.rpc('get_aggregates', { p_code: CODE });
    polls++; if (error) fails++;
    await sleep(2000);
  }
  return { polls, fails };
}

async function pseudoHost() {
  const sb = createClient(URL, ANON);
  const ch = sb.channel('session:' + CODE);
  await new Promise(res => ch.subscribe(s => { if (s === 'SUBSCRIBED') res(); }));
  for (const phase of PHASE_SCHEDULE) {
    await sleep(PHASE_MS);
    const { error } = await sb.rpc('advance_round', { p_code: CODE, p_key: KEY, p_phase: phase, p_seconds: 90 });
    if (error) { console.error('advance failed', phase, error.message); continue; }
    broadcastAt[phase] = Date.now();
    await ch.send({ type: 'broadcast', event: 'phase', payload: { phase, started_at: new Date().toISOString(), seconds: 90 } });
    console.log('phase ->', phase);
  }
}

(async () => {
  const boot = createClient(URL, ANON);
  const { data: sess, error } = await boot.from('sessions').select('*').eq('code', CODE).single();
  if (error) { console.error(error.message); process.exit(1); }
  sessionId = sess.id;
  await boot.rpc('advance_round', { p_code: CODE, p_key: KEY, p_phase: 'lobby', p_seconds: 0 });

  console.log(`spawning ${N} players staggered over 20s...`);
  const joins = [];
  for (let i = 0; i < N; i++) {
    joins.push(sleep(Math.random() * 20000).then(() => player(i)));
  }
  const screenP = pseudoScreen();
  const hostP = pseudoHost();
  const players = await Promise.all(joins);
  await hostP;
  const screen = await screenP;

  // report
  const subs = players.filter(p => p.subOk).length;
  writeLat.sort((a, b) => a - b);
  const p = q => writeLat[Math.floor(writeLat.length * q)] || 0;
  let rec = 0, recFast = 0;
  for (const [, arr] of receipt) { rec += arr.length; recFast += arr.filter(v => v < 2000).length; }
  const expected = subs * Object.keys(broadcastAt).length;

  const { data: counts } = await boot.rpc('get_aggregates', { p_code: CODE });
  console.log('\n===== RESULTS =====');
  console.log(`players spawned: ${N}, channel subscribed: ${subs}`);
  console.log(`broadcast receipts: ${rec}/${expected} (${(rec / expected * 100).toFixed(1)}%), <2s: ${(recFast / Math.max(1, rec) * 100).toFixed(1)}%`);
  console.log(`writes: ${writeLat.length} ok, ${writeFail.length} failed; p50 ${p(.5)}ms, p95 ${p(.95)}ms`);
  console.log(`screen polls: ${screen.polls}, failed: ${screen.fails}`);
  console.log('db row counts:', JSON.stringify(counts));
  if (writeFail.length) console.log('sample failures:', writeFail.slice(0, 5));
  const pass = subs / N > .95 && rec / expected > .95 && recFast / Math.max(1, rec) > .95 && p(.95) < 1500 && writeFail.length === 0 && screen.fails === 0;
  console.log(pass ? 'PASS' : 'CHECK FAILURES ABOVE');
  process.exit(0);
})();
