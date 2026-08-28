-- 002: first names (prize draw), lock-in counts, winner RPC (meeting edits 2026-08-28)
alter table players add column if not exists first_name text;

-- aggregates gains: locked = players locked in for the CURRENT phase
create or replace function get_aggregates(p_code text)
returns jsonb language sql security definer set search_path = public stable as $$
with s as (select id, phase from sessions where code = p_code),
r1 as (
  select count(*) n,
         round(avg((payload->>'car')::numeric)) car,
         round(avg((payload->>'shopping')::numeric)) shopping,
         round(avg((payload->>'housing')::numeric)) housing,
         round(avg((payload->>'vacation')::numeric)) vacation,
         round(avg(100000 - cash_left)) total
    from choices c, s where c.session_id = s.id and c.round = 'r1'),
r2 as (
  select count(*) n,
         round(avg((payload->>'hysa')::numeric)) hysa,
         round(avg((payload->>'sp500')::numeric)) sp500,
         round(avg((payload->>'roth')::numeric)) roth,
         count(*) filter (where coalesce((payload->>'hysa')::int,0)
                              + coalesce((payload->>'sp500')::int,0)
                              + coalesce((payload->>'roth')::int,0) = 0) zero
    from choices c, s where c.session_id = s.id and c.round = 'r2'),
percash as (
  select p.id, coalesce(c2.cash_left, c1.cash_left, 100000) cash
    from players p
    left join choices c1 on c1.player_id = p.id and c1.round = 'r1'
    left join choices c2 on c2.player_id = p.id and c2.round = 'r2'
   where p.session_id = (select id from s)),
r4 as (
  select count(*) n, round(avg(cash_left)) cash
    from choices c, s where c.session_id = s.id and c.round = 'r4spend')
select jsonb_build_object(
  'players', (select count(*) from players p, s where p.session_id = s.id),
  'locked', (select count(*) from choices c, s
              where c.session_id = s.id and c.round = s.phase
                and (c.payload->>'locked') = 'true'),
  'r1', (select to_jsonb(r1) from r1),
  'r2', (select to_jsonb(r2) from r2),
  'cant_cover', (select count(*) from percash where cash < 30000),
  'counted', (select count(*) from percash),
  'r4', (select to_jsonb(r4) from r4)
) $$;

-- prize draw: random named player whose run-1 cash could cover the $30K bill.
-- key-gated like advance_round; call it as many times as there are prizes.
create or replace function draw_winner(p_code text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid; qn int; pick text;
begin
  select s.id into sid from sessions s
    join session_keys k on k.session_id = s.id
   where s.code = p_code and k.host_key = p_key;
  if sid is null then raise exception 'bad session or host key'; end if;
  select count(*) into qn from players p
    join choices c on c.player_id = p.id and c.session_id = sid and c.round = 'r2'
   where p.session_id = sid and c.cash_left >= 30000;
  select p.first_name into pick from players p
    join choices c on c.player_id = p.id and c.session_id = sid and c.round = 'r2'
   where p.session_id = sid and c.cash_left >= 30000
     and coalesce(trim(p.first_name), '') <> ''
   order by random() limit 1;
  return jsonb_build_object('name', pick, 'qualifiers', qn);
end $$;
