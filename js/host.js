/* host controller: advance/jump the session phase. The key rides the URL and is
   verified server-side by advance_round; without it every button fails. */
(function () {
  const G = GAME;
  const KEY = new URLSearchParams(location.search).get('key') || '';
  const app = document.getElementById('app');
  let busy = false, msg = '';

  const idx = phase => G.PHASES.findIndex(p => p.id === phase);

  async function goTo(phaseId) {
    if (busy) return;
    busy = true; msg = 'Sending...'; render();
    const spec = G.PHASES.find(p => p.id === phaseId);
    try {
      const { error } = await sb.rpc('advance_round', {
        p_code: SESSION_CODE, p_key: KEY, p_phase: phaseId, p_seconds: spec.seconds,
      });
      if (error) throw error;
      const started = new Date().toISOString();
      /* broadcast is the fast path; every client's 5s poll is the guarantee */
      Conn.channel.send({
        type: 'broadcast', event: 'phase',
        payload: { phase: phaseId, started_at: started, seconds: spec.seconds },
      });
      if (Conn.session) {
        Conn.session.phase = phaseId;
        Conn.session.phase_started_at = started;
        Conn.session.phase_seconds = spec.seconds;
      }
      msg = '';
    } catch (e) {
      msg = 'FAILED: ' + (e.message || 'no connection') + (KEY ? '' : ' (no host key in URL)');
    }
    busy = false; render();
  }
  window.goTo = goTo;
  window.goNext = function () {
    const i = Conn.session ? idx(Conn.session.phase) : -1;
    if (i >= 0 && i < G.PHASES.length - 1) goTo(G.PHASES[i + 1].id);
  };

  let players = 0, locked = 0;
  async function pollPlayers() {
    try {
      const { data } = await sb.rpc('get_aggregates', { p_code: SESSION_CODE });
      if (data) { players = data.players || 0; locked = data.locked || 0; renderStat(); }
    } catch (e) {}
  }
  setInterval(pollPlayers, 5000);
  pollPlayers();

  function renderStat() {
    const el = document.getElementById('stat');
    if (el) el.innerHTML = '<span class="eyebrow">' + SESSION_CODE + ' · phones in · locked ' + locked + '</span><b>' + players + '</b>';
  }

  /* winner draw: random first name among players who covered the tax bill in run 1 */
  window.drawWinner = async function () {
    if (busy) return;
    busy = true; msg = 'Drawing...'; render();
    try {
      const { data, error } = await sb.rpc('draw_winner', { p_code: SESSION_CODE, p_key: KEY });
      if (error) throw error;
      if (!data || !data.name) { msg = 'No qualifiers with a name yet (' + (data ? data.qualifiers : 0) + ' covered)'; }
      else {
        msg = 'WINNER: ' + data.name + ' (' + data.qualifiers + ' covered the bill)';
        Conn.channel.send({ type: 'broadcast', event: 'winner', payload: { name: data.name } });
      }
    } catch (e) { msg = 'FAILED: ' + (e.message || 'no connection'); }
    busy = false; render();
  };

  function render() {
    const cur = Conn.session ? Conn.session.phase : '...';
    const i = idx(cur);
    const next = (i >= 0 && i < G.PHASES.length - 1) ? G.PHASES[i + 1] : null;
    app.innerHTML = '<div class="hostwrap">'
      + '<div class="hoststat" id="stat"></div>'
      + '<button class="hostnext" onclick="goNext()" ' + (next && !busy ? '' : 'disabled') + '>'
      + (next ? 'Next: ' + next.label : 'Done') + '</button>'
      + '<div class="hostmsg">' + msg + '</div>'
      + '<div class="phaselist">'
      + G.PHASES.map(p => '<button class="phasebtn' + (p.id === cur ? ' current' : '') + '" onclick="goTo(\'' + p.id + '\')">'
        + '<span>' + p.label + '</span><span class="tag">' + (p.id === cur ? 'LIVE' : (p.seconds ? p.seconds + 's' : '')) + '</span></button>').join('')
      + '</div>'
      + '<button class="phasebtn" style="margin-top:14px" onclick="drawWinner()" ' + (busy ? 'disabled' : '') + '>'
      + '<span>Draw a winner (covered the bill)</span><span class="tag">PRIZE</span></button>'
      + '</div>';
    renderStat();
  }

  window.onConnState = function () {};
  Conn.onPhase(render);
  Conn.start();
  render();
})();
