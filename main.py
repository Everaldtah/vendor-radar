"""
Vendor Radar — SaaS subscription tracker with renewal alerts and cost analytics.
Track all your software tools, renewal dates, and costs. Never get surprised by auto-renewals.
"""
import os
from datetime import datetime, timedelta, date
from typing import Optional, List

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from database import init_db, get_db

load_dotenv()

app = FastAPI(title="Vendor Radar", description="SaaS subscription renewal tracker")
scheduler = AsyncIOScheduler()

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")
ALERT_EMAIL = os.getenv("ALERT_EMAIL", SMTP_USER)
ALERT_DAYS = [int(d) for d in os.getenv("ALERT_DAYS", "30,7,1").split(",")]


# ─── Pydantic Schemas ───────────────────────────────────────────────────────

class SubscriptionCreate(BaseModel):
    name: str
    vendor: str
    cost_monthly: float
    billing_cycle: str = "monthly"  # monthly, annual, one-time
    renewal_date: str  # ISO date YYYY-MM-DD
    category: str = "Other"
    owner_email: Optional[str] = None
    notes: Optional[str] = None
    status: str = "active"  # active, cancelled, trial


class SubscriptionUpdate(BaseModel):
    name: Optional[str] = None
    vendor: Optional[str] = None
    cost_monthly: Optional[float] = None
    billing_cycle: Optional[str] = None
    renewal_date: Optional[str] = None
    category: Optional[str] = None
    owner_email: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


# ─── Startup ────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    init_db()
    scheduler.add_job(check_renewals, "cron", hour=8, minute=0)
    scheduler.start()
    seed_demo_data()


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown()


def seed_demo_data():
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM subscriptions").fetchone()[0]
    if count == 0:
        today = date.today()
        demo = [
            ("Slack", "Slack Technologies", 12.50, "monthly", str(today + timedelta(days=5)), "Communication", "active"),
            ("GitHub", "GitHub Inc", 4.00, "monthly", str(today + timedelta(days=12)), "Development", "active"),
            ("Notion", "Notion Labs", 16.00, "monthly", str(today + timedelta(days=28)), "Productivity", "active"),
            ("AWS", "Amazon Web Services", 340.00, "monthly", str(today + timedelta(days=3)), "Infrastructure", "active"),
            ("Figma", "Figma Inc", 45.00, "monthly", str(today + timedelta(days=45)), "Design", "active"),
            ("Zoom", "Zoom Video", 14.99, "monthly", str(today + timedelta(days=60)), "Communication", "active"),
            ("HubSpot", "HubSpot", 890.00, "annual", str(today + timedelta(days=180)), "CRM", "active"),
            ("Datadog", "Datadog Inc", 215.00, "monthly", str(today + timedelta(days=8)), "Monitoring", "active"),
        ]
        for row in demo:
            conn.execute(
                "INSERT INTO subscriptions (name, vendor, cost_monthly, billing_cycle, renewal_date, category, status) VALUES (?,?,?,?,?,?,?)",
                row
            )
        conn.commit()
    conn.close()


# ─── CRUD Endpoints ─────────────────────────────────────────────────────────

