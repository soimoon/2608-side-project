-- voca-quiz 클라우드 동기화 스키마
--
-- 실행: Supabase 프로젝트 SQL Editor에 붙여넣고 한 번 실행한다.
-- 로컬 저장(localStorage)이 항상 정본이고 이 스키마는 그 위에 얹는 동기화 계층이다.
-- 자세한 배경은 저장소 루트 README.md의 "계정 & 동기화" 절 참고.

-- ---------- profiles ----------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  -- 사용자가 직접(또는 랜덤 제시안을 그대로) 닉네임을 확정했는지. false면 단체게임
  -- 진입 시 닉네임 설정 화면을 강제로 띄운다. 로그인 제공자가 나중에 구글 외에도
  -- 늘어날 수 있어, "구글 실명을 그대로 보여주는" 방식에 기대지 않기 위한 필드다.
  nickname_set boolean not null default false,
  -- 마지막으로 고른 색 테마. 로그인 시 이 값을 불러와 다른 기기에도 적용한다.
  theme text not null default 'blue',
  -- 이용약관·개인정보처리방침에 동의한 시각. null이면 아직 동의 전 —
  -- 구글/카카오 등 실계정으로 처음 로그인하면 앱 진입 전에 동의 화면을 강제로
  -- 띄운다(게스트 익명 계정은 개인정보를 수집하지 않으므로 대상이 아니다).
  terms_agreed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 이미 profiles 테이블이 있는 프로젝트를 위한 추가 구문.
alter table profiles add column if not exists nickname_set boolean not null default false;
alter table profiles add column if not exists terms_agreed_at timestamptz;

-- 닉네임 형식 강제: 영문·숫자·한글만, 1~10자. 제약을 걸기 전에 이미 들어가 있는(예:
-- 옛 가입 트리거가 구글 실명/이메일로 자동 채웠던 시절의) 위반 데이터를 먼저 비운다
-- — 그러지 않으면 아래 constraint 추가 자체가 실패한다.
update profiles set display_name = null, nickname_set = false
  where display_name is not null
    and display_name !~ '^[A-Za-z0-9가-힣]{1,10}$';

-- 대소문자 구분 없이 중복도 미리 정리한다(먼저 확정한 계정을 남기고 나머지는 재설정).
with dupes as (
  select id, row_number() over (
    partition by lower(display_name) order by created_at asc
  ) as rn
  from profiles
  where display_name is not null
)
update profiles p set display_name = null, nickname_set = false
  from dupes d where p.id = d.id and d.rn > 1;

alter table profiles drop constraint if exists profiles_display_name_format;
alter table profiles add constraint profiles_display_name_format
  check (display_name is null or display_name ~ '^[A-Za-z0-9가-힣]{1,10}$');

-- 대소문자 구분 없이 유일해야 한다("Cat1"과 "cat1"도 같은 닉네임으로 본다).
create unique index if not exists profiles_display_name_uniq
  on profiles (lower(display_name)) where display_name is not null;

alter table profiles enable row level security;

create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());
create policy "profiles_upsert_own" on profiles
  for insert with check (id = auth.uid());
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

-- 신규 유저가 auth.users에 생기면 profiles 행도 자동으로 만든다. display_name은
-- 일부러 채우지 않는다 — 로그인 제공자의 실명/이메일을 그대로 노출하지 않고,
-- 단체게임 진입 시 닉네임 설정 화면(nickname_set=false)에서 랜덤 제시안을 받는다.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
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
  fetched_at timestamptz not null default now(),
  -- null이 아니면 이 발음이 조회어 자신의 것이 아니라 원형 단어(예: successively →
  -- successive)의 실제 MW 녹음을 대신 보여주는 것 — 클라이언트가 "OO의 발음"이라고
  -- 라벨을 붙이는 데 쓴다. -ly/-ing처럼 규칙적으로 파생된 단어는 MW가 원형에만
  -- 발음을 싣고 파생형 자체엔 안 싣는 경우가 흔해서 생긴 필드다.
  base_word text
);

-- 이미 pronunciations 테이블이 있는 프로젝트를 위한 추가 구문.
alter table pronunciations add column if not exists base_word text;

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

-- ---------- 단체게임: game_rooms ----------
-- "방 레코드가 곧 게임 상태다" — 방장이 매 라운드 신호를 쏘는 게 아니라, 이 행 하나
-- (started_at + 라운드 길이 + 동결된 단어 목록)로부터 모든 클라이언트가 현재 라운드를
-- 독립적으로 계산한다. 그래야 방장 이탈·새로고침·백그라운드 복귀가 전부 같은 방식으로
-- 풀린다. status/speed/round_count 등은 Phase 1(로비)부터 이미 정의해 두고, 게임 진행
-- 자체(started_at 이후 컬럼들 채우기)는 이후 단계에서 붙인다 — 나중에 ALTER를 반복하지
-- 않기 위해서다.
create table if not exists game_rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 40),
  host_id uuid not null references auth.users on delete cascade,
  max_players int not null default 5 check (max_players between 2 and 8),
  status text not null default 'lobby' check (status in ('lobby', 'playing')),
  -- 게임 설정. 자유 입력이 아니라 프리셋만 허용한다 — 락스텝에서 제한 시간은 곧 전원의
  -- 대기 시간이라, 값이 제각각이면 방 목록에서 뭘 고를지 감이 안 온다.
  speed text not null default 'normal' check (speed in ('fast', 'normal', 'relaxed')),
  round_count int not null default 20 check (round_count in (10, 20, 30)),
  -- 방이 게임 종료 후에도 유지되며 여러 판을 치르므로 판 번호가 필요하다.
  game_no int not null default 0,
  -- 아래는 게임이 시작되는 순간(start_game)에 서버가 동결하는 값들. 그 사이 speed 같은
  -- 프리셋을 바꿔도 이미 진행 중인 판은 흔들리지 않는다.
  started_at timestamptz,
  finished_at timestamptz,
  answer_ms int,
  reveal_ms int,
  lead_in_ms int,
  hint_ratio real,
  words jsonb,
  mask_seed int,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index if not exists game_rooms_activity on game_rooms (status, last_activity_at desc);

alter table game_rooms enable row level security;

-- 방 목록이 애초에 공개이므로 select는 전부 상수 true로 연다. 술어 그래프에 자기참조
-- 간선이 하나도 없어 RLS 재귀(42P17)가 원천 봉쇄된다. 쓰기는 전부 아래 RPC를 통해서만
-- 이뤄진다(update/delete 정책을 아예 두지 않음 — 정원·방장이전 등 경쟁 조건이 있는
-- 변경을 클라이언트가 직접 UPDATE로 처리하면 반드시 깨진다).
create policy "game_rooms_select_all" on game_rooms
  for select using (true);
create policy "game_rooms_insert_host" on game_rooms
  for insert with check (host_id = auth.uid());

-- ---------- 단체게임: room_players ----------
create table if not exists room_players (
  room_id uuid not null references game_rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  -- profiles.display_name을 조인하지 않고 스냅샷으로 들고 있는다 — profiles_select_own이
  -- 남의 프로필 조회를 막고 있어(schema.sql 위쪽 참고) 조인이 애초에 안 되고, 스냅샷이면
  -- 방을 나간 뒤에도 지난 판 결과에 이름이 그대로 남는 부수 이득도 있다.
  display_name text not null,
  -- 참가자가 이번 판에 낼 단어장. 'mine'|'official', null이면 아직 미선택.
  source_kind text check (source_kind in ('mine', 'official')),
  source_label text,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_players_fresh on room_players (room_id, last_seen_at desc);

alter table room_players enable row level security;

create policy "room_players_select_all" on room_players
  for select using (true);
create policy "room_players_update_own" on room_players
  for update using (user_id = auth.uid());
create policy "room_players_delete_own" on room_players
  for delete using (user_id = auth.uid());
-- insert 정책 없음 — 정원 검사가 필요해 join_room RPC로만 들어온다.

-- ---------- 단체게임: room_messages ----------
-- 로비 채팅. 게임이 끝나도 방이 폭파되지 않고 이 메시지들이 그대로 남아야 하므로
-- (요구사항: 방 유지) Broadcast가 아니라 실제 테이블이다.
create table if not exists room_messages (
  id bigserial primary key,
  room_id uuid not null references game_rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  display_name text not null,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists room_messages_room on room_messages (room_id, id desc);

alter table room_messages enable row level security;

create policy "room_messages_select_all" on room_messages
  for select using (true);
-- exists(...)는 room_players를 들여다보지만 room_players의 정책이 다시 room_messages를
-- 보지 않으므로 재귀가 아니다. 방에 들어오지도 않은 사람이 아무 방에나 쓰는 것만 막는다.
create policy "room_messages_insert_member" on room_messages
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from room_players p
      where p.room_id = room_messages.room_id and p.user_id = auth.uid()
    )
  );

