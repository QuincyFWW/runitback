/* big screen: stateless slides driven by phase + a 2s aggregates poll */
(function () {
  const G = GAME, fmt = G.fmt;
  const stage = document.getElementById('stage');
  let agg = null;

  /* bar scale ceilings so averages read proportionally */
  const MAX = { car: 70000, shopping: 15000, housing: 10000, vacation: 15000, veh: 20000 };
  const pct = (v, m) => Math.min(100, Math.round((v || 0) / m * 100));
  const num = v => (v === null || v === undefined) ? 0 : Number(v);

  function aggRow(lab, p, val, hot) {
    return '<div class="agg' + (hot ? ' hot' : '') + '"><span class="lab">' + lab + '</span>'
      + '<span class="bar"><i style="width:' + p + '%"></i></span><span class="val">' + val + '</span></div>';
  }
  const ticker = txt => '<div class="ticker">' + txt + '</div>';
  function clock() {
    const t = Conn.countdown();
    return t === null ? '' : ' · 0:' + String(t).padStart(2, '0') + ' left';
  }

  function slide(phase) {
    const players = agg ? num(agg.players) : 0;
    if (phase === 'lobby') return '<div class="slide">'
      + '<div class="eyebrow">Final Whistle Wealth</div>'
      + '<div class="s-hero" style="font-size:5.5cqw">Grab your phone.<br>Scan in.</div>'
      + '<div class="qrbox"><img src="assets/qr.png?v=1" alt="QR code to join"></div>'
      + '<div class="joincount"><b>' + players + '</b><span>phones in</span></div></div>';

    if (phase === 'r1') {
      const r = (agg && agg.r1) || {};
      return '<div class="slide"><div class="eyebrow">What this room is spending, on average</div>'
        + '<div class="aggwrap">'
        + aggRow('The car', pct(r.car, MAX.car), fmt(num(r.car)), true)
        + aggRow('Shopping', pct(r.shopping, MAX.shopping), fmt(num(r.shopping)), false)
        + aggRow('Housing', pct(r.housing, MAX.housing), fmt(num(r.housing)), false)
        + aggRow('Trips', pct(r.vacation, MAX.vacation), fmt(num(r.vacation)), false)
        + '</div>' + ticker('Average total spent: ' + fmt(num(r.total)) + ' of $100,000' + clock()) + '</div>';
    }

    if (phase === 'r2') {
      const r = (agg && agg.r2) || {};
      return '<div class="slide"><div class="eyebrow">Future you, on average</div>'
        + '<div class="aggwrap">'
        + aggRow('Savings', pct(r.hysa, MAX.veh), fmt(num(r.hysa)), false)
        + aggRow('Investing', pct(r.sp500, MAX.veh), fmt(num(r.sp500)), false)
        + aggRow('Roth IRA', pct(r.roth, MAX.veh), fmt(num(r.roth)), false)
        + aggRow('Put away $0', pct(num(r.zero), Math.max(1, num(r.n))) , num(r.zero) + ' of ' + num(r.n), true)
        + '</div>' + ticker('Round 2' + clock()) + '</div>';
    }

    if (phase === 'april') return '<div class="slide black"><div class="s-hero pulse">April<br>arrives.</div></div>';

    if (phase === 'bill') return '<div class="slide black">'
      + '<div class="eyebrow">For this game</div>'
      + '<div class="s-hero">Tax bill:<br><span class="hl">$30,000</span></div>'
      + '<div class="s-fine">' + G.DISCLAIMER + '</div></div>';

    if (phase === 'verdict' || phase === 'cover') {
      const cant = agg ? num(agg.cant_cover) : 0, all = agg ? num(agg.counted) : 0;
      return '<div class="slide black">'
        + '<div class="s-hero"><span class="hl">' + cant + ' of ' + all + '</span><br>of you can\'t<br>cover it.</div>'
        + '<div class="s-sub">' + (phase === 'cover' ? 'Find the money. It has to come from somewhere.' : 'Check your phone. That number is yours.') + '</div>'
        + (phase === 'cover' ? ticker('Nothing sells back for what you paid' + clock()) : '') + '</div>';
    }

    if (phase === 'r4tax') return '<div class="slide">'
      + '<div class="eyebrow">Same money. New order.</div>'
      + '<div class="s-hero">Run it<br><span class="hl">back.</span></div>'
      + '<div class="s-sub">This time, taxes come off before you touch a dollar.</div></div>';

    if (phase === 'r4save' || phase === 'r4spend') {
      const r = (agg && agg.r4) || {};
      return '<div class="slide">'
        + '<div class="eyebrow">Run two, live</div>'
        + '<div class="s-hero" style="font-size:6cqw">Taxes paid.<br><span class="hl">All yours.</span></div>'
        + '<div class="s-sub">Average cash still in hand: ' + fmt(num(r.cash)) + '</div>'
        + ticker((phase === 'r4save' ? 'Future you first' : 'Spend what\'s actually yours') + clock()) + '</div>';
    }

    if (phase === 'flip') return '<div class="slide"><div class="flip">'
      + '<div class="fliplist dim"><h5>How most people think</h5><ol>'
      + '<li>Earn</li><li>Spend</li><li>Save + invest</li><li class="late">Oh yeah... taxes</li></ol></div>'
      + '<div class="fliparrow">→</div>'
      + '<div class="fliplist"><h5>Think in reverse</h5><ol>'
      + '<li>Taxes <small>What isn\'t mine?</small></li>'
      + '<li>Save + invest <small>What do I want to keep?</small></li>'
      + '<li>Spend <small>What\'s actually mine to enjoy?</small></li></ol></div></div></div>';

    if (phase === 'recap') return '<div class="slide">'
      + '<div class="s-hero" style="font-size:6.5cqw">Spending isn\'t<br>the problem.</div>'
      + '<div class="s-sub" style="font-size:2.8cqw;color:var(--mist)">Spending money you haven\'t accounted for is.</div>'
      + '<div class="eyebrow" style="margin-top:2cqw">Final Whistle Wealth</div></div>';

    return '<div class="slide"><div class="s-sub">...</div></div>';
  }

  let lastPhase = null;
  function render(force) {
    if (!Conn.session) return;
    const phase = Conn.session.phase;
    if (phase === lastPhase && !force) return;
    lastPhase = phase;
    stage.innerHTML = slide(phase);
  }

  /* one poller for the whole room's numbers */
  async function pollAgg() {
    try {
      const { data, error } = await sb.rpc('get_aggregates', { p_code: SESSION_CODE });
      if (error) throw error;
      agg = data;
      render(true);
    } catch (e) { /* connState banner covers it */ }
  }
  setInterval(pollAgg, 2000);
  pollAgg();

  window.onConnState = function (ok, fails) {
    let b = document.getElementById('banner');
    if (!ok && fails >= 2) {
      if (!b) {
        b = document.createElement('div');
        b.id = 'banner'; b.className = 'screenbanner';
        b.textContent = 'Connection lost. Reconnecting. Paper sheets are the backup.';
        document.body.appendChild(b);
      }
    } else if (b) b.remove();
  };

  Conn.onPhase(() => render(false));
  Conn.start();
})();
