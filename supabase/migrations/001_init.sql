-- Run It Back: schema, RLS, phase-lock trigger, RPCs
create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  phase text not null default 'lobby',
  phase_started_at timestamptz not null default now(),
  phase_seconds int not null default 0,
  created_at timestamptz not null default now()
);

-- host keys live apart from sessions with zero anon policies: unreadable via the anon key
create table session_keys (
  session_id uuid primary key references sessions(id) on delete cascade,
  host_key uuid not null default gen_random_uuid()
);

create table players (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  joined_phase text not null default 'lobby',
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table choices (
  session_id uuid not null references sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  round text not null,
  payload jsonb not null,
  cash_left int not null,
  updated_at timestamptz not null default now(),
  primary key (session_id, player_id, round)
);
create index choices_session_round on choices (session_id, round);

alter table sessions enable row level security;
alter table session_keys enable row level security;
alter table players enable row level security;
alter table choices enable row level security;

create policy sessions_read on sessions for select to anon using (true);
create policy players_insert on players for insert to anon with check (true);
create policy players_read on players for select to anon using (true);
create policy players_update on players for update to anon using (true) with check (true);
create policy choices_insert on choices for insert to anon with check (true);
create policy choices_update on choices for update to anon using (true) with check (true);
create policy choices_read on choices for select to anon using (true);

-- insurance: a stale client cannot write a round that is not open.
-- 15s grace after a phase change catches the tap that lands at the buzzer.
create or replace function choices_phase_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select phase, phase_started_at into s from sessions where id = new.session_id;
  if s is null then raise exception 'unknown session'; end if;
  if new.round = s.phase then return new; end if;
  if now() - s.phase_started_at < interval '15 seconds' then return new; end if;
  raise exception 'round % is not open (phase is %)', new.round, s.phase;
end $$;
create trigger choices_phase_guard before insert or update on choices
for each row execute function choices_phase_guard();

-- the only write path for game state; key checked server-side
create or replace function advance_round(p_code text, p_key uuid, p_phase text, p_seconds int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select s.id into sid from sessions s
    join session_keys k on k.session_id = s.id
   where s.code = p_code and k.host_key = p_key;
  if sid is null then raise exception 'bad session or host key'; end if;
  if p_phase not in ('lobby','r1','r2','april','bill','verdict','cover','r4tax','r4save','r4spend','flip','recap') then
    raise exception 'unknown phase %', p_phase;
  end if;
  update sessions set phase = p_phase, phase_started_at = now(), phase_seconds = coalesce(p_seconds, 0)
   where id = sid;
  return jsonb_build_object('ok', true, 'phase', p_phase);
end $$;

-- one blob the big screen polls every 2s
create or replace function get_aggregates(p_code text)
returns jsonb language sql security definer set search_path = public stable as $$
with s as (select id from sessions where code = p_code),
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
  'r1', (select to_jsonb(r1) from r1),
  'r2', (select to_jsonb(r2) from r2),
  'cant_cover', (select count(*) from percash where cash < 30000),
  'counted', (select count(*) from percash),
  'r4', (select to_jsonb(r4) from r4)
) $$;

create or replace function server_now()
returns timestamptz language sql stable as $$ select now() $$;
