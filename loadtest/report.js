/* Post-run report: every player's name, both runs' spending and saving, net
   worths, and the round-to-round difference. Writes CSV to stdout-adjacent file.
   Usage: [RIB_CODE=BC26] node report.js [out.csv] */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const G = require('../js/game.js');

const URL = 'https://hsveuzsqxeyrzquyynxk.supabase.co';
const ANON = 'sb_publishable_8unOQcvzasOPCh5IOHwIPg_NGC3QrO6';
const CODE = process.env.RIB_CODE || 'BC26';
const OUT = process.argv[2] || 'run-report.csv';

const num = v => (v === null || v === undefined) ? 0 : Number(v);

(async () => {
  const sb = createClient(URL, ANON);
  const { data: sess } = await sb.from('sessions').select('*').eq('code', CODE).single();
  const { data: players } = await sb.from('players').select('*').eq('session_id', sess.id);
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await sb.from('choices').select('*').eq('session_id', sess.id).range(from, from + 999);
    if (error) { console.error(error.message); process.exit(1); }
    all.push(...page);
    if (page.length < 1000) break;
  }
  const byPlayer = new Map();
  for (const c of all) {
    if (!byPlayer.has(c.player_id)) byPlayer.set(c.player_id, {});
    byPlayer.get(c.player_id)[c.round] = c;
  }

  const rows = [];
  for (const p of players) {
    const ch = byPlayer.get(p.id) || {};
    const run1 = G.emptyRun(), run2 = G.emptyRun();
    for (const k of Object.keys(run1.spend)) {
      run1.spend[k] = num(ch.r1 && ch.r1.payload[k]);
      run2.spend[k] = num(ch.r4spend && ch.r4spend.payload[k]);
    }
    for (const k of Object.keys(run1.save)) {
      run1.save[k] = num(ch.r2 && ch.r2.payload[k]);
      run2.save[k] = num(ch.r4save && ch.r4save.payload[k]);
    }
    const nw1 = G.netWorth1(run1), nw2 = G.netWorth2(run2);
    rows.push({
      name: p.first_name || 'Player',
      signed: !!(ch.contract && ch.contract.payload.signed),
      spent1: G.spent(run1), saved1: G.saved(run1), cash1: G.cash1(run1),
      short: G.shortfall(run1), nw1,
      spent2: G.spent(run2), saved2: G.saved(run2), cash2: G.cash2(run2), nw2,
      diff: nw2 - nw1,
    });
  }
  rows.sort((a, b) => b.nw1 - a.nw1);

  const header = 'rank,name,signed_contract,run1_spent,run1_put_away,run1_cash_at_april,run1_tax_shortfall,run1_net_worth,run2_spent,run2_put_away,run2_cash,run2_net_worth,net_worth_change';
  const lines = rows.map((r, i) => [i + 1, r.name, r.signed ? 'yes' : 'no', r.spent1, r.saved1, r.cash1, r.short, r.nw1, r.spent2, r.saved2, r.cash2, r.nw2, r.diff].join(','));
  fs.writeFileSync(OUT, header + '\n' + lines.join('\n') + '\n');

  const n = rows.length;
  const avg = f => Math.round(rows.reduce((a, r) => a + f(r), 0) / Math.max(1, n));
  const cantCover = rows.filter(r => r.short > 0).length;
  const improved = rows.filter(r => r.diff > 0).length;
  console.log(JSON.stringify({
    session: CODE, players: n,
    signed: rows.filter(r => r.signed).length,
    avg_run1_spent: avg(r => r.spent1), avg_run1_put_away: avg(r => r.saved1),
    cant_cover_bill: cantCover, avg_shortfall_among_short: Math.round(rows.filter(r => r.short > 0).reduce((a, r) => a + r.short, 0) / Math.max(1, cantCover)),
    avg_run1_net_worth: avg(r => r.nw1),
    avg_run2_spent: avg(r => r.spent2), avg_run2_put_away: avg(r => r.saved2),
    avg_run2_net_worth: avg(r => r.nw2),
    avg_net_worth_change: avg(r => r.diff), improved_in_run2: improved,
    top3: rows.slice(0, 3).map(r => r.name + ' ' + G.fmt(r.nw1)),
    csv: OUT,
  }, null, 2));
})();
