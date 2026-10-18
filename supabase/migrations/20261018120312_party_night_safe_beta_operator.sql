-- Store only server-derived numeric/session metadata. Private choices, role
-- hints, objective text, player ids, and names are intentionally excluded.
create table cr_private.party_metrics (
  metric_id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  room_id uuid not null,
  session_key text not null check (session_key ~ '^[0-9a-f]{64}$'),
  version smallint not null check (version = 2),
  player_count smallint not null check (player_count between 1 and 8),
  game_number smallint not null check (game_number between 1 and 6),
  game_id text not null check (length(game_id) <= 80),
  completed smallint not null default 0 check (completed in (0, 1)),
  beat_transition smallint not null default 0 check (beat_transition in (0, 1)),
  decision_ms bigint not null default 0 check (decision_ms >= 0),
  game_duration_ms bigint not null default 0 check (game_duration_ms >= 0),
  first_beat_duration_ms bigint not null default 0 check (first_beat_duration_ms >= 0),
  second_beat_duration_ms bigint not null default 0 check (second_beat_duration_ms >= 0),
  missing_actions smallint not null default 0 check (missing_actions between 0 and 8),
  power_used smallint not null default 0 check (power_used in (0, 1)),
  power_id text check (power_id is null or length(power_id) <= 48),
  chaos_spent integer not null default 0 check (chaos_spent >= 0),
  chaos_earned integer not null default 0 check (chaos_earned >= 0),
  power_successes smallint not null default 0 check (power_successes >= 0),
  power_misses smallint not null default 0 check (power_misses >= 0),
  active_rules smallint not null default 0 check (active_rules >= 0),
  rule_selected smallint not null default 0 check (rule_selected in (0, 1)),
  selected_rule_id text check (selected_rule_id is null or length(selected_rule_id) <= 48),
  replay_started smallint not null default 0 check (replay_started in (0, 1)),
  rule_scoring_applications smallint not null default 0 check (rule_scoring_applications >= 0),
  promises_kept smallint not null default 0 check (promises_kept >= 0),
  promises_broken smallint not null default 0 check (promises_broken >= 0),
  objectives_completed smallint not null default 0 check (objectives_completed >= 0),
  score_spread integer not null default 0 check (score_spread >= 0),
  negative_contributions smallint not null default 0 check (negative_contributions >= 0),
  lead_changed smallint not null default 0 check (lead_changed in (0, 1)),
  promise_events smallint not null default 0 check (promise_events >= 0),
  gamble_events smallint not null default 0 check (gamble_events >= 0),
  target_events smallint not null default 0 check (target_events >= 0),
  alliance_events smallint not null default 0 check (alliance_events >= 0),
  betrayal_events smallint not null default 0 check (betrayal_events >= 0),
  contribution_events smallint not null default 0 check (contribution_events >= 0),
  read_events smallint not null default 0 check (read_events >= 0),
  protection_events smallint not null default 0 check (protection_events >= 0),
  session_duration_ms bigint not null default 0 check (session_duration_ms >= 0),
  session_completed smallint not null default 0 check (session_completed in (0, 1))
);
create index party_metrics_session_idx on cr_private.party_metrics (session_key, occurred_at);
alter table cr_private.party_metrics enable row level security;
revoke all on cr_private.party_metrics from public, anon, authenticated;
grant all on cr_private.party_metrics to service_role;
grant usage, select on sequence cr_private.party_metrics_metric_id_seq to service_role;

