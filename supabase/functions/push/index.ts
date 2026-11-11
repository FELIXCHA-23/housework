// DB(pg_net / pg_cron)가 호출하는 푸시 발송 함수. x-fn-secret 헤더로 인증.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { DEFAULT_CONFIG, kstNow, mondayOf, ownerOf, weekNo, choresOf, pendingToday, weeklyDigest, other, fmtMin } from './core.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@example.com', Deno.env.get('VAPID_PUBLIC')!, Deno.env.get('VAPID_PRIVATE')!);

type Msg = { title: string; body: string; tag?: string };

async function load() {
  const [c, k, d] = await Promise.all([
    db.from('hw_config').select('data').eq('id', 1).maybeSingle(),
    db.from('hw_checks').select('wk,chore,done'),
    db.from('hw_devices').select('endpoint,who,sub'),
  ]);
  if (c.error) throw c.error; if (k.error) throw k.error; if (d.error) throw d.error;
  return { cfg: c.data?.data ?? DEFAULT_CONFIG, checks: k.data ?? [], devices: d.data ?? [] };
}

async function send(devices: any[], who: 'A' | 'B', m: Msg) {
  const payload = JSON.stringify({ ...m, url: './' });
  const targets = devices.filter((x) => x.who === who);
  let ok = 0, dead = 0, fail = 0;
  await Promise.all(targets.map(async (t) => {
    try {
      await webpush.sendNotification(t.sub, payload, { TTL: 60 * 60 * 12, urgency: 'high' });
      ok++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        dead++; await db.from('hw_devices').delete().eq('endpoint', t.endpoint);
      } else { fail++; console.error('push fail', e?.statusCode, e?.body || e?.message); }
    }
  }));
  return { who, targets: targets.length, ok, dead, fail };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-fn-secret') !== Deno.env.get('FN_SECRET')) return new Response('forbidden', { status: 403 });
  try {
    const body = await req.json();
    const { cfg, checks, devices } = await load();
    const now = kstNow();
    const wkNow = mondayOf(now.ymd);
    const results: any[] = [];

    if (body.type === 'check') {
      const chore = cfg.chores.find((c: any) => c.id === body.chore);
      const actor = body.who as 'A' | 'B';
      const name = cfg.names[actor];
      const label = chore ? chore.name : '집안일';
      const extra = chore && chore.per > 1 ? ` (${body.done}/${chore.per})` : '';
      results.push(await send(devices, other(actor), { title: '집안일', body: `${name}: ${label} 완료${extra}` }));
    } else if (body.type === 'test') {
      const who = (body.who === 'B' ? 'B' : 'A') as 'A' | 'B';
      results.push(await send(devices, who, { title: '테스트 알림', body: `${cfg.names[who]}님, 알림이 정상적으로 도착했어요 ✅` }));
    } else if (body.type === 'weekly') {
      for (const who of ['A', 'B'] as const) {
        const g = weeklyDigest(cfg, wkNow, who);
        const lines = g.list.map((c: any) => `${c.name} ${c.per}회`).join(', ');
        results.push(await send(devices, who, {
          title: `${g.n}주차 내 담당 · ${fmtMin(g.minutes)}`,
          body: lines || '이번 주 담당 없음', tag: 'weekly',
        }));
      }
    } else if (body.type === 'daily') {
      const byChore: Record<string, number> = {};
      for (const k of checks) if (k.wk === wkNow) byChore[k.chore] = k.done;
      for (const who of ['A', 'B'] as const) {
        const p = pendingToday(cfg, wkNow, who, byChore, now.dow);
        if (p.total === 0) { results.push({ who, skipped: 'all done' }); continue; }
        results.push(await send(devices, who, {
          title: `오늘 안 끝낸 일 ${p.total}개`,
          body: p.items.map((i: any) => (i.left > 1 ? `${i.name} ×${i.left}` : i.name)).join(', '), tag: 'daily',
        }));
      }
    } else {
      return new Response(JSON.stringify({ error: 'unknown type' }), { status: 400 });
    }
    return new Response(JSON.stringify({ type: body.type, results }), { headers: { 'content-type': 'application/json' } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