@app.post("/api/subscriptions", status_code=201)
async def create_subscription(sub: SubscriptionCreate):
    conn = get_db()
    cursor = conn.execute("""
        INSERT INTO subscriptions (name, vendor, cost_monthly, billing_cycle, renewal_date,
                                   category, owner_email, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (sub.name, sub.vendor, sub.cost_monthly, sub.billing_cycle, sub.renewal_date,
          sub.category, sub.owner_email, sub.notes, sub.status))
    conn.commit()
    sub_id = cursor.lastrowid
    conn.close()
    return {"id": sub_id, "message": "Subscription added"}


@app.get("/api/subscriptions")
async def list_subscriptions(status: Optional[str] = None, category: Optional[str] = None):
    conn = get_db()
    query = "SELECT * FROM subscriptions WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if category:
        query += " AND category = ?"
        params.append(category)
    query += " ORDER BY renewal_date ASC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/subscriptions/{sub_id}")
async def get_subscription(sub_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM subscriptions WHERE id = ?", (sub_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Subscription not found")
    return dict(row)


@app.patch("/api/subscriptions/{sub_id}")
async def update_subscription(sub_id: int, update: SubscriptionUpdate):
    conn = get_db()
    fields = {k: v for k, v in update.dict().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields to update")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE subscriptions SET {set_clause} WHERE id = ?",
                 list(fields.values()) + [sub_id])
    conn.commit()
    conn.close()
    return {"message": "Updated"}


@app.delete("/api/subscriptions/{sub_id}")
async def delete_subscription(sub_id: int):
    conn = get_db()
    conn.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))
    conn.commit()
    conn.close()
    return {"message": "Deleted"}


@app.get("/api/analytics")
async def get_analytics():
    conn = get_db()
    rows = conn.execute("SELECT * FROM subscriptions WHERE status = 'active'").fetchall()
    conn.close()

    total_monthly = sum(r["cost_monthly"] for r in rows)
    total_annual = total_monthly * 12

    by_category = {}
    for r in rows:
        cat = r["category"]
        by_category[cat] = by_category.get(cat, 0) + r["cost_monthly"]

    today = date.today()
    upcoming = []
    for r in rows:
        try:
            renewal = date.fromisoformat(r["renewal_date"])
            days_until = (renewal - today).days
            if 0 <= days_until <= 30:
                upcoming.append({"name": r["name"], "renewal_date": r["renewal_date"],
                                  "days_until": days_until, "cost_monthly": r["cost_monthly"]})
        except Exception:
            pass

    upcoming.sort(key=lambda x: x["days_until"])

    return {
        "total_monthly_spend": round(total_monthly, 2),
        "total_annual_spend": round(total_annual, 2),
        "active_subscriptions": len(rows),
        "spend_by_category": {k: round(v, 2) for k, v in sorted(by_category.items(), key=lambda x: -x[1])},
        "upcoming_renewals": upcoming,
    }


@app.post("/api/check-renewals")
async def trigger_check():
    await check_renewals()
    return {"message": "Renewal check complete"}


async def check_renewals():
    conn = get_db()
    today = date.today()
    active = conn.execute("SELECT * FROM subscriptions WHERE status = 'active'").fetchall()
    conn.close()

    alerts_sent = 0
    for sub in active:
        try:
            renewal = date.fromisoformat(sub["renewal_date"])
            days_until = (renewal - today).days
            if days_until in ALERT_DAYS:
                send_renewal_alert(dict(sub), days_until)
                alerts_sent += 1
        except Exception:
            pass

    print(f"[{datetime.utcnow()}] Renewal check: {alerts_sent} alert(s) sent")


def send_renewal_alert(sub: dict, days_until: int):
    recipients = [e for e in [sub.get("owner_email"), ALERT_EMAIL] if e]
    if not recipients:
        print(f"[ALERT] {sub['name']} renews in {days_until} day(s) — ${sub['cost_monthly']}/mo")
        return

    urgency = "🔴" if days_until <= 1 else "🟡" if days_until <= 7 else "🔵"
    subject = f"{urgency} {sub['name']} renews in {days_until} day{'s' if days_until != 1 else ''} — ${sub['cost_monthly']:.2f}/mo"
    html = f"""
    <h2>Upcoming Renewal: {sub['name']}</h2>
    <table style="border-collapse:collapse">
        <tr><td style="padding:6px 12px;color:#64748b">Vendor</td><td style="padding:6px 12px"><strong>{sub['vendor']}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#64748b">Renewal Date</td><td style="padding:6px 12px"><strong>{sub['renewal_date']}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#64748b">Days Until Renewal</td><td style="padding:6px 12px"><strong style="color:{'#dc2626' if days_until <= 1 else '#d97706' if days_until <= 7 else '#2563eb'}">{days_until}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#64748b">Monthly Cost</td><td style="padding:6px 12px"><strong>${sub['cost_monthly']:.2f}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#64748b">Category</td><td style="padding:6px 12px">{sub['category']}</td></tr>
        {'<tr><td style="padding:6px 12px;color:#64748b">Notes</td><td style="padding:6px 12px">' + sub.get('notes','') + '</td></tr>' if sub.get('notes') else ''}
    </table>
    <p style="margin-top:20px;color:#64748b;font-size:13px">Sent by Vendor Radar · Your SaaS subscription tracker</p>
    """

    if not SMTP_USER or not SMTP_PASS:
        print(f"[EMAIL MOCK] {subject}")
        return

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_USER
        msg["To"] = ", ".join(recipients)
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, recipients, msg.as_string())
    except Exception as e:
        print(f"Alert email error: {e}")


@app.get("/", response_class=HTMLResponse)
async def dashboard():
    conn = get_db()
    subs = conn.execute("SELECT * FROM subscriptions ORDER BY renewal_date ASC").fetchall()
    conn.close()

    today = date.today()
    total_monthly = sum(r["cost_monthly"] for r in subs if r["status"] == "active")

    def days_badge(renewal_str, status):
        if status != "active":
            return f'<span style="background:#f1f5f9;color:#64748b;padding:2px 10px;border-radius:20px;font-size:12px">{status}</span>'
        try:
            renewal = date.fromisoformat(renewal_str)
            days = (renewal - today).days
            if days < 0:
                color, bg = "#991b1b", "#fee2e2"
                label = f"overdue {abs(days)}d"
            elif days <= 7:
                color, bg = "#92400e", "#fef3c7"
                label = f"⚠ {days}d"
            elif days <= 30:
                color, bg = "#1e40af", "#dbeafe"
                label = f"{days}d"
            else:
                color, bg = "#166534", "#dcfce7"
                label = f"{days}d"
            return f'<span style="background:{bg};color:{color};padding:2px 10px;border-radius:20px;font-size:12px">{label}</span>'
        except Exception:
            return renewal_str

    rows = "".join(f"""<tr>
        <td style="padding:12px 16px"><strong>{r['name']}</strong><br><span style="color:#94a3b8;font-size:12px">{r['vendor']}</span></td>
        <td style="padding:12px 16px;color:#64748b;font-size:13px">{r['category']}</td>
        <td style="padding:12px 16px"><strong>${r['cost_monthly']:.2f}</strong>/mo</td>
        <td style="padding:12px 16px;color:#64748b;font-size:13px">{r['renewal_date']}</td>
        <td style="padding:12px 16px">{days_badge(r['renewal_date'], r['status'])}</td>
    </tr>""" for r in subs)

    return f"""<!DOCTYPE html>
<html><head><title>Vendor Radar</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;font-family:system-ui;background:#f8fafc;color:#1e293b}}
.header{{background:linear-gradient(135deg,#1e293b,#334155);color:white;padding:24px 40px}}
.container{{max-width:1100px;margin:0 auto;padding:30px 40px}}
.stats{{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:32px}}
.stat{{background:white;border-radius:12px;padding:20px 24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}}
.stat h3{{margin:0;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}}
.stat p{{margin:8px 0 0;font-size:30px;font-weight:700}}
table{{width:100%;border-collapse:collapse;background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden}}
th{{background:#f8fafc;padding:10px 16px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}}
tr:hover{{background:#f8fafc}}
.add-btn{{background:#4F46E5;color:white;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;float:right;margin-bottom:16px}}
</style></head>
<body>
<div class="header">
<h1 style="margin:0;font-size:24px">📡 Vendor Radar</h1>
<p style="margin:6px 0 0;opacity:.7;font-size:14px">SaaS Subscription Tracker — Never miss a renewal</p>
</div>
<div class="container">
<div class="stats">
<div class="stat"><h3>Monthly Spend</h3><p style="color:#4F46E5">${total_monthly:.2f}</p></div>
<div class="stat"><h3>Annual Spend</h3><p style="color:#0f172a">${total_monthly*12:.2f}</p></div>
<div class="stat"><h3>Active Tools</h3><p style="color:#16a34a">{sum(1 for r in subs if r['status']=='active')}</p></div>
</div>
<h2 style="margin:0 0 16px">All Subscriptions</h2>
<a href="/api/check-renewals" style="background:#4F46E5;color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:13px;float:right;margin-bottom:16px">Run Renewal Check</a>
<table>
<thead><tr>
<th>Tool</th><th>Category</th><th>Cost</th><th>Renewal Date</th><th>Time Until Renewal</th>
</tr></thead>
<tbody>{rows}</tbody>
</table>
<p style="color:#94a3b8;font-size:12px;margin-top:16px">API: <code>GET /api/subscriptions</code> · <code>POST /api/subscriptions</code> · <code>GET /api/analytics</code></p>
</div></body></html>"""


@app.get("/health")
async def health():
    return {"status": "ok", "service": "vendor-radar"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
