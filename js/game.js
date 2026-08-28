/* Run It Back — pure game logic. No DOM, no network. Runs in browser and node. */
(function (root) {
  const START = 100000, TAX = 30000;
  const fmt = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

  const MENU = [
    { key: 'car', label: 'The Car', opts: [['No car', 0], ['Beater car', 10000], ['Used upgrade', 25000], ['New car', 40000], ['Luxury car', 70000]] },
    { key: 'shopping', label: 'Shopping', opts: [['No drip. Team issued gear', 0], ['Small spree', 2000], ['Medium spree', 5000], ['Large spree', 10000], ['Designer only', 17000]] },
    { key: 'housing', label: 'Housing, for the year', opts: [['Live at home', 0], ['Shared apartment', 12000], ['Solo place', 25000], ['Downtown penthouse', 48000]] },
    { key: 'vacation', label: 'Vacation', opts: [['Stay home', 0], ['Weekend trip', 2000], ['Big vacation', 7000], ['Month-long trip', 15000], ['Take the PJ', 25000]] },
  ];
  /* no explainer subs (8/28): Quincy talks these through live.
     Roth chips stop at the real 2026 IRA contribution limit ($7,500). */
  const VEHICLES = [
    { key: 'hysa', label: 'Savings', chips: [0, 5000, 10000, 20000] },
    { key: 'sp500', label: 'Investing (S&P 500)', chips: [0, 5000, 10000, 20000] },
    { key: 'roth', label: 'Roth IRA', chips: [0, 3750, 7500] },
  ];
  const CHIP_VALUES = [0, 5000, 10000, 20000];
  /* sell-back rates when covering the bill; rent and the trip are already spent.
     Roth early pull keeps 80% (penalty + taxes) */
  const DEP = { car: .6, housing: 0, shopping: .3, vacation: 0 };
  const ROTH_KEEP = .8;
  /* what asking family raises; the number stays hidden until they tap it */
  const FAMILY_HELP = 5000;
  /* one year of growth on money put away, at long-run average rates:
     savings ~4% APY, S&P 500 ~10% historical average, Roth invested the same.
     Averages for the game, never a promise. */
  const GROWTH = { hysa: .04, sp500: .10, roth: .10 };
  const DISCLAIMER = 'For this game only. Real tax obligations vary based on your income, location, deductions and individual circumstances.';

  /* the authoritative phase sequence; seconds drive the cosmetic countdown */
  const PHASES = [
    { id: 'lobby', label: 'Lobby (QR up)', seconds: 0 },
    { id: 'r1', label: 'Round 1: Spend It', seconds: 90 },
    { id: 'r2', label: 'Round 2: Future You', seconds: 75 },
    { id: 'april', label: 'April Arrives', seconds: 0 },
    { id: 'bill', label: 'The Tax Bill', seconds: 0 },
    { id: 'verdict', label: 'Your Verdict', seconds: 0 },
    { id: 'cover', label: 'Cover The Bill', seconds: 75 },
    { id: 'r4tax', label: 'Run It Back: Taxes First', seconds: 0 },
    { id: 'r4save', label: 'Run It Back: Future You', seconds: 60 },
    { id: 'r4spend', label: 'Run It Back: Spend It', seconds: 90 },
    { id: 'recap', label: 'Recap: Net Worth', seconds: 0 },
    { id: 'board', label: 'Leaderboard', seconds: 0 },
  ];
  /* phases in which the phone writes a choices row, and which run object feeds it */
  const WRITE_PHASES = ['r1', 'r2', 'cover', 'r4save', 'r4spend'];

  const emptyRun = () => ({ spend: { car: 0, shopping: 0, housing: 0, vacation: 0 }, save: { hysa: 0, sp500: 0, roth: 0 } });
  const spent = r => Object.values(r.spend).reduce((a, b) => a + b, 0);
  const saved = r => Object.values(r.save).reduce((a, b) => a + b, 0);
  /* what the put-away money is worth after a year of average growth */
  const grownSaved = r => Object.keys(r.save).reduce((a, k) => a + Math.round(r.save[k] * (1 + GROWTH[k])), 0);
  const cash1 = run1 => START - spent(run1) - saved(run1);
  const cash2 = run2 => START - TAX - saved(run2) - spent(run2);
  const assets = r => MENU.reduce((a, c) => a + Math.round(r.spend[c.key] * DEP[c.key]), 0);
  const netWorth1 = run1 => assets(run1) + grownSaved(run1) + cash1(run1) - TAX;
  const netWorth2 = run2 => assets(run2) + grownSaved(run2) + cash2(run2);
  const shortfall = run1 => Math.max(0, TAX - cash1(run1));

  const CAT_SELL = { car: 'the car', housing: 'the place', shopping: 'the clothes', vacation: 'the trip' };
  /* categories that raise nothing when sold back, with the line the phone shows */
  const SUNK = { housing: 'The rent is spent. Nobody buys it back', vacation: 'Sell the trip. Already lived it' };
  /* everything a short player can raise cash from: [key, label, amount raised] */
  function coverSources(run1) {
    const s = [];
    if (run1.save.hysa) s.push(['hysa', 'Drain the savings', run1.save.hysa]);
    if (run1.save.sp500) s.push(['sp500', 'Sell the investments', run1.save.sp500]);
    if (run1.save.roth) s.push(['roth', 'Pull from the Roth early. Comes with taxes plus a penalty', Math.round(run1.save.roth * ROTH_KEEP)]);
    for (const c of MENU) {
      const paid = run1.spend[c.key]; if (!paid) continue;
      const gets = Math.round(paid * DEP[c.key]);
      if (gets > 0) s.push([c.key, 'Sell ' + CAT_SELL[c.key] + '. Paid ' + fmt(paid) + ', sells for', gets]);
    }
    return s;
  }
  function coverStillShort(run1, cover) {
    const short = shortfall(run1);
    const fromSources = coverSources(run1).reduce((a, [k, , v]) => a + (cover[k] ? v : 0), 0)
      + (cover.family ? FAMILY_HELP : 0);
    const borrowed = cover.borrow ? Math.max(0, short - fromSources) : 0;
    return Math.max(0, short - fromSources - borrowed);
  }

  const G = {
    START, TAX, fmt, MENU, VEHICLES, CHIP_VALUES, DEP, ROTH_KEEP, FAMILY_HELP, GROWTH, DISCLAIMER, SUNK,
    PHASES, WRITE_PHASES, emptyRun, spent, saved, grownSaved, cash1, cash2, assets,
    netWorth1, netWorth2, shortfall, coverSources, coverStillShort,
  };
  root.GAME = G;
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof self !== 'undefined' ? self : this);
