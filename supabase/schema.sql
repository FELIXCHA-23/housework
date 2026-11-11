-- 집안일 분담 앱 스키마. 여러 번 실행해도 안전(idempotent).
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.hw_secret (
  id int primary key default 1 check (id = 1),
  key_hash text not null,      -- 앱 비밀 키의 sha256(hex)
  fn_url text not null,        -- push Edge Function 주소
  fn_secret text not null      -- DB → 함수 호출 인증용
);
create table if not exists public.hw_config (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.hw_checks (
  wk date not null,            -- 그 주 월요일
  chore text not null,
  done int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (wk, chore)
);
create table if not exists public.hw_devices (
  endpoint text primary key,
  who text not null check (who in ('A','B')),
  sub jsonb not null,
  created_at timestamptz not null default now()
);
-- 체크 알림 대기열: 첫 체크 후 1분 동안 수정 가능, 1분 뒤에도 늘어난 상태면 발송
create table if not exists public.hw_pending (
  wk date not null,
  chore text not null,
  who text not null check (who in ('A','B')),
  base int not null,           -- 첫 체크 직전 횟수
  first_at timestamptz not null default now(),
  primary key (wk, chore, who)
);
-- 사람별 마지막 체크 시각
create table if not exists public.hw_last (
  who text primary key check (who in ('A','B')),
  at timestamptz not null
);
alter table public.hw_pending enable row level security;
alter table public.hw_last enable row level security;
revoke all on public.hw_pending, public.hw_last from anon, authenticated;

-- 테이블은 API(anon)로 직접 못 읽게: RLS 켜고 정책 없음 + 권한 회수. 접근은 아래 RPC(키 검사)만.
alter table public.hw_secret enable row level security;
alter table public.hw_config enable row level security;
alter table public.hw_checks enable row level security;
alter table public.hw_devices enable row level security;
revoke all on public.hw_secret, public.hw_config, public.hw_checks, public.hw_devices from anon, authenticated;
-- push 함수(service_role)용. 새 테이블 기본 권한이 없는 프로젝트 대비
grant select on public.hw_config, public.hw_checks to service_role;
grant select, delete on public.hw_devices to service_role;

create or replace function public.hw_auth(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or not exists (
    select 1 from public.hw_secret where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
  ) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
end $$;

-- 실시간 동기화: 변경이 생기면 키 해시로 만든 채널에 신호만 보냄(데이터는 안 실음)
create or replace function public.hw_ping() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  select substr(key_hash, 1, 16) into h from public.hw_secret limit 1;
  if h is not null then
    perform realtime.send(jsonb_build_object('t', extract(epoch from now())), 'sync', 'hw-' || h, false);
  end if;
  return null;
end $$;
drop trigger if exists hw_ping_checks on public.hw_checks;
create trigger hw_ping_checks after insert or update or delete on public.hw_checks for each statement execute function public.hw_ping();
drop trigger if exists hw_ping_config on public.hw_config;
create trigger hw_ping_config after insert or update or delete on public.hw_config for each statement execute function public.hw_ping();

create or replace function public.hw_call_fn(p_body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public.hw_secret limit 1;
  if s is null then return; end if;
  perform net.http_post(
    url := s.fn_url, body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-fn-secret', s.fn_secret),
    timeout_milliseconds := 20000);
end $$;

create or replace function public.hw_get(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.hw_auth(p_key);
  return jsonb_build_object(
    'config', (select data from public.hw_config where id = 1),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('wk', wk, 'chore', chore, 'done', done)) from public.hw_checks where done > 0), '[]'::jsonb),
    'last', coalesce((select jsonb_object_agg(who, at) from public.hw_last), '{}'::jsonb),
    'now', now());
end $$;

create or replace function public.hw_save_config(p_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.hw_auth(p_key);
  insert into public.hw_config(id, data) values (1, p_data)
  on conflict (id) do update set data = excluded.data, updated_at = now();
end $$;

create or replace function public.hw_set_check(p_key text, p_wk date, p_chore text, p_done int, p_who text) returns void
language plpgsql security definer set search_path = '' as $$
declare prev int;
begin
  perform public.hw_auth(p_key);
  select done into prev from public.hw_checks where wk = p_wk and chore = p_chore;
  prev := coalesce(prev, 0);
  insert into public.hw_checks(wk, chore, done) values (p_wk, p_chore, greatest(p_done, 0))
  on conflict (wk, chore) do update set done = excluded.done, updated_at = now();
  if p_done > prev and p_who in ('A','B') then
    insert into public.hw_last(who, at) values (p_who, now()) on conflict (who) do update set at = excluded.at;
    -- 바로 보내지 않고 대기열에(이미 있으면 첫 체크 시각·기준값 유지). hw_flush가 1분 뒤 발송
    insert into public.hw_pending(wk, chore, who, base) values (p_wk, p_chore, p_who, prev) on conflict do nothing;
  end if;
end $$;

-- 첫 체크 후 1분 지난 대기 건 처리: 그때도 기준보다 늘어 있으면 알림, 취소됐으면 조용히 삭제
create or replace function public.hw_flush() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; cur int;
begin
  for r in delete from public.hw_pending where first_at <= now() - interval '1 minute' returning * loop
    select done into cur from public.hw_checks where wk = r.wk and chore = r.chore;
    if coalesce(cur, 0) > r.base then
      perform public.hw_call_fn(jsonb_build_object('type', 'check', 'wk', r.wk, 'chore', r.chore, 'done', cur, 'who', r.who));
    end if;
  end loop;
end $$;

create or replace function public.hw_reset(p_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.hw_auth(p_key);
  delete from public.hw_checks where true;
  delete from public.hw_pending where true;
  delete from public.hw_last where true;
  insert into public.hw_config(id, data) values (1, p_data)
  on conflict (id) do update set data = excluded.data, updated_at = now();
end $$;

create or replace function public.hw_subscribe(p_key text, p_who text, p_sub jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.hw_auth(p_key);
  if p_who not in ('A','B') or p_sub->>'endpoint' is null then raise exception 'bad args'; end if;
  insert into public.hw_devices(endpoint, who, sub) values (p_sub->>'endpoint', p_who, p_sub)
  on conflict (endpoint) do update set who = excluded.who, sub = excluded.sub;
end $$;

create or replace function public.hw_unsubscribe(p_key text, p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.hw_auth(p_key);
  delete from public.hw_devices where endpoint = p_endpoint;
end $$;

create or replace function public.hw_test(p_key text, p_who text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.hw_auth(p_key);
  perform public.hw_call_fn(jsonb_build_object('type', 'test', 'who', p_who));
end $$;

create or replace function public.hw_cron(p_type text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.hw_call_fn(jsonb_build_object('type', p_type));
end $$;

-- 함수 실행 권한: 내부용은 막고, 앱용 RPC만 anon에 허용
revoke all on function public.hw_auth(text), public.hw_ping(), public.hw_call_fn(jsonb), public.hw_cron(text), public.hw_flush() from public, anon, authenticated;
revoke all on function public.hw_get(text), public.hw_save_config(text, jsonb), public.hw_set_check(text, date, text, int, text),
  public.hw_reset(text, jsonb), public.hw_subscribe(text, text, jsonb), public.hw_unsubscribe(text, text), public.hw_test(text, text) from public;
grant execute on function public.hw_get(text), public.hw_save_config(text, jsonb), public.hw_set_check(text, date, text, int, text),
  public.hw_reset(text, jsonb), public.hw_subscribe(text, text, jsonb), public.hw_unsubscribe(text, text), public.hw_test(text, text) to anon, authenticated;

-- 정기 알림 (pg_cron은 UTC): 월 09:00 KST = 월 00:00 UTC, 매일 20:00 KST = 11:00 UTC
select cron.unschedule(jobname) from cron.job where jobname in ('hw_weekly', 'hw_daily', 'hw_flush');
select cron.schedule('hw_flush', '10 seconds', $$select public.hw_flush()$$);
select cron.schedule('hw_weekly', '0 0 * * 1', $$select public.hw_cron('weekly')$$);
select cron.schedule('hw_daily', '0 11 * * *', $$select public.hw_cron('daily')$$);
