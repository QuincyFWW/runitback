-- 005: contract phase in the accepted list; leaderboard reranked on ROUND 1
-- net worth (Quincy 8/28: score the instinct run, tax bill and all)
create or replace function advance_round(p_code text, p_key uuid, p_phase text, p_seconds int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select s.id into sid from sessions s
    join session_keys k on k.session_id = s.id
   where s.code = p_code and k.host_key = p_key;
  if sid is null then raise exception 'bad session or host key'; end if;
  if p_phase not in ('lobby','contract','r1','r2','april','bill','verdict','cover','r4tax','r4save','r4spend','recap','board') then
    raise exception 'unknown phase %', p_phase;
  end if;
  update sessions set phase = p_phase, phase_started_at = now(), phase_seconds = coalesce(p_seconds, 0)
   where id = sid;
  return jsonb_build_object('ok', true, 'phase', p_phase);
end $$;

-- top 10 by ROUND 1 net worth. Mirrors js/game.js netWorth1:
-- assets (car*0.6 + shopping*0.3; rent and trips sunk)
-- + saved grown a year (hysa 4%, sp500 10%, roth 10%)
-- + cash on hand (r2 cash_left = 100k - spent - saved; r1 row fallback)
-- - the $30,000 tax bill.
-- Only players who played round 1 appear.
create or replace function get_leaderboard(p_code text)
returns jsonb language sql security definer set search_path = public stable as $$
with s as (select id from sessions where code = p_code),
l as (
  select coalesce(nullif(trim(p.first_name), ''), 'Player') as name,
         round(coalesce((c1.payload->>'car')::numeric, 0) * 0.6
             + coalesce((c1.payload->>'shopping')::numeric, 0) * 0.3)::int
       + round(coalesce((c2.payload->>'hysa')::numeric, 0) * 1.04)::int
       + round(coalesce((c2.payload->>'sp500')::numeric, 0) * 1.10)::int
       + round(coalesce((c2.payload->>'roth')::numeric, 0) * 1.10)::int
       + coalesce(c2.cash_left, c1.cash_left)
       - 30000 as nw
    from players p
    join choices c1 on c1.player_id = p.id and c1.session_id = p.session_id and c1.round = 'r1'
    left join choices c2 on c2.player_id = p.id and c2.session_id = p.session_id and c2.round = 'r2'
   where p.session_id = (select id from s)
   order by nw desc limit 10)
select coalesce(jsonb_agg(jsonb_build_object('name', name, 'nw', nw)), '[]'::jsonb) from l $$;
