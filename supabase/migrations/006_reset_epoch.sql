-- 006: reset generation counter so EVERY phone forgets everything after a wipe,
-- including phones asleep or offline when the button was pressed. Clients compare
-- the epoch they last saw with the session's; a mismatch wipes local storage.
alter table sessions add column if not exists reset_epoch int not null default 0;

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
  update sessions set phase = 'lobby', phase_started_at = now(), phase_seconds = 0,
         reset_epoch = reset_epoch + 1
   where id = sid;
  return jsonb_build_object('ok', true, 'players_wiped', np, 'choices_wiped', nc);
end $$;