-- 메시지가 오가는 것도 "활동"이므로 방 청소(sweep_rooms)가 대화 중인 방을 지우지 않게
-- last_activity_at을 같이 갱신한다.
create or replace function bump_room_activity() returns trigger
language plpgsql as $$
begin
  update game_rooms set last_activity_at = now() where id = new.room_id;
  return new;
end;
$$;

drop trigger if exists room_messages_bump_activity on room_messages;
create trigger room_messages_bump_activity
  after insert on room_messages
  for each row execute function bump_room_activity();

-- Realtime publication에 추가 — 이미 들어 있으면 조용히 넘어간다(재실행 안전).
-- 실행 후 Supabase 대시보드 Database → Replication에서 이 3개 테이블이 체크됐는지
-- 반드시 눈으로 확인할 것. 빼먹으면 "아무 일도 안 일어나는" 증상으로 오래 헤맨다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'game_rooms'
  ) then
    alter publication supabase_realtime add table game_rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'room_players'
  ) then
    alter publication supabase_realtime add table room_players;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'room_messages'
  ) then
    alter publication supabase_realtime add table room_messages;
  end if;
end $$;

-- ---------- 단체게임: room_kicks (강제퇴장 쿨타임) ----------
-- 강제퇴장된 사람이 바로 재입장하지 못하게 10분간 막는다. (room_id, user_id) 기본키라
-- 같은 사람을 다시 강제퇴장해도 kicked_at 갱신만 될 뿐 여러 행이 쌓이지 않는다.
create table if not exists room_kicks (
  room_id uuid not null references game_rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  kicked_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table room_kicks enable row level security;
-- 이 테이블도 정책을 두지 않는다 — join_room()/kick_player() RPC 안에서만 읽고 쓴다.
-- 클라이언트가 "내가 강제퇴장당했는지"를 직접 조회할 필요는 join_room의 에러 메시지로
-- 충분하다.

-- ---------- 단체게임: room_contributions ----------
-- 참가자가 이번 판에 낼 단어(자기 단어장 또는 공식 덱, 최대 300개). set_source()로만
-- 쓰고 start_game()에서만 읽는다 — select 정책이 아예 없다.
create table if not exists room_contributions (
  room_id uuid not null references game_rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  words jsonb not null,
  primary key (room_id, user_id)
);

alter table room_contributions enable row level security;
-- select 정책 없음 — 서버(start_game, security definer)만 읽는다.

-- ---------- 단체게임: room_answers ----------
-- 입력 텍스트는 저장하지 않는다 — select가 전부 공개(true)라 저장하면 남이 제출한
-- 순간 답을 그대로 베낄 수 있다. verdict/elapsed_ms/points만 남기면 reveal 화면과
-- 최종 집계에 필요한 건 다 있고, 개인 학습 통계(Word.stats)에는 애초에 안 닿는다
-- (게임 단어는 클라이언트 타입 자체가 Word가 아닌 GameWord라 경로가 없다).
create table if not exists room_answers (
  room_id uuid not null references game_rooms on delete cascade,
  game_no int not null,
  round_index int not null,
  user_id uuid not null references auth.users on delete cascade,
  verdict text not null check (verdict in ('correct', 'near', 'wrong', 'timeout')),
  elapsed_ms int not null check (elapsed_ms >= 0),
  points int not null check (points >= 0 and points <= 1000),
  created_at timestamptz not null default now(),
  -- 복합 PK가 재제출·정정을 원천 차단한다(update/delete 정책도 없음 — append-only).
  primary key (room_id, game_no, round_index, user_id)
);

create index if not exists room_answers_room_game on room_answers (room_id, game_no);

alter table room_answers enable row level security;

create policy "room_answers_select_all" on room_answers
  for select using (true);
-- insert 정책 없음 — submit_answer RPC로만(서버가 시간·점수를 직접 계산해 위조를 막는다).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'room_answers'
  ) then
    alter publication supabase_realtime add table room_answers;
  end if;
end $$;

-- ---------- 단체게임: RPC ----------
-- 전부 security definer + search_path 고정 + authenticated 전용(anon 차단). RLS의
-- "select는 전부 공개, 쓰기는 정책 없음" 조합과 짝을 이뤄, 정원·방장이전 같은 경쟁
-- 조건이 있는 변경은 반드시 이 함수들을 통해서만, `for update` 잠금 아래 일어난다.

create or replace function server_now_ms() returns bigint
language sql stable as $$
  -- now()는 트랜잭션 시작 시각이라 커넥션 풀 상황에서 미세하게 뒤처질 수 있다.
  -- clock_timestamp()는 실제 호출 시각.
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- p_word(예: '샴')를 받아 '샴1', '샴2'…중 아직 아무도 안 쓰는 가장 작은 번호를 붙여
-- 돌려준다. 카운터를 따로 두지 않고 profiles.display_name을 직접 확인한다 — 그래야
-- 제시만 해보고 저장은 안 한 이름(리롤 등)은 번호를 태우지 않고, 누군가 닉네임을
-- 바꿔서 번호가 비면 그 번호가 자연스럽게 다시 나온다("꽉 채워서 쓰기").
-- 동시에 두 명이 같은 빈 번호를 제시받을 가능성은 이론상 있지만(레이스), 닉네임은
-- 애초에 전역 유일성을 강제하지 않는 값이라 무해하다 — 아주 드물게 겹쳐도 그냥
-- 두 사람이 같은 이름을 쓰게 될 뿐이다.
-- 닉네임이 1~10자로 제한되므로(profiles_display_name_format), 긴 단어일수록 붙일 수
-- 있는 숫자 자릿수가 줄어든다("브리티시숏헤어"는 7자라 999까지만). 10자를 넘어서면
-- 그 단어로는 못 찾은 것이므로 null을 돌려주고, 호출부(suggestNickname)가 다른 단어로
-- 다시 시도한다.
create or replace function next_nickname(p_word text) returns text
language plpgsql security definer set search_path = public as $$
declare n int := 1;
declare candidate text;
begin
  loop
    candidate := p_word || n::text;
    if char_length(candidate) > 10 then
      return null;
    end if;
    exit when not exists (select 1 from profiles where lower(display_name) = lower(candidate));
    n := n + 1;
  end loop;
  return candidate;
end;
$$;

create or replace function sweep_rooms() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- list_rooms()를 여는 사람이 곧 청소부다. 여러 명이 동시에 로비를 열어도
  -- advisory lock으로 실제 청소는 한 번만 실행된다.
  if not pg_try_advisory_xact_lock(hashtext('sweep_rooms')) then
    return;
  end if;

  -- 신선한 참가자가 하나도 없고 2분 이상 조용한 방은 삭제한다(cascade로 하위 전부).
  delete from game_rooms r
    where r.last_activity_at < now() - interval '2 minutes'
      and not exists (
        select 1 from room_players p
        where p.room_id = r.id and p.last_seen_at > now() - interval '60 seconds'
      );

  -- 아무도 응답하지 않은 채 잊힌 초대(game_invites, 이 파일 아래쪽 "친구" 절에 정의).
  -- 방이 지워질 땐 cascade로 같이 사라지지만, 오래 살아 있는 방에는 무응답 초대가
  -- 계속 쌓일 수 있어 여기서 같이 치운다. 클라이언트도 90초 지난 초대는 무시한다.
  delete from game_invites where created_at < now() - interval '5 minutes';

  -- 전원이 창을 닫아 finish_game이 안 불린 방을 복구(다음 단계에서 status='playing'이
  -- 실제로 쓰이기 시작하면 의미가 생긴다 — 지금 미리 둬서 나중에 손댈 곳이 없게 한다).
  update game_rooms set status = 'lobby'
    where status = 'playing' and started_at < now() - interval '1 hour';
