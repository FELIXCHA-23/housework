// Edge Function 로컬 검증: Deno로 함수 실행 + 가짜 DB(PostgREST) + 가짜 푸시서버(RFC8291 복호화)
import https from 'node:https'; import crypto from 'node:crypto'; import fs from 'node:fs'; import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../site/core.js';
const dir = '/tmp/claude-0/fntest'; fs.mkdirSync(dir, { recursive: true });
const vapid = JSON.parse(fs.readFileSync('/tmp/claude-0/vapid.json', 'utf8'));
import { execSync } from 'node:child_process';
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 2 -subj /CN=localhost -addext subjectAltName=DNS:localhost -addext basicConstraints=critical,CA:FALSE -addext keyUsage=digitalSignature,keyEncipherment -addext extendedKeyUsage=serverAuth 2>/dev/null`);

const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
const auth = crypto.randomBytes(16);
const b64u = (b) => Buffer.from(b).toString('base64url');
const sub = (n) => ({ endpoint: `https://localhost:8443/push/${n}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } });
const devices = [{ endpoint: sub('A1').endpoint, who: 'A', sub: sub('A1') }, { endpoint: sub('B1').endpoint, who: 'B', sub: sub('B1') }, { endpoint: sub('B2').endpoint, who: 'B', sub: sub('B2') }];
const got = []; const deleted = [];

function hkdf(salt, ikm, info, len) { return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len)); }
function decrypt(body) { // aes128gcm
  const salt = body.subarray(0, 16), idlen = body[20], keyid = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
  const secret = ecdh.computeSecret(keyid);
  const ikm = hkdf(auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), keyid]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(data.subarray(data.length - 16));
  const pt = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return JSON.parse(pt.subarray(0, pt.lastIndexOf(2)).toString());
}
let checks = [];
const srv = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const u = new URL(req.url, 'https://x'); const body = Buffer.concat(chunks);
    if (u.pathname.startsWith('/push/')) {
      assert.match(req.headers.authorization, /^vapid t=.+, k=/); assert.equal(req.headers['content-encoding'], 'aes128gcm');
      got.push({ id: u.pathname.slice(6), msg: decrypt(body) }); res.writeHead(201); return res.end();
    }
    if (req.method === 'DELETE') { deleted.push(u.searchParams.get('endpoint')); res.writeHead(204); return res.end(); }
    const t = u.pathname.split('/').pop(); const single = (req.headers.accept || '').includes('object+json');
    let data = t === 'hw_config' ? (single ? { data: DEFAULT_CONFIG } : [{ data: DEFAULT_CONFIG }]) : t === 'hw_checks' ? checks : devices;
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
  });
}).listen(8443);

const fn = spawn('/home/user/housework/node_modules/.bin/deno', ['run', '-A', '--no-lock', '/home/user/housework/supabase/functions/push/index.ts'], {
  env: { ...process.env, NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1', DENO_DIR: '/tmp/claude-0/deno-cache', DENO_CERT: `${dir}/c.pem`, NODE_EXTRA_CA_CERTS: `${dir}/c.pem`, SUPABASE_URL: 'https://localhost:8443', SUPABASE_SERVICE_ROLE_KEY: 'x', VAPID_PUBLIC: vapid.publicKey, VAPID_PRIVATE: vapid.privateKey, FN_SECRET: 's3' }, stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise((r) => setTimeout(r, 6000));
process.env.NO_PROXY='localhost'; const call = async (b, secret = 's3') => (await fetch('http://localhost:8000', { method: 'POST', headers: { 'x-fn-secret': secret }, body: JSON.stringify(b) }));
try {
  assert.equal((await call({ type: 'test', who: 'A' }, 'bad')).status, 403);
  let r = await (await call({ type: 'check', wk: '2026-11-09', chore: 'dishes', done: 3, who: 'A' })).json();
  console.log(JSON.stringify(r)); assert.equal(got.length, 2); // 상대(B) 기기 2대
  assert.equal(got[0].msg.body, 'CSB: 설거지 완료 (3/7)'); got.length = 0;
  await call({ type: 'check', wk: '2026-11-09', chore: 'shop', done: 1, who: 'B' });
  assert.equal(got[0].msg.body, 'YSR: 장보기 완료'); assert.equal(got[0].id, 'A1'); got.length = 0;
  await call({ type: 'test', who: 'A' }); assert.match(got[0].msg.title, /테스트/); got.length = 0;
  const wk = await (await call({ type: 'weekly' })).json(); console.log(JSON.stringify(got.map((g) => g.msg)));
  assert.ok(got.some((g) => g.id === 'A1' && /주차 내 담당/.test(g.msg.title))); got.length = 0;
  // 일일: 오늘 실제 요일 기준. 전부 완료 상태면 발송 안 함
  const now = new Date(Date.now() + 9 * 3600e3); const d = now.toISOString().slice(0, 10);
  const mon = new Date(Date.parse(d) - (((now.getUTCDay() + 6) % 7)) * 864e5).toISOString().slice(0, 10);
  checks = DEFAULT_CONFIG.chores.map((c) => ({ wk: mon, chore: c.id, done: c.per }));
  const dn = await (await call({ type: 'daily' })).json(); assert.equal(got.length, 0); console.log('all done →', JSON.stringify(dn.results));
  checks = []; await call({ type: 'daily' }); console.log(JSON.stringify(got.map((g) => g.msg)));
  console.log('function ok');
} finally { fn.kill(); srv.close(); }
