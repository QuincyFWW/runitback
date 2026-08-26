/* shared runtime: supabase client, session state, broadcast + polling, countdown.
   Broadcast is the fast path; the 5s poll is the source of truth. Either alone runs the show. */
const sb = supabase.createClient(RIB.SUPABASE_URL, RIB.SUPABASE_ANON);
const SESSION_CODE = new URLSearchParams(location.search).get('s') || RIB.DEFAULT_SESSION;

const Conn = {
  session: null, failedPolls: 0, offsetMs: 0, channel: null, listeners: [],
  onPhase(fn) { this.listeners.push(fn); },
  emit() { this.listeners.forEach(f => { try { f(this.session); } catch (e) { console.error(e); } }); },

  async syncClock() {
    try {
      const { data } = await sb.rpc('server_now');
      if (data) this.offsetMs = new Date(data).getTime() - Date.now();
    } catch (e) { /* cosmetic only */ }
  },

  async poll() {
    try {
      const { data, error } = await sb.from('sessions').select('*').eq('code', SESSION_CODE).single();
      if (error) throw error;
      this.failedPolls = 0;
      const changed = !this.session || this.session.phase !== data.phase
        || this.session.phase_started_at !== data.phase_started_at;
      this.session = data;
      this.connState(true);
      if (changed) this.emit();
    } catch (e) {
      this.failedPolls++;
      this.connState(this.failedPolls < 2);
    }
  },

  connState(ok) { if (window.onConnState) window.onConnState(ok, this.failedPolls); },

  start() {
    this.syncClock();
    this.poll();
    setInterval(() => this.poll(), 5000);
    this.channel = sb.channel('session:' + SESSION_CODE);
    this.channel.on('broadcast', { event: 'phase' }, ({ payload }) => {
      if (this.session) {
        this.session.phase = payload.phase;
        this.session.phase_started_at = payload.started_at;
        this.session.phase_seconds = payload.seconds;
      }
      this.failedPolls = 0;
      this.connState(true);
      this.emit();
    });
    this.channel.subscribe();
    /* screen lock and dead WiFi are the real gameday killers: recover hard on wake */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this.poll(); try { sb.realtime.connect(); } catch (e) {} }
    });
    window.addEventListener('online', () => this.poll());
  },

  /* seconds left in the current phase, or null when the phase has no clock */
  countdown() {
    const s = this.session;
    if (!s || !s.phase_seconds) return null;
    const end = new Date(s.phase_started_at).getTime() + s.phase_seconds * 1000;
    return Math.max(0, Math.round((end - (Date.now() + this.offsetMs)) / 1000));
  },
};
