/* big screen: stateless slides driven by phase + a 2s aggregates poll */
(function () {
  const G = GAME, fmt = G.fmt;
  const stage = document.getElementById('stage');
  let agg = null, board = null;

  /* bar scale ceilings so averages read proportionally */
  const MAX = { car: 70000, shopping: 17000, housing: 48000, vacation: 25000, veh: 20000 };
  const pct = (v, m) => Math.min(100, Math.round((v || 0) / m * 100));
  const num = v => (v === null || v === undefined) ? 0 : Number(v);

  function aggRow(lab, p, val, hot) {
    return '<div class="agg' + (hot ? ' hot' : '') + '"><span class="lab">' + lab + '</span>'
      + '<span class="bar"><i style="width:' + p + '%"></i></span><span class="val">' + val + '</span></div>';
  }
  const ticker = txt => '<div class="ticker">' + txt + '</div>';
  function clock() {
    const t = Conn.countdownText();
    return t === null ? '' : ' · ' + t + ' left';
  }
  function lockedIn() {
    if (!agg) return '';
    const n = num(agg.players), l = num(agg.locked);
    return n ? ' · Locked in: ' + l + ' of ' + n : '';
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

  function slide(phase) {
    const players = agg ? num(agg.players) : 0;
    if (phase === 'lobby') return '<div class="slide">'
      + '<div class="eyebrow">Final Whistle Wealth</div>'
      + '<div class="s-hero" style="font-size:5.5cqw">Grab your phone.<br>Scan in.</div>'
      + '<div class="s-sub">You just got offered a $100,000 NIL contract.</div>'
      + '<div class="qrbox"><img src="assets/qr.png?v=1" alt="QR code to join"></div>'
      + '<div class="joincount"><b>' + players + '</b><span>phones in</span></div></div>';

    if (phase === 'contract') {
      const n = num(agg && agg.players), l = num(agg && agg.locked);
      return '<div class="slide">'
        + '<div class="eyebrow">Read before you sign</div>'
        + '<div class="s-hero" style="font-size:6cqw">Here\'s your<br>contract.</div>'
        + '<div class="s-paper">'
        + '<div class="sp-title">NIL ENDORSEMENT AGREEMENT</div>'
        + '<div class="sp-line w80"></div><div class="sp-line"></div><div class="sp-line w60"></div>'
        + '<div class="sp-line"></div><div class="sp-line w80"></div><div class="sp-line w40"></div>'
        + '<div class="sp-sig">Sign on your phone</div>'
        + '</div>'
        + ticker('Signed: ' + l + ' of ' + n + clock()) + '</div>';
    }

    if (phase === 'r1') {
      const r = (agg && agg.r1) || {};
      return '<div class="slide"><div class="eyebrow">What this room is spending, on average</div>'
        + '<div class="aggwrap">'
        + aggRow('The car', pct(r.car, MAX.car), fmt(num(r.car)), true)
        + aggRow('Shopping', pct(r.shopping, MAX.shopping), fmt(num(r.shopping)), false)
        + aggRow('Housing', pct(r.housing, MAX.housing), fmt(num(r.housing)), false)
        + aggRow('Trips', pct(r.vacation, MAX.vacation), fmt(num(r.vacation)), false)
        + '</div>' + ticker('Average total spent: ' + fmt(num(r.total)) + ' of $100,000' + lockedIn() + clock()) + '</div>';
    }

    if (phase === 'r2') {
      const r = (agg && agg.r2) || {};
      return '<div class="slide"><div class="eyebrow">Future you, on average</div>'
        + '<div class="aggwrap">'
        + aggRow('Savings', pct(r.hysa, MAX.veh), fmt(num(r.hysa)), false)
        + aggRow('Investing', pct(r.sp500, MAX.veh), fmt(num(r.sp500)), false)
        + aggRow('Roth IRA', pct(r.roth, MAX.veh), fmt(num(r.roth)), false)
        + aggRow('Put away $0', pct(num(r.zero), Math.max(1, num(r.n))) , num(r.zero) + ' of ' + num(r.n), true)
        + '</div>' + ticker('Future you' + lockedIn() + clock()) + '</div>';
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
        /* covered players don't lock in; count locks against the short group only */
        + (phase === 'cover' ? ticker('Nothing sells back for what you paid'
            + (agg ? ' · Locked in: ' + num(agg.locked) + ' of ' + cant + ' short' : '') + clock()) : '') + '</div>';
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
        + ticker((phase === 'r4save' ? 'Future you first' : 'Spend what\'s actually yours') + lockedIn() + clock()) + '</div>';
    }

    if (phase === 'board') {
      const rows = board || [];
      return '<div class="slide">'
        + '<div class="eyebrow">Final standings · round 1 net worth</div>'
        + '<div class="s-hero" style="font-size:5cqw">Leaderboard</div>'
        + '<div class="lb">'
        + (rows.length
          ? rows.map((r2, i) => '<div class="lbrow' + (i === 0 ? ' top' : '') + '">'
              + '<span class="rank">' + (i + 1) + '</span><span class="name">' + esc(r2.name) + '</span>'
              + '<span class="nw">' + fmt(num(r2.nw)) + '</span></div>').join('')
          : '<div class="s-sub">Tallying the room...</div>')
        + '</div></div>';
    }

    if (phase === 'recap') {
      const w = Conn.winner;
      return '<div class="slide">'
        + '<div class="s-hero" style="font-size:6.5cqw">Spending isn\'t<br>the problem.</div>'
        + '<div class="s-sub" style="font-size:2.8cqw;color:var(--mist)">Spending money you haven\'t accounted for is.</div>'
        + (w && w.name
          ? '<div class="s-sub" style="margin-top:2cqw"><span class="eyebrow">Covered the bill · drawn from the room</span><br>'
            + '<span class="hl" style="font-size:5cqw;font-weight:900;font-style:italic">' + esc(w.name) + '</span></div>'
          : '')
        + '<div class="eyebrow" style="margin-top:2cqw">Final Whistle Wealth</div></div>';
    }

    return '<div class="slide"><div class="s-sub">...</div></div>';
  }

  let lastPhase = null, lastHtml = '';
  function render(force) {
    if (!Conn.session) return;
    const phase = Conn.session.phase;
    if (phase === lastPhase && !force) return;
    const html = slide(phase);
    if (html === lastHtml) return;
    lastHtml = html;
    stage.innerHTML = html;
    /* entrance animation only when the phase itself changes; data refreshes swap in flat */
    if (phase === lastPhase) {
      stage.querySelectorAll('.slide').forEach(el => { el.style.animation = 'none'; });
    }
    lastPhase = phase;
  }

  /* one poller for the whole room's numbers */
  async function pollAgg() {
    try {
      const { data, error } = await sb.rpc('get_aggregates', { p_code: SESSION_CODE });
      if (error) throw error;
      agg = data;
      if (Conn.session && Conn.session.phase === 'board') {
        const lb = await sb.rpc('get_leaderboard', { p_code: SESSION_CODE });
        if (!lb.error) board = lb.data;
      }
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
  Conn.onWinner(() => render(true));
  Conn.onReset(() => { agg = null; board = null; lastHtml = ''; pollAgg(); });
  Conn.start();
})();
