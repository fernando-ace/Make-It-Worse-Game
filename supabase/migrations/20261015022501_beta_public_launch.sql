-- Public beta telemetry and feedback contain no player identifiers or game answers.
create table cr_private.beta_events (
  event_id bigint generated always as identity primary key,
  event_name text not null check (event_name in (
    'landing_viewed', 'room_created', 'room_joined', 'lobby_reached',
    'session_started', 'chaos_intensity_selected', 'game_started',
    'game_completed', 'session_round_reached', 'house_rule_selected',
    'power_used', 'objective_completed', 'objective_revealed',
    'reconnect_attempted', 'reconnect_succeeded', 'reconnect_failed',
    'player_left', 'finale_reached', 'session_completed', 'replay_started',
    'feedback_opened', 'feedback_submitted', 'runtime_error'
  )),
  occurred_at timestamptz not null default clock_timestamp(),
  room_id uuid,
  session_key text check (session_key is null or session_key ~ '^[0-9a-f]{64}$'),
  game_id text check (game_id is null or length(game_id) <= 80),
  game_number smallint check (game_number is null or game_number between 1 and 6),
  player_count smallint check (player_count is null or player_count between 1 and 8),
  chaos_intensity text check (chaos_intensity is null or chaos_intensity in ('standard', 'high')),
  house_rule_id text check (house_rule_id is null or length(house_rule_id) <= 48),
  power_id text check (power_id is null or length(power_id) <= 48),
  error_code text check (error_code is null or error_code in ('auth', 'network', 'server', 'unknown'))
);

create index beta_events_occurred_at_idx on cr_private.beta_events (occurred_at);
create index beta_events_name_occurred_at_idx on cr_private.beta_events (event_name, occurred_at);
alter table cr_private.beta_events enable row level security;
revoke all on cr_private.beta_events from public, anon, authenticated;
grant all on cr_private.beta_events to service_role;
grant usage, select on sequence cr_private.beta_events_event_id_seq to service_role;

create table cr_private.beta_feedback (
  feedback_id bigint generated always as identity primary key,
  created_at timestamptz not null default clock_timestamp(),
  room_id uuid not null,
  session_key text not null check (session_key ~ '^[0-9a-f]{64}$'),
  respondent_key text not null check (respondent_key ~ '^[0-9a-f]{64}$'),
  fun_rating smallint not null check (fun_rating between 1 and 5),
  play_again boolean not null,
  favorite_game text check (favorite_game is null or length(favorite_game) <= 80),
  least_favorite_game text check (least_favorite_game is null or length(least_favorite_game) <= 80),
  confusion text check (confusion is null or length(confusion) <= 500),
  comment text check (comment is null or length(comment) <= 1200),
  unique (session_key, respondent_key)
);

alter table cr_private.beta_feedback enable row level security;
revoke all on cr_private.beta_feedback from public, anon, authenticated;
grant all on cr_private.beta_feedback to service_role;
grant usage, select on sequence cr_private.beta_feedback_feedback_id_seq to service_role;

create or replace function public.cr_record_beta_events(p_events jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 30 then
    raise exception 'Invalid beta event batch';
  end if;

  insert into cr_private.beta_events (
    event_name, room_id, session_key, game_id, game_number, player_count,
    chaos_intensity, house_rule_id, power_id, error_code
  )
  select
    e->>'name',
    nullif(e->>'room_id', '')::uuid,
    nullif(e->>'session_key', ''),
    nullif(e->>'game_id', ''),
    nullif(e->>'game_number', '')::smallint,
    nullif(e->>'player_count', '')::smallint,
    nullif(e->>'chaos_intensity', ''),
    nullif(e->>'house_rule_id', ''),
    nullif(e->>'power_id', ''),
    nullif(e->>'error_code', '')
  from jsonb_array_elements(p_events) as batch(e);

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.cr_submit_beta_feedback(
  p_room_id uuid,
  p_session_key text,
  p_respondent_key text,
  p_fun_rating smallint,
  p_play_again boolean,
  p_favorite_game text,
  p_least_favorite_game text,
  p_confusion text,
  p_comment text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into cr_private.beta_feedback (
    room_id, session_key, respondent_key, fun_rating, play_again,
    favorite_game, least_favorite_game, confusion, comment
  ) values (
    p_room_id, p_session_key, p_respondent_key, p_fun_rating, p_play_again,
    nullif(p_favorite_game, ''), nullif(p_least_favorite_game, ''),
    nullif(p_confusion, ''), nullif(p_comment, '')
  ) on conflict (session_key, respondent_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

create or replace function public.cr_cleanup_expired_data()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rooms integer;
  v_events integer;
  v_feedback integer;
begin
  delete from public.cr_rooms where changed_at < now() - interval '14 days';
  get diagnostics v_rooms = row_count;

  delete from cr_private.beta_events where occurred_at < now() - interval '180 days';
  get diagnostics v_events = row_count;

  delete from cr_private.beta_feedback where created_at < now() - interval '365 days';
  get diagnostics v_feedback = row_count;

  return jsonb_build_object('rooms', v_rooms, 'events', v_events, 'feedback', v_feedback);
end;
$$;

revoke all on function public.cr_record_beta_events(jsonb) from public, anon, authenticated;
revoke all on function public.cr_submit_beta_feedback(uuid, text, text, smallint, boolean, text, text, text, text) from public, anon, authenticated;
revoke all on function public.cr_cleanup_expired_data() from public, anon, authenticated;
grant execute on function public.cr_record_beta_events(jsonb) to service_role;
grant execute on function public.cr_submit_beta_feedback(uuid, text, text, smallint, boolean, text, text, text, text) to service_role;
grant execute on function public.cr_cleanup_expired_data() to service_role;
