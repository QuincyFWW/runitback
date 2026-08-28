-- 003: leaderboard phase + RPC; drop 'flip' from the accepted phases so even a
-- stale cached host page cannot set it (8/28 final changes)
create or replace function advance_round(p_code text, p_key uuid, p_phase text, p_seconds int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select s.id into sid from sessions s
    join session_keys k on k.session_id = s.id
   where s.code = p_code and k.host_key = p_key;
  if sid is null then raise exception 'bad session or host key'; end if;
  if p_phase not in ('lobby','r1','r2','april','bill','verdict','cover','r4tax','r4save','r4spend','recap','board') then
    raise exception 'unknown phase %', p_phase;
  end if;
  update sessions set phase = p_phase, phase_started_at = now(), phase_seconds = coalesce(p_seconds, 0)
   where id = sid;
  return jsonb_build_object('ok', true, 'phase', p_phase);
end $$;

-- top 10 by run-2 net worth. Mirrors js/game.js exactly:
-- assets = car*0.6 + shopping*0.3 (rent and trips are sunk),
-- saved grows a year at hysa 4% / sp500 10% / roth 10%,
-- cash = denormalized cash_left from r4spend (fallback: 70000 - principal saved).
-- Only players who actually played run 2 appear.
create or replace function get_leaderboard(p_code text)
returns jsonb language sql security definer set search_path = public stable as $$
with s as (select id from sessions where code = p_code),
l as (
  select coalesce(nullif(trim(p.first_name), ''), 'Player') as name,
         round(coalesce((sp.payload->>'car')::numeric, 0) * 0.6
             + coalesce((sp.payload->>'shopping')::numeric, 0) * 0.3)::int
       + round(coalesce((sv.payload->>'hysa')::numeric, 0) * 1.04)::int
       + round(coalesce((sv.payload->>'sp500')::numeric, 0) * 1.10)::int
       + round(coalesce((sv.payload->>'roth')::numeric, 0) * 1.10)::int
       + coalesce(sp.cash_left,
           70000 - (coalesce((sv.payload->>'hysa')::int, 0)
                  + coalesce((sv.payload->>'sp500')::int, 0)
                  + coalesce((sv.payload->>'roth')::int, 0))) as nw
    from players p
    left join choices sv on sv.player_id = p.id and sv.session_id = p.session_id and sv.round = 'r4save'
    left join choices sp on sp.player_id = p.id and sp.session_id = p.session_id and sp.round = 'r4spend'
   where p.session_id = (select id from s)
     and (sv.player_id is not null or sp.player_id is not null)
   order by nw desc limit 10)
select coalesce(jsonb_agg(jsonb_build_object('name', name, 'nw', nw)), '[]'::jsonb) from l $$;