end;
$$;

create or replace function list_rooms()
returns table (
  id uuid, title text, host_id uuid, host_name text, max_players int,
  player_count int, status text, speed text, round_count int, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  perform sweep_rooms();
  return query
    select
      r.id, r.title, r.host_id,
      coalesce(
        (select p.display_name from room_players p where p.room_id = r.id and p.user_id = r.host_id),
        ''
      ) as host_name,
      r.max_players,
      (
        select count(*)::int from room_players p
        where p.room_id = r.id and p.last_seen_at > now() - interval '60 seconds'
      ) as player_count,
      r.status, r.speed, r.round_count, r.created_at
    from game_rooms r
    order by r.created_at desc
    limit 100;
end;
$$;

create or replace function create_room(p_title text, p_max int, p_speed text, p_round_count int, p_name text)
returns game_rooms
language plpgsql security definer set search_path = public as $$
declare r game_rooms;
begin
  if p_max < 2 or p_max > 8 then raise exception 'BAD_MAX'; end if;
  if p_speed not in ('fast', 'normal', 'relaxed') then raise exception 'BAD_SPEED'; end if;
  if p_round_count not in (10, 20, 30) then raise exception 'BAD_ROUNDS'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 1 then raise exception 'BAD_TITLE'; end if;

  insert into game_rooms (title, host_id, max_players, speed, round_count)
  values (btrim(p_title), auth.uid(), p_max, p_speed, p_round_count)
  returning * into r;

  insert into room_players (room_id, user_id, display_name)
  values (r.id, auth.uid(), coalesce(nullif(btrim(p_name), ''), '플레이어'));

  return r;
end;
$$;

create or replace function join_room(p_room_id uuid, p_name text)
returns game_rooms
language plpgsql security definer set search_path = public as $$
declare r game_rooms; already boolean;
begin
  -- 이 방을 향한 다른 join/leave와 직렬화한다 — 정원 초과 동시입장을 막는 핵심 한 줄.
  select * into r from game_rooms where id = p_room_id for update;
  if r is null then raise exception 'ROOM_NOT_FOUND'; end if;

  if exists (
    select 1 from room_kicks
    where room_id = p_room_id and user_id = auth.uid()
      and kicked_at > now() - interval '10 minutes'
  ) then
    raise exception 'KICKED_COOLDOWN';
  end if;

  select exists(
    select 1 from room_players where room_id = p_room_id and user_id = auth.uid()
  ) into already;

  if not already then
    if (
      select count(*) from room_players
      where room_id = p_room_id and last_seen_at > now() - interval '60 seconds'
    ) >= r.max_players then
      raise exception 'ROOM_FULL';
    end if;
  end if;

  insert into room_players (room_id, user_id, display_name)
  values (p_room_id, auth.uid(), coalesce(nullif(btrim(p_name), ''), '플레이어'))
  on conflict (room_id, user_id) do update set last_seen_at = now(), display_name = excluded.display_name;

  update game_rooms set last_activity_at = now() where id = p_room_id;
  return r;
end;
$$;

create or replace function leave_room(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r game_rooms; nxt uuid;
begin
  select * into r from game_rooms where id = p_room_id for update;
  if r is null then return; end if;

  delete from room_players where room_id = p_room_id and user_id = auth.uid();

  select user_id into nxt from room_players
    where room_id = p_room_id and last_seen_at > now() - interval '60 seconds'
    order by joined_at asc limit 1;

  if nxt is null then
    delete from game_rooms where id = p_room_id;
  elsif r.host_id = auth.uid() then
    update game_rooms set host_id = nxt, last_activity_at = now() where id = p_room_id;
  end if;
end;
$$;

create or replace function kick_player(p_room_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r game_rooms;
begin
  select * into r from game_rooms where id = p_room_id for update;
  if r is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id is distinct from auth.uid() then raise exception 'NOT_HOST'; end if;
  if p_user_id = auth.uid() then raise exception 'CANNOT_KICK_SELF'; end if;

  delete from room_players where room_id = p_room_id and user_id = p_user_id;

  -- 10분 동안 이 방에 재입장을 막는다. 같은 사람을 다시 강제퇴장해도 kicked_at만 갱신될 뿐
  -- (재쿨타임), 여러 번 쌓이지 않는다.
  insert into room_kicks (room_id, user_id) values (p_room_id, p_user_id)
    on conflict (room_id, user_id) do update set kicked_at = now();
end;
$$;

create or replace function heartbeat(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update room_players set last_seen_at = now()
    where room_id = p_room_id and user_id = auth.uid();
  update game_rooms set last_activity_at = now() where id = p_room_id;
end;
$$;

-- 방장이 브라우저를 그냥 닫아 leave_room을 못 부른 경우, 신선하지 않은 방장을 신선한
-- 참가자에게 넘긴다. 단일 UPDATE라 멱등이고, 여러 클라이언트가 동시에 호출해도 안전하다
-- — 방 화면에서 방장의 last_seen_at이 60초를 넘으면 클라이언트들이 랜덤 지터 후 이걸 부른다.
create or replace function reconcile_room(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update game_rooms set host_id = (
      select user_id from room_players where room_id = p_room_id
        and last_seen_at > now() - interval '60 seconds'
        order by joined_at asc limit 1
    )
    where id = p_room_id
      and not exists (
        select 1 from room_players where room_id = p_room_id
          and user_id = game_rooms.host_id and last_seen_at > now() - interval '60 seconds'
      )
      and exists (
        select 1 from room_players where room_id = p_room_id
          and last_seen_at > now() - interval '60 seconds'
      );
end;
$$;

-- 참가자가 이번 판에 낼 단어장을 고른다(자기 단어장 또는 공식 덱). p_words는
-- [{en, ko:[...]}] 형태. room_contributions에 저장하고, room_players.source_kind/label을
-- 같이 채워 "누가 아직 안 골랐는지"를 방 화면에서 바로 볼 수 있게 한다. 시작 전까지는
-- 몇 번이고 다시 골라도 된다(upsert).
create or replace function set_source(p_room_id uuid, p_kind text, p_label text, p_words jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_kind not in ('mine', 'official') then raise exception 'BAD_KIND'; end if;
  if jsonb_typeof(p_words) is distinct from 'array' then raise exception 'BAD_WORDS'; end if;
  n := jsonb_array_length(p_words);
  if n < 1 then raise exception 'EMPTY_WORDS'; end if;
  if n > 300 then raise exception 'TOO_MANY_WORDS'; end if;
  if not exists (select 1 from room_players where room_id = p_room_id and user_id = auth.uid()) then
    raise exception 'NOT_MEMBER';
  end if;

  insert into room_contributions (room_id, user_id, words)
  values (p_room_id, auth.uid(), p_words)
  on conflict (room_id, user_id) do update set words = excluded.words;

  update room_players set source_kind = p_kind, source_label = nullif(btrim(coalesce(p_label, '')), '')
    where room_id = p_room_id and user_id = auth.uid();

  update game_rooms set last_activity_at = now() where id = p_room_id;
end;
$$;

-- 방장이 게임을 시작한다. 신선한 참가자 2명 이상 + 전원 단어장 선택 완료를 검사하고,
-- 참가자별로 균등하게(quota) 무작위 추출해 합친 뒤 셔플해서 game_rooms.words에 동결한다
-- ("from" 필드에 낸 사람 닉네임을 같이 넣어 reveal 화면에서 "OO가 낸 문제"로 보여준다).
-- round_count 컬럼은 건드리지 않는다 — check(10|20|30) 제약이 있어서, 실제 이번 판의
-- 라운드 수는 그냥 jsonb_array_length(words)를 쓴다(단어가 모자라면 자연히 줄어든다).
create or replace function start_game(p_room_id uuid)
returns game_rooms
language plpgsql security definer set search_path = public as $$
declare
  r game_rooms;
  fresh_count int;
  unselected_count int;
  answer_ms_val int;
  words_final jsonb := '[]'::jsonb;
  contributor record;
  quota int;
  base_quota int;
  extra_n int;
  picked jsonb;
  seen_en text[] := '{}';
begin
  select * into r from game_rooms where id = p_room_id for update;
  if r is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.host_id is distinct from auth.uid() then raise exception 'NOT_HOST'; end if;
  if r.status = 'playing' then raise exception 'ALREADY_PLAYING'; end if;

  select count(*) into fresh_count from room_players
    where room_id = p_room_id and last_seen_at > now() - interval '60 seconds';
  if fresh_count < 2 then raise exception 'NOT_ENOUGH_PLAYERS'; end if;

  select count(*) into unselected_count from room_players
    where room_id = p_room_id and last_seen_at > now() - interval '60 seconds'
      and source_kind is null;
  if unselected_count > 0 then raise exception 'NOT_ALL_SELECTED'; end if;

  answer_ms_val := case r.speed when 'fast' then 8000 when 'relaxed' then 16000 else 12000 end;
  base_quota := r.round_count / fresh_count;
  extra_n := r.round_count % fresh_count;

  for contributor in
    select rp.user_id, rp.display_name, rc.words,
           (row_number() over (order by rp.joined_at) - 1)::int as rn
    from room_players rp
    join room_contributions rc on rc.room_id = rp.room_id and rc.user_id = rp.user_id
    where rp.room_id = p_room_id and rp.last_seen_at > now() - interval '60 seconds'
  loop
    quota := base_quota + (case when contributor.rn < extra_n then 1 else 0 end);
    if quota <= 0 then continue; end if;

    select jsonb_agg(jsonb_build_object('en', value ->> 'en', 'ko', value -> 'ko', 'from', contributor.display_name))
      into picked
      from (
        select value from jsonb_array_elements(contributor.words)
        where lower(value ->> 'en') <> all (seen_en)
        order by random()
        limit quota
      ) s;

    if picked is not null then
      words_final := words_final || picked;
      select array_agg(lower(x ->> 'en')) into seen_en from (select jsonb_array_elements(words_final) x) s2;
    end if;
  end loop;

  if jsonb_array_length(words_final) < 2 then raise exception 'NOT_ENOUGH_WORDS'; end if;

  -- 참가자 순서대로 몰려 나오지 않게 최종 출제 순서를 섞는다.
  select coalesce(jsonb_agg(value), '[]'::jsonb) into words_final
    from (select value from jsonb_array_elements(words_final) order by random()) s;

  update game_rooms set
    status = 'playing',
    game_no = game_no + 1,
    started_at = now(),
    finished_at = null,
    answer_ms = answer_ms_val,
    reveal_ms = 4000,
    lead_in_ms = 3000,
    hint_ratio = 0.2,
    words = words_final,
    mask_seed = (random() * 2147483647)::int,
    last_activity_at = now()
  where id = p_room_id
  returning * into r;

  return r;
end;
$$;

-- 한 라운드의 답을 낸다. p_input은 지금은 검증에 안 쓰지만(클라이언트 판정을 신뢰하는
-- v1) 시그니처에 처음부터 포함해 둔다 — 나중에 서버 판정(judge.ts와 동일 규칙)을
-- 추가할 때 클라이언트 호출부가 한 글자도 안 바뀌게 하려는 목적이다. 시간·점수는
-- 클라이언트가 보고하지 않는다: 서버가 started_at + 라운드 길이로 직접 계산한다.
create or replace function submit_answer(p_room_id uuid, p_round_index int, p_input text, p_verdict text)
returns room_answers
language plpgsql security definer set search_path = public as $$
declare
  r game_rooms;
  rs timestamptz;
  el int;
  ratio numeric;
  pts int;
  inserted room_answers;
begin
  select * into r from game_rooms where id = p_room_id;
  if r is null or r.status <> 'playing' then raise exception 'NOT_PLAYING'; end if;
  if not exists (select 1 from room_players where room_id = p_room_id and user_id = auth.uid()) then
    raise exception 'NOT_MEMBER';
  end if;
  if p_verdict not in ('correct', 'near', 'wrong', 'timeout') then raise exception 'BAD_VERDICT'; end if;
  if r.words is null or p_round_index < 0 or p_round_index >= jsonb_array_length(r.words) then
    raise exception 'BAD_ROUND';
  end if;

  rs := r.started_at + (r.lead_in_ms + p_round_index * (r.answer_ms + r.reveal_ms)) * interval '1 millisecond';
  -- 답변 윈도우 + 700ms 지연 유예(네트워크 지연 여유). 이 밖의 제출은 라운드가
  -- 강제 전환된 뒤의 뒤늦은 요청이거나 미래 라운드를 미리 찌르는 시도다.
  if now() < rs or now() > rs + (r.answer_ms + 700) * interval '1 millisecond' then
    raise exception 'WINDOW_CLOSED';
  end if;

  el := greatest(0, least(r.answer_ms, (extract(epoch from (now() - rs)) * 1000)::int));
  ratio := el::numeric / greatest(r.answer_ms, 1);

  -- src/lib/groupScore.ts의 correctScore()와 정확히 같은 공식이어야 한다(둘이 어긋나면
  -- "화면엔 정답인데 점수가 다른" 최악의 UX가 나온다 — 고칠 땐 양쪽을 같이 고칠 것).
  pts := case
    when p_verdict = 'near' then 150
    when p_verdict <> 'correct' then 0
    when ratio < 0.5 then round(1000 - 300 * (ratio / 0.5))
    when ratio < 0.75 then round(650 - 200 * ((ratio - 0.5) / 0.25))
    else round(400 - 150 * ((ratio - 0.75) / 0.25))
  end;

  insert into room_answers (room_id, game_no, round_index, user_id, verdict, elapsed_ms, points)
  values (p_room_id, r.game_no, p_round_index, auth.uid(), p_verdict, el, pts)
  returning * into inserted;

  return inserted;
end;
$$;

-- 스케줄상 게임이 끝났을 때, 또는 신선한(60초 이내 하트비트) 참가자가 1명 이하로
-- 남았을 때 동작한다(그 전엔 조용히 무시). 후자는 다른 사람들이 다 나가서 혼자 남은
-- 사람이 시계가 다 돌 때까지 기다릴 필요 없이 그 자리에서 끝내고 자동으로 1등
-- 처리하기 위해서다 — 남은 1명 기준으로 rankPlayers를 매기면 자연히 1등이 된다.
-- 누가 불러도 안전하다 — 여러 클라이언트가 동시에 불러도 status='playing' 검사가
-- 중복 실행을 막는다.
create or replace function finish_game(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r game_rooms; end_at timestamptz; fresh_count int;
begin
  select * into r from game_rooms where id = p_room_id for update;
  if r is null or r.status <> 'playing' or r.words is null then return; end if;

  select count(*) into fresh_count from room_players
    where room_id = p_room_id and last_seen_at > now() - interval '60 seconds';

  end_at := r.started_at + (r.lead_in_ms + jsonb_array_length(r.words) * (r.answer_ms + r.reveal_ms))
            * interval '1 millisecond';
  if now() < end_at and fresh_count > 1 then return; end if;

  update game_rooms set status = 'lobby', finished_at = now(), last_activity_at = now()
    where id = p_room_id;
end;
$$;

-- anon 역할은 auth.uid()가 null이 되어 위 함수들의 "= auth.uid()" 비교가 전부 NULL(=false로
-- 취급)이 되는데, plpgsql의 `if <null> then`은 참으로도 거짓으로도 걸리지 않아 검사를
-- 조용히 건너뛸 수 있다(예: kick_player의 NOT_HOST 검사). 그래서 검사 로직을 더 두는 대신
-- 아예 authenticated가 아니면 호출 자체를 막는다.
revoke execute on function server_now_ms() from public;
revoke execute on function next_nickname(text) from public;
revoke execute on function sweep_rooms() from public;
revoke execute on function list_rooms() from public;
revoke execute on function create_room(text, int, text, int, text) from public;
revoke execute on function join_room(uuid, text) from public;
revoke execute on function leave_room(uuid) from public;
revoke execute on function kick_player(uuid, uuid) from public;
revoke execute on function heartbeat(uuid) from public;
revoke execute on function reconcile_room(uuid) from public;
revoke execute on function set_source(uuid, text, text, jsonb) from public;
revoke execute on function start_game(uuid) from public;
revoke execute on function submit_answer(uuid, int, text, text) from public;
revoke execute on function finish_game(uuid) from public;

grant execute on function server_now_ms() to authenticated;
grant execute on function next_nickname(text) to authenticated;
grant execute on function sweep_rooms() to authenticated;
grant execute on function list_rooms() to authenticated;
grant execute on function create_room(text, int, text, int, text) to authenticated;
grant execute on function join_room(uuid, text) to authenticated;
grant execute on function leave_room(uuid) to authenticated;
grant execute on function kick_player(uuid, uuid) to authenticated;
grant execute on function heartbeat(uuid) to authenticated;
grant execute on function reconcile_room(uuid) to authenticated;
grant execute on function set_source(uuid, text, text, jsonb) to authenticated;
grant execute on function start_game(uuid) to authenticated;
grant execute on function submit_answer(uuid, int, text, text) to authenticated;
grant execute on function finish_game(uuid) to authenticated;

-- ============================================================================
-- 친구 (검색·요청·접속 상태·단체게임 초대)
-- ============================================================================
-- 이미 위 스키마로 프로젝트를 만들어 둔 상태라면, 이 구분선 아래만 통째로 복사해
-- SQL Editor에서 실행하면 된다 (위쪽 create policy 문들은 재실행 시 중복 오류가 난다).
--
-- 설계 원칙: profiles의 select 정책(profiles_select_own)은 **건드리지 않는다.** 남의
-- 닉네임·접속 상태는 전부 아래 security definer 함수가 필요한 필드만 골라 돌려준다
-- (list_rooms가 이미 쓰는 방식). 그래서 친구 기능 때문에 프로필이 통째로 공개되는
-- 일이 없다.

-- ---------- 접속 상태 (profiles에 컬럼 2개) ----------
-- last_seen_at: 앱이 열려 있는 동안 25초마다 갱신(단체게임 방 하트비트와 같은 주기).
--   신선도 창도 room_players와 같은 60초를 쓴다.
-- presence_status: 'quiz'면 개인 퀴즈를 푸는 중 — 초대해서 방해하면 안 되는 상태다.
--   단체게임 진행 중인지는 이 값이 아니라 room_players 신선도로 따로 판정한다.
alter table profiles add column if not exists last_seen_at timestamptz;
alter table profiles add column if not exists presence_status text not null default 'idle';
alter table profiles drop constraint if exists profiles_presence_status_valid;
alter table profiles add constraint profiles_presence_status_valid
  check (presence_status in ('idle', 'quiz'));

-- ---------- friends / friend_requests ----------
-- 수락하면 friends에 (A,B)와 (B,A) 두 행이 생긴다. 조회할 때마다 or 조건으로 양방향을
-- 뒤지는 것보다 단순하고, "내 친구 목록"이 그냥 user_id = auth.uid() 한 줄이 된다.
create table if not exists friend_requests (
  from_id uuid not null references auth.users on delete cascade,
  to_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);

create index if not exists friend_requests_to on friend_requests (to_id, created_at desc);

create table if not exists friends (
  user_id uuid not null references auth.users on delete cascade,
  friend_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

alter table friend_requests enable row level security;
alter table friends enable row level security;
-- 두 테이블 모두 정책을 두지 않는다(room_kicks·room_contributions와 같은 처리) —
-- 아래 RPC로만 읽고 쓴다. 남의 닉네임이 붙어 나가야 하는 조회라 클라이언트가 직접
-- select하게 두면 결국 profiles를 열어야 하는데, 그걸 피하는 게 이 설계의 핵심이다.

-- ---------- room_invite_mutes (방 단위 초대 차단) ----------
-- "○○님을 차단"이 아니라 "이 방의 초대는 그만 받겠다". 사람이 아니라 방을 키로 잡아서
-- (1) 같은 사람이 나중에 다른 방에서 부르면 초대가 정상적으로 가고, (2) sweep_rooms가
-- 죽은 방을 지우는 순간 cascade로 차단 기록도 같이 사라져 별도 만료 처리나 "차단 해제"
-- UI가 아예 필요 없다.
create table if not exists room_invite_mutes (
  muter_id uuid not null references auth.users on delete cascade,
  room_id uuid not null references game_rooms on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, room_id)
);

alter table room_invite_mutes enable row level security;
-- 정책 없음 — respond_invite가 쓰고 list_invitable_friends/invite_friend가 읽는다.

-- ---------- game_invites ----------
-- 초대 전달을 Broadcast가 아니라 테이블로 하는 이유: 차단(room_invite_mutes) 검사를
-- 서버가 강제할 수 있고(Broadcast는 클라이언트가 아무에게나 쏠 수 있다), 앱의 기존
-- 패턴("쓰기는 RPC, 읽기는 postgres_changes")과 같기 때문이다.
--
-- from_name/room_title은 room_players.display_name과 같은 이유로 스냅샷이다 —
-- profiles를 조인해서 볼 수가 없고, 스냅샷이면 수신자가 Realtime 페이로드만으로
-- 모달을 바로 띄울 수 있어 추가 조회가 없다.
create table if not exists game_invites (
  id bigserial primary key,
  room_id uuid not null references game_rooms on delete cascade,
  from_id uuid not null references auth.users on delete cascade,
  to_id uuid not null references auth.users on delete cascade,
  from_name text not null,
  room_title text not null,
  created_at timestamptz not null default now(),
  -- 같은 사람이 같은 방으로 다시 부르면 새 행이 아니라 created_at 갱신(= UPDATE 이벤트).
  unique (room_id, from_id, to_id)
);

create index if not exists game_invites_to on game_invites (to_id, created_at desc);

alter table game_invites enable row level security;

-- 이 절에서 유일하게 select 정책이 필요한 테이블이다 — postgres_changes는 RLS를
-- 통과해야 이벤트를 배달하기 때문. 그래도 범위는 "내가 받은/보낸 초대"뿐이다.
drop policy if exists "game_invites_select_mine" on game_invites;
create policy "game_invites_select_mine" on game_invites
  for select using (to_id = auth.uid() or from_id = auth.uid());
-- insert/update/delete 정책 없음 — invite_friend / respond_invite RPC로만.

-- 친구 판정에서 "이 사람이 지금 아무 방에나 들어가 있나"를 자주 물어보므로 user_id로
-- 시작하는 인덱스가 필요하다(기존 room_players_fresh는 room_id로 시작한다).
create index if not exists room_players_user on room_players (user_id, last_seen_at desc);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'game_invites'
  ) then
    alter publication supabase_realtime add table game_invites;
  end if;
end $$;

-- ---------- 친구: RPC ----------

-- 앱이 열려 있는 동안 주기적으로 부른다. 시각은 클라이언트가 보내지 않고 서버가 찍는다
-- (기기 시계가 틀어져 있어도 접속 판정이 흔들리지 않게).
create or replace function touch_presence(p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('idle', 'quiz') then raise exception 'BAD_STATUS'; end if;
  update profiles set last_seen_at = now(), presence_status = p_status where id = auth.uid();
end;
$$;

-- 닉네임 앞글자로 사람을 찾는다. 2글자 이상, 최대 20명.
-- p_query를 닉네임과 같은 문자셋(영문·숫자·한글)으로 제한해서 '%'나 '_' 같은 LIKE
-- 와일드카드가 들어오는 경로 자체를 없앤다 — 그러지 않으면 '%' 한 글자로 전체 사용자를
-- 훑을 수 있다.
-- 익명(게스트) 계정과 아직 닉네임을 정하지 않은 계정은 결과에서 뺀다.
create or replace function search_users(p_query text)
returns table (id uuid, display_name text, relation text)
language plpgsql stable security definer set search_path = public as $$
declare q text;
begin
  q := btrim(coalesce(p_query, ''));
  if q !~ '^[A-Za-z0-9가-힣]{2,10}$' then return; end if;

  return query
    select
      p.id,
      p.display_name,
      case
        when exists (select 1 from friends f where f.user_id = auth.uid() and f.friend_id = p.id)
          then 'friend'
        when exists (select 1 from friend_requests r where r.from_id = auth.uid() and r.to_id = p.id)
          then 'outgoing'
        when exists (select 1 from friend_requests r where r.from_id = p.id and r.to_id = auth.uid())
          then 'incoming'
        else 'none'
      end
    from profiles p
    join auth.users u on u.id = p.id
    where p.nickname_set
      and p.display_name is not null
      and lower(p.display_name) like lower(q) || '%'
      and p.id <> auth.uid()
      and coalesce(u.is_anonymous, false) = false
    order by lower(p.display_name)
    limit 20;
end;
$$;

-- 친구 요청을 보낸다. 'friend'(바로 성립) 또는 'requested'를 돌려준다.
-- 상대가 이미 나에게 요청을 보낸 상태면 수락 왕복을 생략하고 그 자리에서 친구가 된다 —
-- 서로 상대 창을 보며 동시에 요청을 누르는 흔한 상황에서 "요청이 사라진 것처럼 보이는"
-- 혼란을 없앤다.
create or replace function send_friend_request(p_to_id uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_to_id is null or p_to_id = auth.uid() then raise exception 'BAD_TARGET'; end if;

  if (select coalesce(u.is_anonymous, false) from auth.users u where u.id = auth.uid()) then
    raise exception 'ANONYMOUS';
  end if;

  if not exists (
    select 1 from profiles p join auth.users u on u.id = p.id
    where p.id = p_to_id and p.nickname_set and coalesce(u.is_anonymous, false) = false
  ) then
    raise exception 'BAD_TARGET';
  end if;

  if exists (select 1 from friends where user_id = auth.uid() and friend_id = p_to_id) then
    raise exception 'ALREADY_FRIENDS';
  end if;

  if exists (select 1 from friend_requests where from_id = p_to_id and to_id = auth.uid()) then
    delete from friend_requests
      where (from_id = p_to_id and to_id = auth.uid())
         or (from_id = auth.uid() and to_id = p_to_id);
    insert into friends (user_id, friend_id)
      values (auth.uid(), p_to_id), (p_to_id, auth.uid())
      on conflict do nothing;
    return 'friend';
  end if;

  insert into friend_requests (from_id, to_id) values (auth.uid(), p_to_id)
    on conflict do nothing;
  return 'requested';
end;
$$;

create or replace function respond_friend_request(p_from_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from friend_requests where from_id = p_from_id and to_id = auth.uid()) then
    raise exception 'NO_REQUEST';
  end if;

  delete from friend_requests where from_id = p_from_id and to_id = auth.uid();

  if p_accept then
    insert into friends (user_id, friend_id)
      values (auth.uid(), p_from_id), (p_from_id, auth.uid())
      on conflict do nothing;
  end if;
end;
$$;

-- 친구를 끊는 건 항상 양쪽 모두에서다(한쪽만 남은 상태를 만들지 않는다).
create or replace function remove_friend(p_friend_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from friends
    where (user_id = auth.uid() and friend_id = p_friend_id)
       or (user_id = p_friend_id and friend_id = auth.uid());
end;
$$;

-- 아래 목록 함수들은 순수 조회라 plpgsql 대신 language sql로 둔다. 표 형태 반환에서
-- 출력 이름(user_id 등)과 테이블 컬럼이 겹치지만, 본문의 모든 참조를 별칭으로 한정해
-- 두었으므로 모호성 오류가 나지 않는다.
create or replace function list_friends()
returns table (user_id uuid, display_name text, online boolean, in_game boolean)
language sql stable security definer set search_path = public as $$
  select
    f.friend_id,
    p.display_name,
    -- profiles.last_seen_at(전역 접속 하트비트, 12초 주기)의 신선도 창. room_players
    -- 쪽 60초(방 하트비트는 25초 주기)와는 별개 값이다 — 온라인 표시를 더 빠르게
    -- 반영하려고 이쪽만 짧게 잡았다. usePresence.ts의 하트비트 주기와 짝을 맞춰야 한다.
    coalesce(p.last_seen_at > now() - interval '30 seconds', false),
    exists (
      select 1 from room_players rp
      where rp.user_id = f.friend_id and rp.last_seen_at > now() - interval '60 seconds'
    )
  from friends f
  join profiles p on p.id = f.friend_id
  where f.user_id = auth.uid()
  order by coalesce(p.last_seen_at > now() - interval '30 seconds', false) desc,
           lower(p.display_name)
  limit 200;
$$;

create or replace function list_friend_requests()
returns table (from_id uuid, display_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.from_id, p.display_name, r.created_at
  from friend_requests r
  join profiles p on p.id = r.from_id
  where r.to_id = auth.uid()
  order by r.created_at desc
  limit 50;
$$;

-- 지금 이 방으로 불러도 방해가 안 되는 친구만. 네 조건을 전부 만족해야 한다:
--   ① 개인 퀴즈 중이 아님 (presence_status = 'idle')
--   ② 접속 중            (last_seen_at이 30초 이내)
--   ③ 다른 단체게임 중이 아님 (신선한 room_players 행이 없음)
--   ④ 이 방의 초대를 차단하지 않음 (room_invite_mutes)
-- ③은 방 id를 따지지 않는다 — 이미 이 방에 들어와 있는 친구도 초대할 이유가 없으므로
-- 같은 조건 하나가 두 경우를 다 걸러낸다.
create or replace function list_invitable_friends(p_room_id uuid)
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select f.friend_id, p.display_name
  from friends f
  join profiles p on p.id = f.friend_id
  where f.user_id = auth.uid()
    and coalesce(p.last_seen_at > now() - interval '30 seconds', false)
    and p.presence_status = 'idle'
    and not exists (
      select 1 from room_players rp
      where rp.user_id = f.friend_id and rp.last_seen_at > now() - interval '60 seconds'
    )
    and not exists (
      select 1 from room_invite_mutes m
      where m.muter_id = f.friend_id and m.room_id = p_room_id
    )
  order by lower(p.display_name)
  limit 50;
$$;

-- 초대를 보낸다. 목록에 떴다는 것만 믿지 않고 서버가 조건을 다시 확인한다 — 목록을
-- 띄운 뒤 상대가 퀴즈를 시작했을 수도 있고, 애초에 클라이언트가 임의의 uuid를 보낼 수도
-- 있기 때문이다. from_name/room_title도 클라이언트 말이 아니라 서버가 조회해서 채운다.
create or replace function invite_friend(p_room_id uuid, p_to_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r game_rooms; my_name text;
begin
  select * into r from game_rooms where id = p_room_id;
  if r is null then raise exception 'ROOM_NOT_FOUND'; end if;

  if not exists (select 1 from room_players where room_id = p_room_id and user_id = auth.uid()) then
    raise exception 'NOT_MEMBER';
  end if;

  if not exists (select 1 from friends where user_id = auth.uid() and friend_id = p_to_id) then
    raise exception 'NOT_FRIEND';
  end if;

  if (
    select count(*) from room_players
    where room_id = p_room_id and last_seen_at > now() - interval '60 seconds'
  ) >= r.max_players then
    raise exception 'ROOM_FULL';
  end if;

  if exists (select 1 from room_invite_mutes where muter_id = p_to_id and room_id = p_room_id) then
    raise exception 'INVITE_MUTED';
  end if;

  if not exists (select 1 from list_invitable_friends(p_room_id) x where x.user_id = p_to_id) then
    raise exception 'TARGET_BUSY';
  end if;

  select p.display_name into my_name from profiles p where p.id = auth.uid();

  insert into game_invites (room_id, from_id, to_id, from_name, room_title)
  values (p_room_id, auth.uid(), p_to_id, coalesce(my_name, '친구'), r.title)
  on conflict (room_id, from_id, to_id) do update set created_at = now();
end;
$$;

-- 초대에 답한다. 어느 쪽이든 초대 행은 사라진다(수락했으면 클라이언트가 join_room으로
-- 실제 입장하므로 여기서 방에 넣지는 않는다 — 정원 검사가 join_room 한 곳에만 있어야
-- 경쟁 조건이 갈라지지 않는다). 돌려주는 값은 이동할 방 id.
create or replace function respond_invite(p_invite_id bigint, p_accept boolean, p_mute boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare inv game_invites;
begin
  select * into inv from game_invites where id = p_invite_id and to_id = auth.uid();
  if inv is null then raise exception 'NO_INVITE'; end if;

  delete from game_invites where id = p_invite_id;

  if not p_accept and p_mute then
    insert into room_invite_mutes (muter_id, room_id) values (auth.uid(), inv.room_id)
      on conflict do nothing;
    -- 같은 방에서 온 다른 초대도 같이 지운다 — 차단하자마자 그 방의 다른 친구 초대가
    -- 곧바로 또 뜨면 "차단했는데 왜 또 떠?"가 된다.
    delete from game_invites where to_id = auth.uid() and room_id = inv.room_id;
  end if;

  return inv.room_id;
end;
$$;

revoke execute on function touch_presence(text) from public;
revoke execute on function search_users(text) from public;
revoke execute on function send_friend_request(uuid) from public;
revoke execute on function respond_friend_request(uuid, boolean) from public;
revoke execute on function remove_friend(uuid) from public;
revoke execute on function list_friends() from public;
revoke execute on function list_friend_requests() from public;
revoke execute on function list_invitable_friends(uuid) from public;
revoke execute on function invite_friend(uuid, uuid) from public;
revoke execute on function respond_invite(bigint, boolean, boolean) from public;

grant execute on function touch_presence(text) to authenticated;
grant execute on function search_users(text) to authenticated;
grant execute on function send_friend_request(uuid) to authenticated;
grant execute on function respond_friend_request(uuid, boolean) to authenticated;
grant execute on function remove_friend(uuid) to authenticated;
grant execute on function list_friends() to authenticated;
grant execute on function list_friend_requests() to authenticated;
grant execute on function list_invitable_friends(uuid) to authenticated;
grant execute on function invite_friend(uuid, uuid) to authenticated;
grant execute on function respond_invite(bigint, boolean, boolean) to authenticated;

-- ============================================================================
-- 재화(씨앗)와 프로필 꾸미기
-- ============================================================================
-- 이미 위 스키마로 프로젝트를 만들어 둔 상태라면, 이 구분선 아래만 통째로 복사해
-- SQL Editor에서 실행하면 된다.
--
-- 설계 원칙: **잔액을 저장하지 않는다.** 적립·구매 내역만 append-only로 쌓고
-- (reward_grants) 잔액은 그때그때 SUM으로 계산한다. daily_claims/revival_events가
-- 이미 쓰는 "여러 기기 간엔 합집합/합계로 병합" 원칙과 같다 — mutable 잔액을
-- 두면 last-write-wins 경쟁이 생기지만, append-only 내역 + 합계는 순서가 어떻게
-- 섞여도 항상 같은 값으로 수렴한다.

-- ---------- profiles에 착용 칸 2개 ----------
-- profiles.theme과 정확히 같은 패턴(단일 mutable 값) — 이미 검증된 방식이다.
alter table profiles add column if not exists equipped_avatar text;
alter table profiles add column if not exists equipped_background text;

-- ---------- reward_grants (적립·구매 내역, append-only) ----------
-- kind: 'mission'(미션·출석 보상) | 'game_win'(단체게임 1등) | 'purchase'(꾸미기 구매,
-- amount는 음수). ref_id는 kind별로 의미가 다르다 — mission은 '<date>:<claim_kind>',
-- game_win은 '<room_id>:<game_no>', purchase는 item_id. PK 하나가 세 가지 중복을
-- 동시에 막는다: 같은 미션 두 번 지급, 같은 판 1등 두 번 지급(결과 화면 새로고침
-- 대비), 같은 아이템 두 번 구매.
create table if not exists reward_grants (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  ref_id text not null,
  amount int not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);

create index if not exists reward_grants_user on reward_grants (user_id);

alter table reward_grants enable row level security;
create policy "reward_grants_select_own" on reward_grants
  for select using (user_id = auth.uid());
-- insert 정책 없음 — 아래 트리거(security definer)와 RPC들만 쓴다.

-- ---------- mission_rewards (kind → 보상액 조회 테이블) ----------
-- daily_claims.kind가 늘어날 때마다(3단계에서 미션 4종 추가) 트리거 함수를 다시
-- 고치지 않아도 되게, 보상액을 코드가 아니라 데이터로 뺐다. 새 미션을 추가할 땐
-- 이 표에 행만 하나 더 insert하면 된다.
create table if not exists mission_rewards (
  kind text primary key,
  amount int not null check (amount > 0)
);

alter table mission_rewards enable row level security;
create policy "mission_rewards_select_all" on mission_rewards
  for select using (true);
-- insert/update 정책 없음 — decor_items와 같은 이유. 이 표를 클라이언트가 직접
-- 고쳐 쓸 수 있으면 보상액을 조작해 부풀린 뒤 미션을 완료하는 경로가 생긴다.
-- 값을 바꾸는 건 이 파일의 insert 문으로만 한다.

-- 값은 src/lib/attendance.ts의 MISSIONS 레지스트리 표시값과 반드시 같아야 한다 —
-- 화면에 보이는 보상액과 실제 지급액이 다르면 안 된다(꾸미기 아이템의 decor_items
-- 표와 정확히 같은 이유). 새 미션을 추가할 땐 두 곳을 같이 고칠 것.
insert into mission_rewards (kind, amount) values
  ('attendance', 5),
  ('mission_revive', 10),
  ('mission_volume', 10),
  ('mission_add', 10),
  ('mission_accuracy', 15),
  ('mission_group', 15)
on conflict (kind) do update set amount = excluded.amount;

-- daily_claims에 새 행이 들어오면(=미션/출석 보상을 "받았음" 표시) 곧바로 씨앗을
-- 지급한다. 클라이언트의 pushDailyClaim은 한 글자도 안 바뀌어도 되고, 오프라인에서
-- 받은 보상이 나중에 동기화될 때도 이 트리거가 그 순간 자동으로 지급한다.
-- mission_rewards에 없는 kind(미래에 지급 대상이 아닌 kind가 추가될 경우)는
-- 조용히 무시한다 — 강제로 막지 않아 하위 호환이 깨지지 않는다.
create or replace function grant_daily_claim_reward() returns trigger
language plpgsql security definer set search_path = public as $$
declare amt int;
begin
  select amount into amt from mission_rewards where kind = new.kind;
  if amt is null then return new; end if;

  insert into reward_grants (user_id, kind, ref_id, amount)
  values (new.user_id, 'mission', new.date::text || ':' || new.kind, amt)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists daily_claims_grant_reward on daily_claims;
create trigger daily_claims_grant_reward
  after insert on daily_claims
  for each row execute function grant_daily_claim_reward();

-- "단체게임 1판 완주" 미션의 진행률. room_answers는 append-only라 내가 그 판에서
-- 답을 하나라도 냈다는 증거이고, game_rooms.finished_at이 오늘(KST)이면 그 판이
-- 오늘 끝난 것이다. 새 테이블 없이 기존 두 테이블만 조인해서 파생시킨다 —
-- 1등 보상(claim_game_reward)과 달리 정원·라운드 수 조건은 없다(그냥 한 판
-- 끝까지 참여했으면 된다는 미션이라 더 관대하게 잡았다).
create or replace function today_group_finishes()
returns int
language sql stable security definer set search_path = public as $$
  select count(distinct (ra.room_id, ra.game_no))::int
  from room_answers ra
  join game_rooms r on r.id = ra.room_id and r.game_no = ra.game_no
  where ra.user_id = auth.uid()
    and r.finished_at is not null
    and (r.finished_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;
$$;

revoke execute on function today_group_finishes() from public;
grant execute on function today_group_finishes() to authenticated;

-- ---------- decor_items (꾸미기 카탈로그 — 가격 검증 전용) ----------
-- 실제 그리는 방식(그라디언트·아이콘 등)은 서버가 몰라도 된다 — src/data/decorItems.ts
-- 의 클라이언트 레지스트리가 담당한다. 서버는 "이 id가 존재하고 얼마인지"만 안다,
-- 구매 금액을 클라이언트가 정하게 두면 안 되기 때문이다.
-- ⚠️ 아이템을 추가/가격을 바꿀 땐 이 표와 decorItems.ts 양쪽을 같이 고칠 것 —
-- id·가격이 어긋나면 상점 화면 표시가와 실제 차감액이 달라진다.
create table if not exists decor_items (
  id text primary key,
  slot text not null check (slot in ('avatar', 'background')),
  price int not null check (price > 0)
);

insert into decor_items (id, slot, price) values
  ('avatar-star', 'avatar', 30),
  ('avatar-heart', 'avatar', 30),
  ('avatar-cat', 'avatar', 50),
  ('avatar-rabbit', 'avatar', 50),
  ('avatar-moon', 'avatar', 80),
  ('avatar-gem', 'avatar', 120),
  ('bg-sunrise', 'background', 40),
  ('bg-ocean', 'background', 40),
  ('bg-meadow', 'background', 70),
  ('bg-dusk', 'background', 100)
on conflict (id) do update set slot = excluded.slot, price = excluded.price;

alter table decor_items enable row level security;
create policy "decor_items_select_all" on decor_items for select using (true);
-- 가격은 공개 정보라 select는 전부 열어 둔다. insert/update는 이 파일의 문장으로만.

-- ---------- 재화·꾸미기: RPC ----------

/** 잔액 + 보유한 꾸미기 아이템 id 목록. */
create or replace function get_wallet()
returns table (balance int, owned_items text[])
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(amount) from reward_grants where user_id = auth.uid()), 0)::int,
    coalesce(
      (select array_agg(ref_id) from reward_grants where user_id = auth.uid() and kind = 'purchase'),
      '{}'
    );
$$;

create or replace function purchase_item(p_item_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  item decor_items;
  balance int;
begin
  select * into item from decor_items where id = p_item_id;
  if item is null then raise exception 'ITEM_NOT_FOUND'; end if;

  if exists (
    select 1 from reward_grants
    where user_id = auth.uid() and kind = 'purchase' and ref_id = p_item_id
  ) then
    raise exception 'ALREADY_OWNED';
  end if;

  select coalesce(sum(amount), 0) into balance from reward_grants where user_id = auth.uid();
  if balance < item.price then raise exception 'NOT_ENOUGH_SEEDS'; end if;

  insert into reward_grants (user_id, kind, ref_id, amount)
  values (auth.uid(), 'purchase', p_item_id, -item.price);
end;
$$;

/** p_item_id가 null이면 그 칸을 벗는다(기본 상태로). */
create or replace function equip_item(p_slot text, p_item_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_slot not in ('avatar', 'background') then raise exception 'BAD_SLOT'; end if;

  if p_item_id is not null then
    if not exists (select 1 from decor_items where id = p_item_id and slot = p_slot) then
      raise exception 'BAD_ITEM';
    end if;
    if not exists (
      select 1 from reward_grants
      where user_id = auth.uid() and kind = 'purchase' and ref_id = p_item_id
    ) then
      raise exception 'NOT_OWNED';
    end if;
  end if;

  if p_slot = 'avatar' then
    update profiles set equipped_avatar = p_item_id where id = auth.uid();
  else
    update profiles set equipped_background = p_item_id where id = auth.uid();
  end if;
end;
$$;

/**
 * 단체게임 1등 보상. GroupResultScreen 진입 시 호출한다. 어뷰징 방어(전부 서버에서
 * 재검증 — 클라이언트가 "내가 1등"이라고 주장하는 경로를 만들지 않는다):
 *   - 그 판이 실제로 끝났고(finished_at) game_no가 맞아야 함
 *   - 10라운드 이상
 *   - 3명 이상 참여(room_answers 기준)
 *   - 1등은 room_answers 합계로 서버가 직접 계산 — 공동 1등이면 아무도 안 받음
 *     (분쟁 소지를 없애는 단순한 규칙)
 *   - 하루 5회까지만(KST 기준)
 * reward_grants의 PK(user_id, kind, ref_id)가 같은 판 중복 지급을 추가로 막아준다
 * (결과 화면을 새로고침해도 두 번 안 들어옴).
 */
create or replace function claim_game_reward(p_room_id uuid, p_game_no int) returns int
language plpgsql security definer set search_path = public as $$
declare
  r game_rooms;
  today_kst date := (now() at time zone 'Asia/Seoul')::date;
  todays_wins int;
  participant_count int;
  word_count int;
  winner_id uuid;
  tie_count int;
  reward_amount constant int := 20;
begin
  select * into r from game_rooms where id = p_room_id;
  if r is null or r.finished_at is null or r.game_no <> p_game_no then
    raise exception 'GAME_NOT_FINISHED';
  end if;

  word_count := coalesce(jsonb_array_length(r.words), 0);
  if word_count < 10 then raise exception 'NOT_ENOUGH_ROUNDS'; end if;

  select count(distinct user_id) into participant_count
    from room_answers where room_id = p_room_id and game_no = p_game_no;
  if participant_count < 3 then raise exception 'NOT_ENOUGH_PLAYERS'; end if;

  with totals as (
    select user_id, sum(points) as total
    from room_answers
    where room_id = p_room_id and game_no = p_game_no
    group by user_id
  ),
  ranked as (
    select user_id, rank() over (order by total desc) as rnk
    from totals
  ),
  winners as (
    select user_id from ranked where rnk = 1
  )
  select (select user_id from winners limit 1), (select count(*) from winners)
    into winner_id, tie_count;

  if tie_count > 1 then raise exception 'TIE_NO_WINNER'; end if;
  if winner_id is distinct from auth.uid() then raise exception 'NOT_WINNER'; end if;

  select count(*) into todays_wins
    from reward_grants
    where user_id = auth.uid() and kind = 'game_win'
      and (created_at at time zone 'Asia/Seoul')::date = today_kst;
  if todays_wins >= 5 then raise exception 'DAILY_LIMIT'; end if;

  insert into reward_grants (user_id, kind, ref_id, amount)
  values (auth.uid(), 'game_win', p_room_id::text || ':' || p_game_no, reward_amount)
  on conflict (user_id, kind, ref_id) do nothing;

  return reward_amount;
end;
$$;

revoke execute on function get_wallet() from public;
revoke execute on function purchase_item(text) from public;
revoke execute on function equip_item(text, text) from public;
revoke execute on function claim_game_reward(uuid, int) from public;

grant execute on function get_wallet() to authenticated;
grant execute on function purchase_item(text) to authenticated;
grant execute on function equip_item(text, text) to authenticated;
grant execute on function claim_game_reward(uuid, int) to authenticated;

-- ---------- list_friends()에 착용 아바타 얹기 ----------
-- 반환 테이블의 컬럼 구성이 바뀌므로 create or replace만으로는 안 되고 먼저
-- 지워야 한다(Postgres는 RETURNS TABLE 모양이 다르면 교체를 거부한다).
drop function if exists list_friends();

create or replace function list_friends()
returns table (user_id uuid, display_name text, online boolean, in_game boolean, avatar text)
language sql stable security definer set search_path = public as $$
  select
    f.friend_id,
    p.display_name,
    coalesce(p.last_seen_at > now() - interval '30 seconds', false),
    exists (
      select 1 from room_players rp
      where rp.user_id = f.friend_id and rp.last_seen_at > now() - interval '60 seconds'
    ),
    p.equipped_avatar
  from friends f
  join profiles p on p.id = f.friend_id
  where f.user_id = auth.uid()
  order by coalesce(p.last_seen_at > now() - interval '30 seconds', false) desc,
           lower(p.display_name)
  limit 200;
$$;

revoke execute on function list_friends() from public;
grant execute on function list_friends() to authenticated;

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

-- ---------- 마이그레이션: pronunciations의 'none' 캐시 무효화 ----------
-- pronounce Edge Function이 -ly/-ing 등 파생형에 원형 단어 발음을 폴백으로 쓰도록
-- 바뀌었다. 이미 source='none'으로 "확인했지만 없음"이라고 캐시해 둔 행들은 이
-- 변경 전에 조회된 것이라 폴백을 못 받아 봤다 — 한 번만 지워서 다음에 다시
-- 조회될 때 새 로직을 타게 한다(진짜로 원형도 발음이 없는 단어는 다시 'none'으로
-- 캐시될 뿐이라 안전하다). 단어장이 크면 MW 할당량을 꽤 태울 수 있으니 급하지
-- 않다면 안 해도 된다 — 그 단어를 다시 마주칠 때 자연히 새로 조회된다.
--
--   delete from pronunciations where source = 'none';
