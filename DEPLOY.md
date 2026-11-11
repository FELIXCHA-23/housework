# 집안일 PWA 배포 절차 (로컬 Claude Code용)

코드는 완성·로컬 테스트 완료 상태. 남은 일 = 실제 서버 연결과 배포.
테스트: `npm i && node test/core.test.mjs && node test/fn.test.mjs && node test/ui.test.mjs`
(fn/ui 테스트는 Linux 경로를 가정함 — 로컬에선 필요 시 경로만 조정)

## 구조
- `site/` 정적 PWA (GitHub Pages로 배포). `site/config.js`에 공개값 3개(URL, ANON, VAPID 공개키)를 채워야 함
- `supabase/schema.sql` 테이블·RPC(비밀 키 검사)·실시간 트리거·pg_cron(월 00:00 UTC, 매일 11:00 UTC)
- `supabase/functions/push/` 푸시 발송 Edge Function (`core.js`는 `site/core.js` 복사본 — 수정 시 같이 복사)

## 순서
1. `npx supabase login` → `npx supabase projects create housework --region ap-northeast-2` (무료 플랜인지 확인)
2. 값 생성
   - 앱 비밀 키 KEY: 랜덤 24자 이상 (예: `node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"`)
   - VAPID: `npx web-push generate-vapid-keys`
   - FN_SECRET: 랜덤 32자
3. 함수 배포: `npx supabase functions deploy push --project-ref <REF> --no-verify-jwt`
   시크릿: `npx supabase secrets set --project-ref <REF> VAPID_PUBLIC=.. VAPID_PRIVATE=.. VAPID_SUBJECT=mailto:noreply@example.com FN_SECRET=..`
4. SQL 실행(대시보드 SQL Editor 또는 `supabase db query`): `supabase/schema.sql` 실행 후
   ```sql
   insert into public.hw_secret(id,key_hash,fn_url,fn_secret) values (1, encode(extensions.digest('<KEY>','sha256'),'hex'),
     'https://<REF>.supabase.co/functions/v1/push', '<FN_SECRET>')
   on conflict (id) do update set key_hash=excluded.key_hash, fn_url=excluded.fn_url, fn_secret=excluded.fn_secret;
   ```
   (초기 데이터는 앱이 처음 열릴 때 기본값을 씀. 편집에서 저장하면 DB에 들어감)
   확인: `select realtime.send('{}'::jsonb,'sync','test',false);` 가 오류 없이 실행되는지
5. `site/config.js` 채우기: URL=`https://<REF>.supabase.co`, ANON=프로젝트 anon(또는 publishable) 키, VAPID=공개키
6. GitHub `FELIXCHA-23/housework` (Public) 에 이 폴더 내용을 루트로 push(main). Settings → Pages → Source: **GitHub Actions**
7. 배포 URL: `https://felixcha-23.github.io/housework/?k=<KEY>` — 이 주소를 두 사람에게만 전달

## 완료 확인
- 두 기기에서 같은 URL → 한쪽 체크가 다른 쪽에 1~2초 안에 반영
- 설정 → 알림 켜기 → 테스트 푸시 → 실제 수신
- 한쪽 체크 시 상대 폰에 "CSB: 설거지 완료" 알림
- 함수 로그: 대시보드 Edge Functions → push → Logs / `select * from net._http_response order by id desc limit 5;`
