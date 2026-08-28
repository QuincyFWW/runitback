/* player state machine: renders the phase the server says, writes choices debounced */
(function () {
  const G = GAME, fmt = G.fmt;
  const app = document.getElementById('app');
  const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

  /* ---- identity + local state (refresh = full recovery) ---- */
  const pid = localStorage.getItem('rib_pid') || crypto.randomUUID();
  localStorage.setItem('rib_pid', pid);
  /* v2: menu prices changed 8/28; versioning orphans any stale pre-change state */
  const stateKey = 'rib_state_v2_' + SESSION_CODE;
  let S;
  try { S = JSON.parse(localStorage.getItem(stateKey)) || null; } catch (e) { S = null; }
  if (!S) S = { run1: G.emptyRun(), run2: G.emptyRun(), cover: {}, joinedPhase: null };
  S.locked = S.locked || {};
  S.name = S.name || '';
  const persist = () => { try { localStorage.setItem(stateKey, JSON.stringify(S)); } catch (e) {} };

  let registered = false;
  async function register() {
    if (!Conn.session) return;
    if (registered && !register.nameDirty) return;
    if (!S.joinedPhase) { S.joinedPhase = Conn.session.phase; persist(); }
    const { error } = await sb.from('players').upsert({
      id: pid, session_id: Conn.session.id, joined_phase: S.joinedPhase,
      first_name: S.name || null,
      last_seen: new Date().toISOString(),
    });
    if (!error) { registered = true; register.nameDirty = false; }
  }

  /* first name is the only thing we ask for: it's how the winner gets called out */
  window.saveName = function () {
    const el = document.getElementById('fname');
    if (!el) return;
    S.name = el.value.trim().slice(0, 20);
    persist();
    register.nameDirty = true;
    register();
    render();
  };

  /* ---- debounced choice writes (max ~1/sec) ---- */
  let writeTimer = null, writing = false, dirty = false;
  function scheduleWrite() {
    dirty = true;
    if (writeTimer) return;
    writeTimer = setTimeout(doWrite, 900);
  }
  async function doWrite() {
    writeTimer = null;
    if (!dirty || writing || !registered || !Conn.session) { if (dirty) writeTimer = setTimeout(doWrite, 900); return; }
    const phase = Conn.session.phase;
    if (!G.WRITE_PHASES.includes(phase)) { dirty = false; return; }
    dirty = false; writing = true;
    const row = { session_id: Conn.session.id, player_id: pid, round: phase, updated_at: new Date().toISOString() };
    const lk = !!S.locked[phase];
    if (phase === 'contract') { row.payload = { signed: lk, locked: lk }; row.cash_left = G.START; }
    if (phase === 'r1') { row.payload = { ...S.run1.spend, locked: lk }; row.cash_left = G.cash1(S.run1); }
    if (phase === 'r2') { row.payload = { ...S.run1.save, locked: lk }; row.cash_left = G.cash1(S.run1); }
    if (phase === 'cover') { row.payload = { sources: S.cover, locked: lk }; row.cash_left = G.cash1(S.run1); }
    if (phase === 'r4save') { row.payload = { ...S.run2.save, locked: lk }; row.cash_left = G.cash2(S.run2); }
    if (phase === 'r4spend') { row.payload = { ...S.run2.spend, locked: lk }; row.cash_left = G.cash2(S.run2); }
    try { await sb.from('choices').upsert(row); } catch (e) { dirty = true; }
    writing = false;
    if (dirty) writeTimer = setTimeout(doWrite, 900);
  }

  /* ---- interactions (exposed for inline handlers) ---- */
  window.pick1 = (k, v) => { S.run1.spend[k] = S.run1.spend[k] === v ? 0 : v; persist(); scheduleWrite(); render(); };
  window.pick2 = (k, v) => { S.run1.save[k] = S.run1.save[k] === v ? 0 : v; persist(); scheduleWrite(); render(); };
  window.pickCover = (k) => { S.cover[k] = !S.cover[k]; persist(); scheduleWrite(); render(); };
  window.pick4s = (k, v) => { S.run2.save[k] = S.run2.save[k] === v ? 0 : v; persist(); scheduleWrite(); render(); };
  window.pick4 = (k, v) => { S.run2.spend[k] = S.run2.spend[k] === v ? 0 : v; persist(); scheduleWrite(); render(); };
  /* locking is final: no unlock, the round is done for you */
  window.lockIn = () => {
    if (!Conn.session || S.locked[Conn.session.phase]) return;
    S.locked[Conn.session.phase] = true;
    persist(); scheduleWrite(); render();
  };
  const isLocked = phase => !!S.locked[phase];
  const lockBtn = phase => isLocked(phase)
    ? '<div class="lockedmsg">Locked in. Eyes up front.</div>'
    : '<button class="lockbtn" onclick="lockIn()">LOCK IN MY ANSWERS</button>';

  /* ---- render ---- */
  function head() {
    const t = Conn.countdownText();
    return '<div class="p-head"><div class="mark">FWW</div>'
      + (t !== null ? '<span class="p-timer">' + t + '</span>' : '')
      + '<div class="pill" id="pill"><span class="dot"></span><span id="pilltext">Connected</span></div></div>';
  }
  const cashbar = (label, val) => '<div class="cashbar"><span class="eyebrow">' + label + '</span>'
    + '<span class="cash ' + (val < G.TAX ? 'low' : '') + '">' + fmt(val) + '</span></div>';
  const lateBadge = () => (S.joinedPhase && S.joinedPhase !== 'lobby')
    ? '<div class="badge">Joined mid-game. You start with the full $100,000.</div>' : '';

  function body(phase) {
    if (phase === 'lobby') return '<div class="p-body center">'
      + '<div class="eyebrow">Final Whistle Wealth presents</div>'
      + '<div class="p-hero">You just signed<br>a 1-year NIL deal:<br><span class="hl">$100,000.</span></div>'
      + '<p class="p-sub">Figure out what happens to it.</p>'
      + (S.name
        ? '<p class="p-sub">You\'re in, <b>' + esc(S.name) + '</b>. The game starts up front.</p>'
        : '<div class="namebox"><label class="eyebrow" for="fname">First name</label>'
          + '<input id="fname" maxlength="20" autocomplete="given-name" placeholder="First name only">'
          + '<button class="lockbtn" onclick="saveName()">I\'M IN</button></div>')
      + '<p class="fineprint">Fictional money, real you. First name only, nothing else about you is collected.</p></div>';

    if (phase === 'contract') {
      const signed = isLocked('contract');
      return '<div class="p-body">'
        + '<div class="eyebrow">Before the money moves: read it</div>'
        + '<div class="paper">'
        + G.CONTRACT.map(([h, b], i) => (i === 0
          ? '<div class="paper-title">' + h + '</div><p>' + b + '</p>'
          : '<h5>' + h + '</h5><p>' + b + '</p>')).join('')
        + '<div class="sigblock">'
        + '<div class="sigline">' + (S.name ? esc(S.name) : 'Athlete') + '</div>'
        + '<div class="siglabel">Athlete signature</div>'
        + (signed
          ? '<div class="signed">SIGNED ✓</div>'
          : '<button class="signbtn" onclick="lockIn()">TAP TO SIGN</button>')
        + '</div></div>'
        + '<p class="fineprint">Fictional contract for an education game, not a real agreement. Always have a qualified professional read a real one before you sign.</p></div>';
    }

    if (phase === 'r1') return '<div class="p-body">' + lateBadge()
      + '<div class="eyebrow">Spend it how you actually would</div>'
      + G.MENU.map(c => '<div class="cat"><h3>' + c.label + '</h3><div class="opts">'
        + c.opts.map(([t, v, d]) => '<button class="opt" aria-pressed="' + (S.run1.spend[c.key] === v) + '"'
          + (isLocked('r1') ? ' disabled' : '')
          + ' onclick="pick1(\'' + c.key + '\',' + v + ')"><span>' + t + '</span><span class="price">' + (d || fmt(v)) + '</span></button>').join('')
        + '</div></div>').join('') + lockBtn('r1') + '</div>';

    if (phase === 'r2') return '<div class="p-body">' + cashbar('You have left', G.cash1(S.run1))
      + '<div class="eyebrow">What about future you?</div>'
      + G.VEHICLES.map(v => '<div class="veh"><h4>' + v.label + '</h4><div class="chips">'
        + v.chips.map(val => '<button class="chip" aria-pressed="' + (S.run1.save[v.key] === val) + '"'
          + (isLocked('r2') || (val > 0 && val > G.cash1(S.run1) + S.run1.save[v.key]) ? ' disabled' : '')
          + ' onclick="pick2(\'' + v.key + '\',' + val + ')">' + fmt(val) + '</button>').join('')
        + '</div></div>').join('') + lockBtn('r2') + '</div>';

    if (phase === 'april') return '<div class="p-body center">'
      + '<div class="p-hero pulse">April<br>arrives.</div>'
      + '<p class="p-sub">You owe taxes on every NIL dollar from last year.</p></div>';

    if (phase === 'bill') return '<div class="p-body center">'
      + '<div class="eyebrow">For this game</div><div class="bignum">$30,000</div>'
      + '<p class="p-sub">Nobody withheld anything from that check.</p>'
      + '<p class="fineprint">' + G.DISCLAIMER + '</p></div>';

    if (phase === 'verdict') {
      const c = G.cash1(S.run1), short = G.shortfall(S.run1);
      return '<div class="p-body center">'
        + '<div class="eyebrow">Your year</div>'
        + '<div style="width:100%;max-width:300px;text-align:left;margin:0 auto">'
        + '<div class="taxline"><span>NIL income</span><span>' + fmt(G.START) + '</span></div>'
        + '<div class="taxline"><span class="neg">Spent</span><span>-' + fmt(G.spent(S.run1)) + '</span></div>'
        + '<div class="taxline"><span class="neg">Put away</span><span>-' + fmt(G.saved(S.run1)) + '</span></div>'
        + '<div class="taxline total"><span>Cash on hand</span><span>' + fmt(c) + '</span></div>'
        + '<div class="taxline total"><span>Tax bill</span><span>-' + fmt(G.TAX) + '</span></div></div>'
        + (short > 0
          ? '<div class="p-hero">You\'re<br><span class="hl bad">' + fmt(short) + '</span><br>short.</div>'
          : '<div class="p-hero">You can<br><span class="hl">cover it.</span></div>'
            + '<p class="p-sub">' + fmt(c - G.TAX) + ' left after the bill. Most of the room can\'t say that.</p>')
        + '</div>';
    }

    if (phase === 'cover') {
      const short = G.shortfall(S.run1);
      if (short === 0) return '<div class="p-body center">'
        + '<div class="p-hero">You\'re<br><span class="hl">covered.</span></div>'
        + '<p class="p-sub">You kept enough cash to pay the bill. Watch the room figure it out.</p>'
        + lockBtn('cover') + '</div>';
      const still = G.coverStillShort(S.run1, S.cover);
      const clk = isLocked('cover') ? ' disabled' : '';
      return '<div class="p-body">'
        + '<div class="cashbar"><span class="eyebrow">' + (still > 0 ? 'Still short' : 'Bill covered') + '</span>'
        + '<span class="cash ' + (still > 0 ? 'low' : '') + '">' + (still > 0 ? fmt(still) : '✓') + '</span></div>'
        + '<div class="p-hero" style="font-size:1.9rem">Where does the ' + fmt(short) + ' come from?</div>'
        + '<div class="opts">'
        + G.coverSources(S.run1).map(([k, t, v]) => '<button class="opt" aria-pressed="' + !!S.cover[k] + '"' + clk
          + ' onclick="pickCover(\'' + k + '\')"><span>' + t + '</span><span class="price">' + fmt(v) + '</span></button>').join('')
        + Object.keys(G.SUNK).map(k => S.run1.spend[k]
          ? '<button class="opt" disabled><span>' + G.SUNK[k] + '</span><span class="price">$0</span></button>' : '').join('')
        + '<button class="opt" aria-pressed="' + !!S.cover.borrow + '"' + clk + ' onclick="pickCover(\'borrow\')"><span>Credit card or borrow the rest</span></button>'
        /* the family number stays a mystery until they actually ask */
        + '<button class="opt" aria-pressed="' + !!S.cover.family + '"' + clk + ' onclick="pickCover(\'family\')"><span>Ask family</span>'
        + (S.cover.family ? '<span class="price">' + fmt(G.FAMILY_HELP) + '</span>' : '') + '</button>'
        + '</div>' + lockBtn('cover')
        + '<p class="fineprint" style="margin:0">Notice the prices. Nothing sells back for what you paid.</p></div>';
    }

    if (phase === 'r4tax') return '<div class="p-body center">'
      + '<div class="eyebrow">Same $100,000. New order.</div>'
      + '<div class="p-hero">Taxes<br>come off<br><span class="hl">first.</span></div>'
      + '<div><div class="eyebrow">Set aside</div><div class="bignum" style="color:var(--mist)">-$30,000</div></div>'
      + '<div><div class="eyebrow">Yours to work with</div><div class="bignum">$70,000</div></div>'
      + '<p class="fineprint">' + G.DISCLAIMER + '</p></div>';

    if (phase === 'r4save') return '<div class="p-body">'
      + cashbar('You have left', G.START - G.TAX - G.saved(S.run2) - G.spent(S.run2))
      + '<div class="eyebrow">Future you goes second this time</div>'
      + G.VEHICLES.map(v => '<div class="veh"><h4>' + v.label + '</h4><div class="chips">'
        + v.chips.map(val => '<button class="chip" aria-pressed="' + (S.run2.save[v.key] === val) + '"'
          + (isLocked('r4save') || (val > 0 && val > G.START - G.TAX - G.saved(S.run2) - G.spent(S.run2) + S.run2.save[v.key]) ? ' disabled' : '')
          + ' onclick="pick4s(\'' + v.key + '\',' + val + ')">' + fmt(val) + '</button>').join('')
        + '</div></div>').join('') + lockBtn('r4save') + '</div>';

    if (phase === 'r4spend') return '<div class="p-body">' + cashbar('You have left', G.cash2(S.run2))
      + '<div class="eyebrow">Now do whatever you want with it</div>'
      + G.MENU.map(c => '<div class="cat"><h3>' + c.label + '</h3><div class="opts">'
        + c.opts.map(([t, v, d]) => '<button class="opt" aria-pressed="' + (S.run2.spend[c.key] === v) + '"'
          + (isLocked('r4spend') || (v > 0 && v > G.cash2(S.run2) + S.run2.spend[c.key]) ? ' disabled' : '')
          + ' onclick="pick4(\'' + c.key + '\',' + v + ')"><span>' + t + '</span><span class="price">' + (d || fmt(v)) + '</span></button>').join('')
        + '</div></div>').join('') + lockBtn('r4spend') + '</div>';

    if (phase === 'recap') {
      const short = G.shortfall(S.run1), nw1 = G.netWorth1(S.run1), nw2 = G.netWorth2(S.run2);
      return '<div class="p-body">'
        + '<div class="p-hero" style="font-size:1.9rem">Your score:<br>net worth</div>'
        + '<p class="p-sub" style="text-align:left;max-width:none;margin:0">What your stuff is worth today, plus everything you put away, minus what you owe.</p>'
        + '<div class="recap">'
        + '<div class="runcard"><h4>Run 1</h4>'
        + '<div class="row"><span>Your stuff, today</span><span>' + fmt(G.assets(S.run1)) + '</span></div>'
        + '<div class="row"><span>Put away, grown</span><span>' + fmt(G.grownSaved(S.run1)) + '</span></div>'
        + '<div class="row"><span>Cash after taxes</span><span>' + fmt(G.cash1(S.run1) - G.TAX) + '</span></div>'
        + '<div class="stamp ' + (nw1 < nw2 ? 'bad' : 'good') + '" style="font-size:1.15rem">' + fmt(nw1) + '</div>'
        + '<div class="row"><span>April</span><span>' + (short > 0 ? fmt(short) + ' short' : 'Covered') + '</span></div></div>'
        + '<div class="runcard win"><h4>Run 2</h4>'
        + '<div class="row"><span>Your stuff, today</span><span>' + fmt(G.assets(S.run2)) + '</span></div>'
        + '<div class="row"><span>Put away, grown</span><span>' + fmt(G.grownSaved(S.run2)) + '</span></div>'
        + '<div class="row"><span>Cash, taxes paid</span><span>' + fmt(G.cash2(S.run2)) + '</span></div>'
        + '<div class="stamp good" style="font-size:1.15rem">' + fmt(nw2) + '</div>'
        + '<div class="row"><span>April</span><span>Already handled</span></div></div></div>'
        + '<div style="text-align:center;padding-top:6px">'
        + '<div class="eyebrow" style="margin-bottom:8px">The whole lesson</div>'
        + '<div class="p-hero" style="font-size:1.6rem">Spending isn\'t the problem.</div>'
        + '<p class="p-sub" style="margin-top:8px">Spending money you haven\'t accounted for is.</p></div>'
        + '<p class="fineprint" style="text-align:center">Growth uses long-run average rates (savings 4%, market 10%). Averages, not guarantees. Education, not financial advice. First name only, nothing else about you is collected.</p></div>';
    }

    if (phase === 'board') return '<div class="p-body center">'
      + '<div class="p-hero">Look<br><span class="hl">up.</span></div>'
      + '<div><div class="eyebrow">Your round 1 net worth</div>'
      + '<div class="bignum">' + fmt(G.netWorth1(S.run1)) + '</div></div></div>';

    return '<div class="p-body center"><p class="p-sub">One second...</p></div>';
  }

  function render() {
    if (!Conn.session) return;
    const phase = Conn.session.phase;
    app.classList.toggle('dark', phase === 'april' || phase === 'bill');
    app.innerHTML = head() + body(phase);
  }

  /* connection pill + loud full-screen failure */
  window.onConnState = function (ok, fails) {
    const pill = document.getElementById('pill'), txt = document.getElementById('pilltext');
    if (pill) { pill.classList.toggle('off', !ok); if (txt) txt.textContent = ok ? 'Connected' : 'Reconnecting'; }
    let lost = document.getElementById('lost');
    if (!ok && fails >= 2) {
      if (!lost) {
        lost = document.createElement('div');
        lost.id = 'lost'; lost.className = 'lostwrap';
        lost.innerHTML = '<div class="p-hero">Connection<br>lost.</div>'
          + '<p class="p-sub pulse">Reconnecting. Look up at the big screen.</p>';
        document.body.appendChild(lost);
      }
    } else if (lost) lost.remove();
  };

  /* countdown repaint without re-rendering inputs */
  setInterval(() => {
    const t = Conn.countdownText();
    const el = document.querySelector('.p-timer');
    if (el && t !== null) el.textContent = t;
  }, 1000);

  /* host reset: the whole account goes, id, name and every answer. Fresh person, fresh game. */
  function wipeAccount() {
    try { localStorage.removeItem(stateKey); localStorage.removeItem('rib_pid'); } catch (e) {}
    location.reload();
  }
  Conn.onReset(() => {
    try { localStorage.setItem(epochKey, ''); } catch (e) {}
    wipeAccount();
  });

  /* epoch check catches phones that slept through the reset broadcast:
     the session's reset counter moved on without us, so forget everything */
  const epochKey = 'rib_epoch_' + SESSION_CODE;
  function staleAfterReset() {
    const e = Conn.session ? Conn.session.reset_epoch : undefined;
    if (e === undefined || e === null) return false;
    let seen = null;
    try { seen = localStorage.getItem(epochKey); } catch (err) {}
    if (seen === null || seen === '') {
      try { localStorage.setItem(epochKey, String(e)); } catch (err) {}
      return false;
    }
    if (seen !== String(e)) {
      try { localStorage.setItem(epochKey, String(e)); } catch (err) {}
      wipeAccount();
      return true;
    }
    return false;
  }

  Conn.onPhase(() => {
    if (staleAfterReset()) return;
    register().then(doWrite); render();
  });
  Conn.start();
})();
