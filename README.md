# 📡 Vendor Radar

**Never get surprised by SaaS auto-renewals again.**

## Problem It Solves

The average company uses 130+ SaaS tools. Renewals sneak up, budgets balloon with forgotten subscriptions, and finance teams scramble when a $5,000 annual contract auto-renews. Vendor Radar gives you a single dashboard to track every subscription, see exactly when they renew, and get email alerts 30, 7, and 1 day before each renewal.

## Features

- **Subscription Registry** — add all your SaaS tools with costs, renewal dates, billing cycles, and owners
- **Renewal Alerts** — automatic email alerts at 30, 7, and 1 day before renewal (configurable)
- **Cost Analytics** — total monthly/annual spend, spend by category, upcoming renewals at a glance
- **Live Dashboard** — color-coded renewal timeline with days-until-renewal badges
- **REST API** — full CRUD for integrating with Slack bots, Notion, or internal tools
- **Demo Data** — seeds 8 realistic example subscriptions on first run so you can explore immediately
- **SQLite** — zero-config local storage; swap for Postgres in production

## Tech Stack

- **Python 3.11+**
- **FastAPI** — REST API + HTML dashboard
- **APScheduler** — daily renewal check at 8am
- **SQLite** — embedded persistence
- **Pydantic** — request/response validation

## Installation

```bash
git clone https://github.com/Everaldtah/vendor-radar
cd vendor-radar
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your SMTP credentials and alert email
python main.py
```

## Usage

### 1. Open the dashboard

Visit `http://localhost:8001` — demo data is pre-loaded.

### 2. Add a subscription via API

```bash
curl -X POST http://localhost:8001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Intercom",
    "vendor": "Intercom Inc",
    "cost_monthly": 87.00,
    "billing_cycle": "monthly",
    "renewal_date": "2026-05-15",
    "category": "Support",
    "owner_email": "product@company.com"
  }'
```

### 3. Get cost analytics

```bash
curl http://localhost:8001/api/analytics
```

### 4. Trigger a renewal check

```bash
curl -X POST http://localhost:8001/api/check-renewals
```

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `GET /` | GET | HTML dashboard |
| `GET /api/subscriptions` | GET | List all subscriptions |
| `POST /api/subscriptions` | POST | Add a subscription |
| `GET /api/subscriptions/:id` | GET | Get one subscription |
| `PATCH /api/subscriptions/:id` | PATCH | Update a subscription |
| `DELETE /api/subscriptions/:id` | DELETE | Delete a subscription |
| `GET /api/analytics` | GET | Spend analytics + upcoming renewals |
| `POST /api/check-renewals` | POST | Run renewal check now |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ALERT_EMAIL` | — | Email to receive renewal alerts |
| `ALERT_DAYS` | `30,7,1` | Days before renewal to send alerts |
| `SMTP_HOST` | smtp.gmail.com | SMTP server |
| `SMTP_PORT` | 587 | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `DB_PATH` | vendor_radar.db | SQLite database path |

## Monetization Model

- **Free** — up to 10 subscriptions, basic alerts
- **Starter** — $15/month — unlimited subscriptions, multi-email alerts, Slack notifications
- **Teams** — $39/month — multi-user, owner assignment, budget limits per category, export to CSV
- **Enterprise** — custom — SSO, Jira/Confluence integration, custom approval workflows for renewals

Finance teams and CTOs at 10–200 person companies are the core buyer. Pain is acute and recurring. Average $150k/year in SaaS spend = willingness to pay for visibility.

## License

MIT
