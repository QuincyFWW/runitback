-- 004: one-tap game reset from the host controller (key-gated like advance_round)
create or replace function reset_session(p_code text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid uuid; np int; nc int;
begin
  select s.id into sid from sessions s
    join session_keys k on k.session_id = s.id
   where s.code = p_code and k.host_key = p_key;
  if sid is null then raise exception 'bad session or host key'; end if;
  delete from choices where session_id = sid;
  get diagnostics nc = row_count;
  delete from players where session_id = sid;
  get diagnostics np = row_count;
  update sessions set phase = 'lobby', phase_started_at = now(), phase_seconds = 0 where id = sid;
  return jsonb_build_object('ok', true, 'players_wiped', np, 'choices_wiped', nc);
end $$;
