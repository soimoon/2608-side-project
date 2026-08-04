-- voca-quiz 클라우드 동기화 스키마
--
-- 실행: Supabase 프로젝트 SQL Editor에 붙여넣고 한 번 실행한다.
-- 로컬 저장(localStorage)이 항상 정본이고 이 스키마는 그 위에 얹는 동기화 계층이다.
-- 자세한 배경은 저장소 루트 README.md의 "계정 & 동기화" 절 참고.

-- ---------- profiles ----------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  -- 마지막으로 고른 색 테마. 로그인 시 이 값을 불러와 다른 기기에도 적용한다.
  theme text not null default 'blue',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());
create policy "profiles_upsert_own" on profiles
  for insert with check (id = auth.uid());
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

-- 신규 유저가 auth.users에 생기면 profiles 행도 자동으로 만든다.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- words ----------
-- id는 서버가 생성하지 않는다. 클라이언트(로컬 저장소)가 만든 id를 그대로 쓴다 —
-- 오프라인 우선 설계라 행은 항상 로컬에서 먼저 태어나고, 나중에 push될 뿐이다.
create table if not exists words (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  en text not null,
  -- 뜻 목록. 순서대로 1/2/3...으로 표시된다(예: 다의어). 단순 단어는 원소 1개짜리 배열.
  ko text[] not null,
  deck text not null default '기본',
  seen int not null default 0,
  correct int not null default 0,
  wrong int not null default 0,
  streak int not null default 0,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 실제로 지우지 않고 이 컬럼만 채운다. 그래야 아직 동기화 못 한 다른 기기가
  -- 다음 push 때 이 행을 되살리지 않는다 (row.updatedAt이 더 최근이면 되살아나므로).
  deleted_at timestamptz,
  -- 단어장에서 사용자가 직접 매긴 순서. "order"는 SQL 예약어라 이름을 달리 둔다.
  -- null이면 순서를 바꾼 적이 없다는 뜻이고, 그때는 created_at이 곧 정렬 키다.
  -- 두 단어 사이로 끼워 넣을 때 중간값을 쓰므로 정수가 아닐 수 있어 double이다.
  sort_order double precision
);

-- 이미 words 테이블을 만들어 둔 프로젝트를 위한 추가 구문 (처음 만드는 경우엔 위에서 이미 생겼다).
alter table words add column if not exists sort_order double precision;

-- 같은 철자를 두 번 등록하지 못하게 한다. 삭제된(deleted_at is not null) 행은 예외.
create unique index if not exists words_user_en_uniq
  on words (user_id, lower(en)) where deleted_at is null;
create index if not exists words_user_updated on words (user_id, updated_at);

alter table words enable row level security;

create policy "words_select_own" on words
  for select using (user_id = auth.uid());
create policy "words_insert_own" on words
  for insert with check (user_id = auth.uid());
create policy "words_update_own" on words
  for update using (user_id = auth.uid());
create policy "words_delete_own" on words
  for delete using (user_id = auth.uid());

-- ---------- sessions ----------
-- 세션당 1행으로 접어 둔다 (attempts를 jsonb로). 문제 수만큼 행이 늘어나는 걸 피한다.
create table if not exists sessions (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  date date not null,           -- 로컬 기준 날짜. 출석 기능이 그대로 이 컬럼 위에 얹힌다.
  started_at timestamptz not null,
  finished_at timestamptz not null,
  settings jsonb not null,
  attempts jsonb not null
);

create index if not exists sessions_user_date on sessions (user_id, date);

alter table sessions enable row level security;

create policy "sessions_select_own" on sessions
  for select using (user_id = auth.uid());
create policy "sessions_insert_own" on sessions
  for insert with check (user_id = auth.uid());

-- ---------- pronunciations ----------
-- 발음 캐시. 전 사용자가 공유하므로 user_id가 없다.
-- 다음 턴(MW 발음 연동)에서 pronounce Edge Function이 채운다.
create table if not exists pronunciations (
  en text primary key,
  ipa text,
  audio_url text,
  source text not null,
  fetched_at timestamptz not null default now()
);

alter table pronunciations enable row level security;

create policy "pronunciations_select_all" on pronunciations
  for select using (true);
-- insert/update 정책을 두지 않는다: service role(Edge Function)만 쓸 수 있어야 하고,
-- service role은 RLS를 우회하므로 별도 정책이 필요 없다.

-- ---------- daily_claims ----------
-- 출석·미션 보상을 "받았음" 표시만 한다. kind를 늘리면 미션이 늘어도 테이블 구조는
-- 그대로다. date는 KST(한국시간) 기준 — 클라이언트가 UTC+9로 고정 계산해서 보낸다.
create table if not exists daily_claims (
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  kind text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, date, kind)
);

alter table daily_claims enable row level security;

create policy "daily_claims_select_own" on daily_claims
  for select using (user_id = auth.uid());
create policy "daily_claims_insert_own" on daily_claims
  for insert with check (user_id = auth.uid());

-- ---------- revival_events ----------
-- 오답 부활전에서 그날 되살린 단어를 한 행씩 기록한다("오늘 미션 진행률"을 완전히
-- 동기화하기 위한 append-only 이벤트 로그). 같은 단어를 같은 날 두 번 되살려도
-- (user_id, date, word_id) 기본키 덕분에 한 번만 집계된다.
create table if not exists revival_events (
  user_id uuid not null references auth.users on delete cascade,
  date date not null,   -- KST 기준 날짜
  word_id text not null,
  occurred_at timestamptz not null default now(),
  primary key (user_id, date, word_id)
);

create index if not exists revival_events_user_date on revival_events (user_id, date);

alter table revival_events enable row level security;

create policy "revival_events_select_own" on revival_events
  for select using (user_id = auth.uid());
create policy "revival_events_insert_own" on revival_events
  for insert with check (user_id = auth.uid());

-- ---------- 마이그레이션: words.ko  text → text[] ----------
-- 이미 이 스키마로 프로젝트를 만들어서 words.ko가 text 컬럼인 상태라면, 위 CREATE TABLE은
-- "if not exists"라 조용히 무시되고 컬럼 타입은 안 바뀐다. 아래를 한 번만 따로 실행한다.
-- 기존 값 "통합하다"는 원소 1개짜리 배열 {"통합하다"}가 되어 데이터가 그대로 보존된다.
--
--   alter table words alter column ko type text[] using array[ko]::text[];

-- ---------- 마이그레이션: profiles.theme 추가 ----------
-- 이미 profiles 테이블이 있다면(테마 기능 추가 전에 만든 프로젝트) 위 CREATE TABLE은
-- 조용히 무시된다. 아래를 한 번만 따로 실행한다.
--
--   alter table profiles add column if not exists theme text not null default 'blue';
