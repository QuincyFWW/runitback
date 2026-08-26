const assert = require('assert');
const G = require('../js/game.js');

// baseline: touch nothing, net worth run1 = 100k - 30k tax
const r = G.emptyRun();
assert.equal(G.cash1(r), 100000);
assert.equal(G.shortfall(r), 0);
assert.equal(G.netWorth1(r), 70000);

// big spender: 70k car, 15k shopping, 10k housing, 15k vacation = 110k > 100k is impossible
// realistic overspend: 70k car + 15k vacation + 10k housing = 95k spent, 0 saved
const o = G.emptyRun();
o.spend = { car: 70000, shopping: 0, housing: 10000, vacation: 15000 };
assert.equal(G.spent(o), 95000);
assert.equal(G.cash1(o), 5000);
assert.equal(G.shortfall(o), 25000);
// assets: car 42000 + housing 5000 + vacation 0 = 47000
assert.equal(G.assets(o), 47000);
// net worth: 47000 + 0 saved + 5000 cash - 30000 tax = 22000
assert.equal(G.netWorth1(o), 22000);

// cover sources for the overspender: car sells for 42000, housing 2500 wait .5*10000=5000
const src = G.coverSources(o);
const byKey = Object.fromEntries(src.map(([k, , v]) => [k, v]));
assert.equal(byKey.car, 42000);
assert.equal(byKey.housing, 5000);
assert.equal(byKey.vacation, undefined); // the trip has no resale
// selling the car alone covers the 25000 shortfall
assert.equal(G.coverStillShort(o, { car: true }), 0);
assert.equal(G.coverStillShort(o, { housing: true }), 20000);
assert.equal(G.coverStillShort(o, { housing: true, borrow: true }), 0);

// roth early pull keeps 80%
const p = G.emptyRun();
p.save.roth = 20000;
assert.equal(Object.fromEntries(G.coverSources(p).map(([k, , v]) => [k, v])).roth, 16000);

// run 2: taxes first, save 20k, spend 29k -> cash2 = 100k-30k-20k-29k = 21000
const t = G.emptyRun();
t.save = { hysa: 10000, sp500: 10000, roth: 0 };
t.spend = { car: 20000, shopping: 7000, housing: 0, vacation: 2000 };
assert.equal(G.cash2(t), 21000);
// net worth run2: assets (car 12000 + clothes 2100 + trip 0) + 20000 saved + 21000 cash
assert.equal(G.assets(t), 12000 + 2100 + 0);
assert.equal(G.netWorth2(t), 55100);

// phases sanity
assert.equal(G.PHASES[0].id, 'lobby');
assert.equal(G.PHASES[G.PHASES.length - 1].id, 'recap');
assert.deepEqual(G.WRITE_PHASES, ['r1', 'r2', 'cover', 'r4save', 'r4spend']);

console.log('game.test.js: all assertions passed');
