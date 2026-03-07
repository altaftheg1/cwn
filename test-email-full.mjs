/**
 * CWN Full Email Pipeline Test
 * Tests: welcome email, digest email, unsubscribe confirm
 * Run: node test-email-full.mjs
 */
import 'dotenv/config';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM    = process.env.RESEND_FROM    || 'onboarding@resend.dev';
const BASE_URL       = process.env.APP_BASE_URL   || 'http://localhost:3000';
const TEST_EMAIL     = process.argv[2]            || 'afluisaltaf@gmail.com';

const SEP = '─'.repeat(55);

function log(label, ...args) { console.log(`\n${label}`, ...args); }

async function sendRaw({ to, subject, html, text }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html, text }),
  });
  const body = await r.text();
  return { status: r.status, body };
}

function unsubLink(email) {
  return `${BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}`;
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

console.log(SEP);
console.log('CWN Email Pipeline Test');
console.log(SEP);
console.log('API key loaded:', !!RESEND_API_KEY, '|', RESEND_API_KEY ? RESEND_API_KEY.slice(0,12)+'…' : 'MISSING');
console.log('From:          ', RESEND_FROM);
console.log('Sending to:    ', TEST_EMAIL);
console.log('Base URL:      ', BASE_URL);

if (!RESEND_API_KEY) { console.error('\nERROR: RESEND_API_KEY missing from .env'); process.exit(1); }

// ─── TEST 1: Welcome email ────────────────────────────────────────────────────
log(SEP);
log('TEST 1 — Welcome email');
{
  const unsub = unsubLink(TEST_EMAIL);
  const { status, body } = await sendRaw({
    to: TEST_EMAIL,
    subject: 'Welcome to Central Watch News 🇦🇪',
    html: `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F7F4EF;padding:40px 20px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="background:#C8102E;color:white;display:inline-block;padding:12px 24px;font-size:24px;font-weight:900;letter-spacing:2px;">CWN</div>
    <p style="color:#666;font-size:13px;margin-top:8px;">Central Watch News</p>
  </div>
  <h1 style="font-size:28px;color:#1A1208;text-align:center;margin-bottom:8px;">You're all set! 🇦🇪</h1>
  <p style="text-align:center;color:#666;margin-bottom:32px;">UAE news — calm, clear, and in plain English.</p>
  <div style="background:white;border-radius:12px;padding:24px;margin-bottom:24px;">
    <h2 style="font-size:16px;color:#1A1208;margin-bottom:16px;">Your subscription summary:</h2>
    <p style="color:#444;margin-bottom:8px;">📋 Topics: All Topics</p>
    <p style="color:#444;margin-bottom:8px;">🕐 Timing: Morning Digest (7:00 AM GST)</p>
    <p style="color:#444;">📧 Email: ${escHtml(TEST_EMAIL)}</p>
  </div>
  <div style="background:#C8102E;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center;">
    <p style="color:white;font-size:15px;margin-bottom:16px;">"No panic. No agenda. Just clear UAE news for residents."</p>
    <a href="${BASE_URL}" style="background:white;color:#C8102E;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;">Read Today's News →</a>
  </div>
  <p style="text-align:center;color:#999;font-size:12px;">
    Your first digest arrives tomorrow at 7:00 AM GST.<br><br>
    <a href="${unsub}" style="color:#aaa;">Unsubscribe anytime</a><br><br>
    Central Watch News · Dubai, UAE 🇦🇪
  </p>
</body></html>`,
    text: `Welcome to CWN!\n\nTopics: All Topics\nTiming: Morning (7 AM GST)\nEmail: ${TEST_EMAIL}\n\nRead: ${BASE_URL}\nUnsubscribe: ${unsub}`,
  });
  console.log('  Status:', status, '| Body:', body);
  console.log(status === 200 ? '  ✅ Welcome email SENT' : '  ❌ Welcome email FAILED');
}

// ─── TEST 2: Morning digest email ─────────────────────────────────────────────
log(SEP);
log('TEST 2 — Morning digest email');
{
  const unsub = unsubLink(TEST_EMAIL);
  const storyHtml = [
    { title: 'Roads on Sheikh Zayed moving smoothly', summary: 'Traffic flowing normally across major Dubai arteries this morning. Light delays near Mall of Emirates junction.', source: 'Dubai RTA' },
    { title: 'UAE economy grows 3.8% in Q1', summary: 'Non-oil sector led growth, according to latest government data. Trade and tourism sectors performed strongly.', source: 'WAM' },
    { title: 'New metro stations planned for Abu Dhabi', summary: 'Three new stations announced as part of the capital\'s 2030 mobility plan. Construction begins mid-year.', source: 'Abu Dhabi DOT' },
  ].map((s, i) => `
    <div style="border-bottom:1px solid #E8E4DF;padding:20px 0;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#C8102E;font-weight:700;margin-bottom:8px;">${s.source}</div>
      <h3 style="font-family:Georgia,serif;font-size:18px;color:#1A1208;margin:0 0 10px;">${s.title}</h3>
      <p style="color:#3D3328;font-size:14px;line-height:1.6;margin:0 0 12px;">${s.summary}</p>
      <a href="${BASE_URL}" style="color:#C8102E;font-size:13px;font-weight:700;text-decoration:none;">Read full story →</a>
    </div>`).join('');

  const { status, body } = await sendRaw({
    to: TEST_EMAIL,
    subject: 'CWN Morning Digest 🇦🇪',
    html: `<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#F7F4EF;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;">
  <div style="background:#C8102E;border-radius:12px 12px 0 0;padding:22px 24px;text-align:center;">
    <div style="color:white;font-size:22px;font-weight:900;letter-spacing:2px;font-family:Georgia,serif;">CWN</div>
    <p style="color:rgba(255,255,255,0.8);font-size:12px;margin:4px 0 0;">Central Watch News</p>
  </div>
  <div style="background:#1A1208;padding:18px 24px;">
    <h1 style="color:white;font-size:20px;font-family:Georgia,serif;margin:0 0 4px;">Good Morning, UAE 🇦🇪</h1>
    <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0;">${new Date().toLocaleDateString('en-GB',{timeZone:'Asia/Dubai',weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
  </div>
  <div style="background:white;padding:8px 24px 8px;">${storyHtml}</div>
  <div style="background:white;border-top:1px solid #E8E4DF;padding:20px 24px;text-align:center;">
    <a href="${BASE_URL}" style="display:inline-block;background:#C8102E;color:white;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700;font-size:14px;">Read all stories on CWN →</a>
  </div>
  <div style="background:#F7F4EF;border-radius:0 0 12px 12px;padding:18px 24px;text-align:center;border-top:1px solid #E8E4DF;">
    <p style="font-size:11px;color:#aaa;margin:0;">
      <a href="${unsub}" style="color:#aaa;">Unsubscribe</a> · <a href="${BASE_URL}/privacy.html" style="color:#aaa;">Privacy Policy</a> · Central Watch News · Dubai, UAE
    </p>
  </div>
</div></body></html>`,
    text: `Good Morning, UAE!\nCWN Morning Digest\n\nTop stories for today.\n\nRead: ${BASE_URL}\nUnsubscribe: ${unsub}`,
  });
  console.log('  Status:', status, '| Body:', body);
  console.log(status === 200 ? '  ✅ Digest email SENT' : '  ❌ Digest email FAILED');
}

// ─── TEST 3: Unsubscribe confirmation ─────────────────────────────────────────
log(SEP);
log('TEST 3 — Unsubscribe confirmation email');
{
  const resubUrl = `${BASE_URL}/uae-calm-uae-news.html`;
  const { status, body } = await sendRaw({
    to: TEST_EMAIL,
    subject: "You've been unsubscribed from CWN",
    html: `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F7F4EF;padding:40px 20px;text-align:center;">
  <div style="margin-bottom:24px;"><div style="background:#C8102E;color:white;display:inline-block;padding:10px 22px;font-size:22px;font-weight:900;letter-spacing:2px;">CWN</div></div>
  <h1 style="font-size:24px;color:#1A1208;">You've been unsubscribed</h1>
  <p style="color:#666;margin:16px 0 28px;">You won't receive any more emails from Central Watch News.</p>
  <a href="${resubUrl}" style="display:inline-block;background:#C8102E;color:white;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;">Changed your mind? Resubscribe here</a>
  <p style="color:#aaa;font-size:12px;margin-top:28px;">Central Watch News · Dubai, UAE</p>
</body></html>`,
    text: `You've been unsubscribed from CWN.\n\nChanged your mind? Visit: ${resubUrl}`,
  });
  console.log('  Status:', status, '| Body:', body);
  console.log(status === 200 ? '  ✅ Unsubscribe confirm SENT' : '  ❌ Unsubscribe confirm FAILED');
}

// ─── Summary ──────────────────────────────────────────────────────────────────
log(SEP);
log('All 3 test emails fired. Check inbox at:', TEST_EMAIL);
log(SEP);