create or replace function public.cr_record_party_metric(p_metric jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_metric is null or jsonb_typeof(p_metric) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_metric) as fields(key)
    where key not in (
      'roomId', 'sessionKey', 'version', 'playerCount', 'gameNumber', 'gameId',
      'completed', 'beatTransition', 'decisionMs', 'gameDurationMs',
      'firstBeatDurationMs', 'secondBeatDurationMs', 'missingActions',
      'powerUsed', 'powerId', 'chaosSpent', 'chaosEarned', 'powerSuccesses',
      'powerMisses', 'activeRules', 'ruleSelected', 'selectedRuleId',
      'replayStarted', 'ruleScoringApplications', 'promisesKept',
      'promisesBroken', 'objectivesCompleted', 'scoreSpread',
      'negativeContributions', 'leadChanged', 'promiseEvents', 'gambleEvents',
      'targetEvents', 'allianceEvents', 'betrayalEvents', 'contributionEvents',
      'readEvents', 'protectionEvents', 'sessionDurationMs', 'sessionCompleted'
    )
  ) then
    raise exception 'Invalid party metric payload';
  end if;

  insert into cr_private.party_metrics (
    room_id, session_key, version, player_count, game_number, game_id,
    completed, beat_transition, decision_ms, game_duration_ms,
    first_beat_duration_ms, second_beat_duration_ms, missing_actions,
    power_used, power_id, chaos_spent, chaos_earned, power_successes,
    power_misses, active_rules, rule_selected, selected_rule_id,
    replay_started, rule_scoring_applications, promises_kept, promises_broken,
    objectives_completed, score_spread, negative_contributions, lead_changed,
    promise_events, gamble_events, target_events, alliance_events,
    betrayal_events, contribution_events, read_events, protection_events,
    session_duration_ms, session_completed
  ) values (
    (p_metric->>'roomId')::uuid, p_metric->>'sessionKey',
    (p_metric->>'version')::smallint, (p_metric->>'playerCount')::smallint,
    (p_metric->>'gameNumber')::smallint, p_metric->>'gameId',
    coalesce((p_metric->>'completed')::smallint, 0),
    coalesce((p_metric->>'beatTransition')::smallint, 0),
    coalesce((p_metric->>'decisionMs')::bigint, 0),
    coalesce((p_metric->>'gameDurationMs')::bigint, 0),
    coalesce((p_metric->>'firstBeatDurationMs')::bigint, 0),
    coalesce((p_metric->>'secondBeatDurationMs')::bigint, 0),
    coalesce((p_metric->>'missingActions')::smallint, 0),
    coalesce((p_metric->>'powerUsed')::smallint, 0), p_metric->>'powerId',
    coalesce((p_metric->>'chaosSpent')::integer, 0),
    coalesce((p_metric->>'chaosEarned')::integer, 0),
    coalesce((p_metric->>'powerSuccesses')::smallint, 0),
    coalesce((p_metric->>'powerMisses')::smallint, 0),
    coalesce((p_metric->>'activeRules')::smallint, 0),
    coalesce((p_metric->>'ruleSelected')::smallint, 0),
    p_metric->>'selectedRuleId',
    coalesce((p_metric->>'replayStarted')::smallint, 0),
    coalesce((p_metric->>'ruleScoringApplications')::smallint, 0),
    coalesce((p_metric->>'promisesKept')::smallint, 0),
    coalesce((p_metric->>'promisesBroken')::smallint, 0),
    coalesce((p_metric->>'objectivesCompleted')::smallint, 0),
    coalesce((p_metric->>'scoreSpread')::integer, 0),
    coalesce((p_metric->>'negativeContributions')::smallint, 0),
    coalesce((p_metric->>'leadChanged')::smallint, 0),
    coalesce((p_metric->>'promiseEvents')::smallint, 0),
    coalesce((p_metric->>'gambleEvents')::smallint, 0),
    coalesce((p_metric->>'targetEvents')::smallint, 0),
    coalesce((p_metric->>'allianceEvents')::smallint, 0),
    coalesce((p_metric->>'betrayalEvents')::smallint, 0),
    coalesce((p_metric->>'contributionEvents')::smallint, 0),
    coalesce((p_metric->>'readEvents')::smallint, 0),
    coalesce((p_metric->>'protectionEvents')::smallint, 0),
    coalesce((p_metric->>'sessionDurationMs')::bigint, 0),
    coalesce((p_metric->>'sessionCompleted')::smallint, 0)
  );
end;
$$;

