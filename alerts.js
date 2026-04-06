'use strict';

const cron       = require('node-cron');
const nodemailer = require('nodemailer');
const { getDb }  = require('./db');

// ─── Mailer factory ──────────────────────────────────────────────────────────

function createTransporter() {
  const host     = process.env.SMTP_HOST;
  const port     = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user     = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  if (!host || !user || !password) {
    console.warn('[alerts] SMTP credentials not fully configured — email alerts disabled.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: password },
  });
}

// ─── Email builder ───────────────────────────────────────────────────────────

function buildEmailHtml(vendors) {
  const rows = vendors
    .map(v => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escHtml(v.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escHtml(v.category)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">$${Number(v.cost).toFixed(2)} / ${escHtml(v.billing_cycle)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escHtml(v.renewal_date)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:bold;color:${v.days_until_renewal <= 7 ? '#c0392b' : '#e67e22'};">
          ${v.days_until_renewal} day${v.days_until_renewal === 1 ? '' : 's'}
        </td>
      </tr>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:700px;margin:0 auto;padding:20px;">
  <h2 style="color:#2c3e50;">Vendor Radar — Renewal Alert</h2>
  <p>The following subscriptions are renewing within the next <strong>30 days</strong>. Review and take action to avoid unexpected charges.</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <thead>
      <tr style="background:#f0f4f8;">
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd;">Vendor</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd;">Category</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd;">Cost</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd;">Renewal Date</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd;">Days Left</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:24px;font-size:13px;color:#666;">
    This alert was sent automatically by <strong>Vendor Radar</strong>.<br>
    Log in to your dashboard to manage subscriptions and update renewal dates.
  </p>
</body>
</html>`;
}

function buildEmailText(vendors) {
  const lines = vendors.map(v =>
    `- ${v.name} (${v.category}) | $${Number(v.cost).toFixed(2)}/${v.billing_cycle} | Renews: ${v.renewal_date} | ${v.days_until_renewal} days left`
  );
  return [
    'Vendor Radar — Renewal Alert',
    '==============================',
    `The following ${vendors.length} subscription(s) renew within 30 days:`,
    '',
    ...lines,
    '',
    'Log in to your Vendor Radar dashboard to take action.',
  ].join('\n');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Core check function (exported so it can be called on demand) ────────────

function daysUntil(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

async function checkAndSendAlerts() {
  const alertEmail = process.env.ALERT_EMAIL;
  if (!alertEmail) {
    console.warn('[alerts] ALERT_EMAIL not set — skipping alert send.');
    return { sent: false, reason: 'ALERT_EMAIL not configured' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { sent: false, reason: 'SMTP not configured' };
  }

  const db = getDb();
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + 30);

  const todayStr  = today.toISOString().slice(0, 10);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT * FROM vendors
    WHERE status = 'active'
      AND renewal_date BETWEEN ? AND ?
    ORDER BY renewal_date ASC
  `).all(todayStr, cutoffStr);

  if (rows.length === 0) {
    console.log('[alerts] No upcoming renewals in the next 30 days — no email sent.');
    return { sent: false, reason: 'no upcoming renewals' };
  }

  const enriched = rows.map(v => ({ ...v, days_until_renewal: daysUntil(v.renewal_date) }));

  const info = await transporter.sendMail({
    from:    `"Vendor Radar" <${process.env.SMTP_USER}>`,
    to:      alertEmail,
    subject: `[Vendor Radar] ${enriched.length} subscription${enriched.length > 1 ? 's' : ''} renewing soon`,
    text:    buildEmailText(enriched),
    html:    buildEmailHtml(enriched),
  });

  console.log(`[alerts] Renewal alert sent to ${alertEmail} — messageId: ${info.messageId}`);
  return { sent: true, count: enriched.length, messageId: info.messageId };
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

function startAlertScheduler() {
  // Default: every day at 8:00 AM server time
  const schedule = process.env.ALERT_CRON || '0 8 * * *';

  if (!cron.validate(schedule)) {
    console.error(`[alerts] Invalid cron expression "${schedule}" — scheduler not started.`);
    return;
  }

  cron.schedule(schedule, async () => {
    console.log(`[alerts] Running scheduled renewal check at ${new Date().toISOString()}`);
    try {
      const result = await checkAndSendAlerts();
      console.log('[alerts] Check complete:', result);
    } catch (err) {
      console.error('[alerts] Error during scheduled check:', err.message);
    }
  });

  console.log(`[alerts] Renewal alert scheduler started (cron: "${schedule}")`);
}

module.exports = { startAlertScheduler, checkAndSendAlerts };
