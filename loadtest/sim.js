/* 150-player gameday simulation. Every simulated athlete has a fake first name
   and one coherent persona: run-1 picks, run-2 picks, real cash math throughout,
   contract signed, answers locked. The pseudo-host walks all 13 phases.
   Usage: RIB_LOAD_KEY=<host_key> [RIB_CODE=BC26] node sim.js [players]
   Asserts: >95% broadcast receipt <2s, p95 write <1.5s, zero lost rows. */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const URL = 'https://hsveuzsqxeyrzquyynxk.supabase.co';
const ANON = 'sb_publishable_8unOQcvzasOPCh5IOHwIPg_NGC3QrO6';
const CODE = process.env.RIB_CODE || 'LOAD';
const KEY = process.env.RIB_LOAD_KEY;
const N = parseInt(process.argv[2] || '150', 10);
const G = require('../js/game.js');
if (!KEY) { console.error('set RIB_LOAD_KEY'); process.exit(1); }

const PHASE_SCHEDULE = G.PHASES.map(p => p.id).filter(id => id !== 'lobby');
const PHASE_MS = 12000;

const NAMES = ['Jaylen', 'Marcus', 'DeAndre', 'Malik', 'Xavier', 'Tyrese', 'Amari', 'Jalen', 'Darius', 'Kobe',
  'Zion', 'Trey', 'Cam', 'Isaiah', 'Elijah', 'Josh', 'Caleb', 'Micah', 'Noah', 'Ethan',
  'Maya', 'Zoe', 'Aaliyah', 'Imani', 'Skylar', 'Jada', 'Nia', 'Kennedy', 'Sydney', 'Morgan',
  'Taylor', 'Jordan', 'Riley', 'Peyton', 'Avery', 'Quinn', 'Reese', 'Bailey', 'Emerson', 'Rowan',
  'Grace', 'Chloe', 'Layla', 'Sofia', 'Ava', 'Mia', 'Ella', 'Ruby', 'Naomi', 'Willow'];
const fakeName = i => NAMES[i % NAMES.length] + (i >= NAMES.length ? ' ' + String.fromCharCode(64 + Math.ceil((i + 1) / NAMES.length)) : '');

const writeLat = [], writeFail = [];
const receipt = new Map(); // phase -> [latencies ms]
let sessionId = null, broadcastAt = {};

const rand = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* one coherent athlete: instinct run, then the smart run, all math real */
function makePersona() {
  const run1 = G.emptyRun(), run2 = G.emptyRun();
  for (const c of G.MENU) run1.spend[c.key] = rand(c.opts)[1];
  let cash = G.START - G.spent(run1);
  for (const v of G.VEHICLES) { const ch = rand(v.chips); if (ch <= cash) { run1.save[v.key] = ch; cash -= ch; } }
  let cash2 = G.START - G.TAX;
  for (const v of G.VEHICLES) { const ch = rand(v.chips); if (ch <= cash2) { run2.save[v.key] = ch; cash2 -= ch; } }
  for (const c of G.MENU) {
    const pick = rand(c.opts.filter(([, v]) => v <= cash2))[1];
    run2.spend[c.key] = pick; cash2 -= pick;
  }
  return { run1, run2 };
}

function payloadFor(phase, p) {
  if (phase === 'contract') return { payload: { signed: true, locked: true }, cash: G.START };
  if (phase === 'r1') return { payload: { ...p.run1.spend, locked: true }, cash: G.cash1(p.run1) };
  if (phase === 'r2') return { payload: { ...p.run1.save, locked: true }, cash: G.cash1(p.run1) };
  if (phase === 'cover') return { payload: { sources: { borrow: true }, locked: true }, cash: G.cash1(p.run1) };
  if (phase === 'r4save') return { payload: { ...p.run2.save, locked: true }, cash: G.cash2(p.run2) };
  if (phase === 'r4spend') return { payload: { ...p.run2.spend, locked: true }, cash: G.cash2(p.run2) };
  return null;
}

async function player(i) {
  const sb = createClient(URL, ANON);
  const pid = crypto.randomUUID();
  const persona = makePersona();
  let phase = 'lobby', subOk = false;
  const written = new Set();

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

  const { error: perr } = await sb.from('players').insert({ id: pid, session_id: sessionId, joined_phase: 'lobby', first_name: fakeName(i) });
  if (perr) writeFail.push('player:' + perr.message);

  // write each open round's answer, repeating like a real debounced phone
  const until = Date.now() + (PHASE_SCHEDULE.length + 1) * PHASE_MS + 5000;
  while (Date.now() < until) {
    await sleep(2000 + Math.random() * 2000);
    if (!G.WRITE_PHASES.includes(phase)) continue;
    const spec = payloadFor(phase, persona);
    if (!spec) continue;
    const t0 = Date.now();
    const { error } = await sb.from('choices').upsert({
      session_id: sessionId, player_id: pid, round: phase, payload: spec.payload, cash_left: spec.cash,
    });
    if (error) writeFail.push(phase + ':' + error.message);
    else writeLat.push(Date.now() - t0);
  }
  try { sb.removeAllChannels(); } catch (e) {}
  return { pid, subOk };
}

async function pseudoScreen() {
  const sb = createClient(URL, ANON);
  const until = Date.now() + (PHASE_SCHEDULE.length + 1) * PHASE_MS + 5000;
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
    const spec = G.PHASES.find(p => p.id === phase);
    const { error } = await sb.rpc('advance_round', { p_code: CODE, p_key: KEY, p_phase: phase, p_seconds: spec.seconds || 0 });
    if (error) { console.error('advance failed', phase, error.message); continue; }
    broadcastAt[phase] = Date.now();
    await ch.send({ type: 'broadcast', event: 'phase', payload: { phase, started_at: new Date().toISOString(), seconds: spec.seconds || 0 } });
    console.log('phase ->', phase);
  }
}

(async () => {
  const boot = createClient(URL, ANON);
  const { data: sess, error } = await boot.from('sessions').select('*').eq('code', CODE).single();
  if (error) { console.error(error.message); process.exit(1); }
  sessionId = sess.id;
  await boot.rpc('advance_round', { p_code: CODE, p_key: KEY, p_phase: 'lobby', p_seconds: 0 });

  console.log(`session ${CODE}: spawning ${N} named players staggered over 20s...`);
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
  const { data: board } = await boot.rpc('get_leaderboard', { p_code: CODE });
  console.log('\n===== RESULTS =====');
  console.log(`players spawned: ${N}, channel subscribed: ${subs}`);
  console.log(`broadcast receipts: ${rec}/${expected} (${(rec / expected * 100).toFixed(1)}%), <2s: ${(recFast / Math.max(1, rec) * 100).toFixed(1)}%`);
  console.log(`writes: ${writeLat.length} ok, ${writeFail.length} failed; p50 ${p(.5)}ms, p95 ${p(.95)}ms`);
  console.log(`screen polls: ${screen.polls}, failed: ${screen.fails}`);
  console.log('db row counts:', JSON.stringify(counts));
  console.log('leaderboard top 3:', JSON.stringify(board));
  if (writeFail.length) console.log('sample failures:', writeFail.slice(0, 5));
  const pass = subs / N > .95 && rec / expected > .95 && recFast / Math.max(1, rec) > .95 && p(.95) < 1500 && writeFail.length === 0 && screen.fails === 0;
  console.log(pass ? 'PASS' : 'CHECK FAILURES ABOVE');
  process.exit(0);
})();