create or replace function public.cr_export_beta_evidence(p_since timestamptz default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_name', e.event_name, 'occurred_at', e.occurred_at,
        'session_key', e.session_key, 'game_id', e.game_id,
        'game_number', e.game_number, 'player_count', e.player_count,
        'chaos_intensity', e.chaos_intensity, 'house_rule_id', e.house_rule_id,
        'power_id', e.power_id, 'error_code', e.error_code
      ) order by e.occurred_at, e.event_name, e.session_key, e.game_number,
        e.game_id, e.house_rule_id, e.power_id, e.error_code)
      from cr_private.beta_events e
      where p_since is null or e.occurred_at >= p_since
    ), '[]'::jsonb),
    'metrics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'occurred_at', m.occurred_at, 'version', m.version, 'sessionKey', m.session_key,
        'playerCount', m.player_count, 'gameNumber', m.game_number,
        'gameId', m.game_id, 'completed', m.completed,
        'beatTransition', m.beat_transition, 'decisionMs', m.decision_ms,
        'gameDurationMs', m.game_duration_ms,
        'firstBeatDurationMs', m.first_beat_duration_ms,
        'secondBeatDurationMs', m.second_beat_duration_ms,
        'missingActions', m.missing_actions, 'powerUsed', m.power_used,
        'powerId', m.power_id, 'chaosSpent', m.chaos_spent,
        'chaosEarned', m.chaos_earned, 'powerSuccesses', m.power_successes,
        'powerMisses', m.power_misses, 'activeRules', m.active_rules,
        'ruleSelected', m.rule_selected, 'selectedRuleId', m.selected_rule_id,
        'replayStarted', m.replay_started,
        'ruleScoringApplications', m.rule_scoring_applications,
        'promisesKept', m.promises_kept, 'promisesBroken', m.promises_broken,
        'objectivesCompleted', m.objectives_completed,
        'scoreSpread', m.score_spread,
        'negativeContributions', m.negative_contributions,
        'leadChanged', m.lead_changed, 'promiseEvents', m.promise_events,
        'gambleEvents', m.gamble_events, 'targetEvents', m.target_events,
        'allianceEvents', m.alliance_events, 'betrayalEvents', m.betrayal_events,
        'contributionEvents', m.contribution_events, 'readEvents', m.read_events,
        'protectionEvents', m.protection_events,
        'sessionDurationMs', m.session_duration_ms,
        'sessionCompleted', m.session_completed
      ) order by m.occurred_at, m.session_key, m.game_number, m.game_id)
      from cr_private.party_metrics m
      where p_since is null or m.occurred_at >= p_since
    ), '[]'::jsonb)
  );
$$;

create or replace function public.cr_beta_cleanup_room(p_room_id uuid, p_room_code text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_feedback integer;
  v_events integer;
  v_metrics integer;
  v_rooms integer;
begin
  if p_room_id is null or p_room_code !~ '^[A-Z2-9]{6}$' then
    raise exception 'Beta cleanup requires a matching room id and code';
  end if;
  perform 1 from public.cr_rooms where id = p_room_id and code = p_room_code for update;
  if not found then raise exception 'Beta cleanup requires a matching room id and code'; end if;

  delete from cr_private.beta_feedback where room_id = p_room_id;
  get diagnostics v_feedback = row_count;
  delete from cr_private.beta_events where room_id = p_room_id;
  get diagnostics v_events = row_count;
  delete from cr_private.party_metrics where room_id = p_room_id;
  get diagnostics v_metrics = row_count;
  delete from public.cr_rooms where id = p_room_id and code = p_room_code;
  get diagnostics v_rooms = row_count;
  return jsonb_build_object('rooms', v_rooms, 'events', v_events,
    'metrics', v_metrics, 'feedback', v_feedback);
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
  v_metrics integer;
begin
  delete from public.cr_rooms where changed_at < now() - interval '14 days';
  get diagnostics v_rooms = row_count;
  delete from cr_private.beta_events where occurred_at < now() - interval '180 days';
  get diagnostics v_events = row_count;
  delete from cr_private.beta_feedback where created_at < now() - interval '365 days';
  get diagnostics v_feedback = row_count;
  delete from cr_private.party_metrics where occurred_at < now() - interval '180 days';
  get diagnostics v_metrics = row_count;
  return jsonb_build_object('rooms', v_rooms, 'events', v_events,
    'metrics', v_metrics, 'feedback', v_feedback);
end;
$$;

revoke all on function public.cr_record_party_metric(jsonb) from public, anon, authenticated;
revoke all on function public.cr_export_beta_evidence(timestamptz) from public, anon, authenticated;
revoke all on function public.cr_beta_cleanup_room(uuid, text) from public, anon, authenticated;
revoke all on function public.cr_cleanup_expired_data() from public, anon, authenticated;
grant execute on function public.cr_record_party_metric(jsonb) to service_role;
grant execute on function public.cr_export_beta_evidence(timestamptz) to service_role;
grant execute on function public.cr_beta_cleanup_room(uuid, text) to service_role;
grant execute on function public.cr_cleanup_expired_data() to service_role;
