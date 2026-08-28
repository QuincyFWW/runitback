const assert = require('assert');
const G = require('../js/game.js');

// baseline: touch nothing, net worth run1 = 100k - 30k tax
const r = G.emptyRun();
assert.equal(G.cash1(r), 100000);
assert.equal(G.shortfall(r), 0);
assert.equal(G.netWorth1(r), 70000);

// big spender: 70k car + 25k penthouse + 15k vacation = 110k spent, 0 saved -> negative cash
const o = G.emptyRun();
o.spend = { car: 70000, shopping: 0, housing: 25000, vacation: 15000 };
assert.equal(G.spent(o), 110000);
assert.equal(G.cash1(o), -10000);
assert.equal(G.shortfall(o), 40000);
// assets: car 42000 + housing 0 (rent) + vacation 0 = 42000
assert.equal(G.assets(o), 42000);
// net worth: 42000 + 0 saved - 10000 cash - 30000 tax = 2000
assert.equal(G.netWorth1(o), 2000);

// cover sources: only the car raises money; rent and the trip are sunk
const src = G.coverSources(o);
const byKey = Object.fromEntries(src.map(([k, , v]) => [k, v]));
assert.equal(byKey.car, 42000);
assert.equal(byKey.housing, undefined); // rent has no resale
assert.equal(byKey.vacation, undefined); // the trip has no resale
// selling the car covers the 40000 shortfall
assert.equal(G.coverStillShort(o, { car: true }), 0);
assert.equal(G.coverStillShort(o, {}), 40000);
assert.equal(G.coverStillShort(o, { borrow: true }), 0);

// roth early pull keeps 80%; roth chips cap at the real 2026 IRA limit ($7,500)
const p = G.emptyRun();
p.save.roth = 7500;
assert.equal(Object.fromEntries(G.coverSources(p).map(([k, , v]) => [k, v])).roth, 6000);
const roth = G.VEHICLES.find(v => v.key === 'roth');
assert.equal(Math.max(...roth.chips), 7500);

// asking family quietly raises $5,000
const f = G.emptyRun();
f.spend = { car: 70000, shopping: 0, housing: 25000, vacation: 0 };  // cash 5000, short 25000
assert.equal(G.shortfall(f), 25000);
assert.equal(G.coverStillShort(f, { family: true }), 20000);
assert.equal(G.coverStillShort(f, { family: true, borrow: true }), 0);

// run 2: taxes first, save 20k, spend 39k -> cash2 = 100k-30k-20k-39k = 11000
const t = G.emptyRun();
t.save = { hysa: 10000, sp500: 10000, roth: 0 };
t.spend = { car: 25000, shopping: 2000, housing: 12000, vacation: 0 };
assert.equal(G.cash2(t), 11000);
// a year of growth: hysa 10000*1.04 + sp500 10000*1.10 = 21400
assert.equal(G.grownSaved(t), 21400);
// net worth run2: assets (car 15000 + clothes 600 + rent 0) + 21400 grown + 11000 cash
assert.equal(G.assets(t), 15600);
assert.equal(G.netWorth2(t), 48000);

// menu prices match the 8/28 sheet
const price = (cat, label) => G.MENU.find(c => c.key === cat).opts.find(([t2]) => t2 === label)[1];
assert.equal(price('car', 'Beater car'), 10000);
assert.equal(price('car', 'Luxury car'), 70000);
assert.equal(price('shopping', 'Designer only'), 17000);
assert.equal(price('housing', 'Downtown penthouse'), 48000);
assert.equal(price('vacation', 'Take the PJ'), 25000);

// phases sanity: flip is gone, the leaderboard closes the show
assert.equal(G.PHASES[0].id, 'lobby');
assert.equal(G.PHASES[G.PHASES.length - 1].id, 'board');
assert.ok(!G.PHASES.some(ph => ph.id === 'flip'));
assert.equal(G.PHASES[1].id, 'contract');
assert.ok(G.CONTRACT.some(([, b]) => b.includes('natural life'))); // the buried clause
assert.deepEqual(G.WRITE_PHASES, ['contract', 'r1', 'r2', 'cover', 'r4save', 'r4spend']);
// housing shows monthly, charges yearly
const hz = G.MENU.find(c => c.key === 'housing').opts.find(([t2]) => t2 === 'Shared apartment');
assert.equal(hz[1], 12000);
assert.equal(hz[2], '$1,000/mo');

console.log('game.test.js: all assertions passed');
