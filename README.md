# Vendor Radar

> Stop paying for software you forgot you signed up for.

Vendor Radar is a lightweight SaaS subscription and vendor contract tracker built for small and medium-sized businesses (SMBs). It gives your team a single source of truth for every software tool, SaaS subscription, and vendor contract — complete with renewal alerts, spend analytics, and duplicate-tool detection.

---

## The Problem

The average SMB wastes **23% of its SaaS budget** on unused or overlapping tools. Renewals sneak up with no warning, seats go unused, and three teams end up paying for three different project-management tools. Vendor Radar fixes that.

---

## Features

- **Subscription Inventory** — Track every vendor: cost, billing cycle, renewal date, category, and contact info.
- **Renewal Alerts** — Automated daily email digest listing every subscription renewing within the next 30 days.
- **Spend Analytics** — Monthly and annual spend broken down by category, so you know exactly where the money goes.
- **Duplicate Detection** — Automatically flags categories where you have more than one active tool and estimates potential savings from consolidation.
- **Dashboard Overview** — At-a-glance numbers: total spend, active vendors, upcoming renewals in 7 / 30 / 90 days.
- **Flexible Filtering** — Query vendors by status, category, or sort order.
- **Graceful Shutdown** — SIGTERM/SIGINT-aware for clean container deployments.

---

## Tech Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Runtime     | Node.js 18+                       |
| Framework   | Express 4                         |
| Database    | SQLite via `better-sqlite3`       |
| Email       | Nodemailer (any SMTP provider)    |
| Scheduler   | node-cron                         |
| Config      | dotenv                            |
| CORS        | cors                              |

---

## Installation

### Prerequisites

- Node.js 18 or later
- npm 9 or later

### Steps

```bash
# 1. Clone or copy the project
git clone https://github.com/your-org/vendor-radar.git
cd vendor-radar

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your SMTP credentials and alert email address

# 4. Start the server
node server.js
```

The server starts on `http://localhost:3000` by default (configurable via `PORT` in `.env`).

The SQLite database file (`vendor-radar.db`) is created automatically on first run.

---

## Configuration

Copy `.env.example` to `.env` and fill in the values:

| Variable        | Required | Default              | Description                                      |
|-----------------|----------|----------------------|--------------------------------------------------|
| `PORT`          | No       | `3000`               | HTTP port the server listens on                  |
| `DATABASE_PATH` | No       | `./vendor-radar.db`  | Path to the SQLite database file                 |
| `SMTP_HOST`     | Yes*     | —                    | SMTP server hostname                             |
| `SMTP_PORT`     | No       | `587`                | SMTP server port (use 465 for SSL)               |
| `SMTP_USER`     | Yes*     | —                    | SMTP username / email address                    |
| `SMTP_PASSWORD` | Yes*     | —                    | SMTP password or app password                    |
| `ALERT_EMAIL`   | Yes*     | —                    | Recipient address for renewal alert digests      |
| `ALERT_CRON`    | No       | `0 8 * * *`          | Cron schedule for the daily alert check          |

\* Required only for email alerts. The API runs without SMTP configured; alerts are simply skipped with a console warning.

---

## API Usage

All endpoints accept and return JSON. Replace `http://localhost:3000` with your deployed URL as needed.

### Health Check

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "timestamp": "2026-04-06T08:00:00.000Z",
  "version": "1.0.0",
  "services": { "database": "ok" }
}
```

---

### Add a Vendor

```bash
curl -X POST http://localhost:3000/vendors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GitHub",
    "cost": 21,
    "billing_cycle": "monthly",
    "renewal_date": "2026-05-01",
    "category": "Developer Tools",
    "notes": "Team plan, 3 seats",
    "website": "https://github.com",
    "contact_email": "billing@github.com"
  }'
```

**Fields:**

| Field           | Type   | Required | Default    | Notes                                                      |
|-----------------|--------|----------|------------|------------------------------------------------------------|
| `name`          | string | Yes      | —          | Vendor / product name                                      |
| `cost`          | number | Yes      | —          | Cost in the billing currency                               |
| `billing_cycle` | string | No       | `monthly`  | `monthly`, `annual`, `quarterly`, or `one-time`            |
| `renewal_date`  | string | Yes      | —          | Format: `YYYY-MM-DD`                                       |
| `category`      | string | No       | `Other`    | Free-form; used for grouping (e.g. "CRM", "DevOps")        |
| `status`        | string | No       | `active`   | `active`, `inactive`, `cancelled`, or `pending`            |
| `notes`         | string | No       | `""`       | Any free-text notes                                        |
| `website`       | string | No       | `""`       | Vendor website URL                                         |
| `contact_email` | string | No       | `""`       | Billing contact email at the vendor                        |

---

### List All Vendors

```bash
# All vendors, sorted by renewal date (default)
curl http://localhost:3000/vendors

# Only active vendors in the CRM category, sorted by cost descending
curl "http://localhost:3000/vendors?status=active&category=CRM&sort_by=cost&order=desc"
```

Query parameters: `status`, `category`, `sort_by` (`renewal_date`, `name`, `cost`, `category`, `created_at`), `order` (`asc`, `desc`).

Each vendor in the response includes computed fields:

- `days_until_renewal` — integer (negative if already past due)
- `monthly_cost` — cost normalised to a monthly figure
- `annual_cost` — cost normalised to an annual figure

---

### Get a Single Vendor

```bash
curl http://localhost:3000/vendors/1
```

---

### Update a Vendor

```bash
curl -X PUT http://localhost:3000/vendors/1 \
  -H "Content-Type: application/json" \
  -d '{
    "cost": 25,
    "renewal_date": "2026-06-01",
    "notes": "Upgraded to 5 seats"
  }'
```

Send only the fields you want to change — all others are preserved.

---

### Delete a Vendor

```bash
curl -X DELETE http://localhost:3000/vendors/1
```

---

### Renewal Alerts

```bash
# Vendors renewing within the next 30 days (default)
curl http://localhost:3000/vendors/alerts

# Vendors renewing within the next 7 days
curl "http://localhost:3000/vendors/alerts?days=7"
```

---

### Spend Analytics

```bash
curl http://localhost:3000/analytics/spend
```

```json
{
  "summary": {
    "total_monthly_spend": 412.50,
    "total_annual_spend": 4950.00,
    "active_vendor_count": 12,
    "category_count": 5
  },
  "by_category": [
    {
      "category": "Developer Tools",
      "monthly_spend": 180.00,
      "annual_spend": 2160.00,
      "vendor_count": 4,
      "vendors": [ ... ]
    }
  ]
}
```

---

### Duplicate / Overlap Detection

```bash
curl http://localhost:3000/analytics/duplicates
```

```json
{
  "summary": {
    "categories_with_overlap": 2,
    "total_potential_monthly_savings": 95.00,
    "total_potential_annual_savings": 1140.00
  },
  "overlapping_categories": [
    {
      "category": "Project Management",
      "vendor_count": 3,
      "total_monthly_cost": 120.00,
      "potential_savings": 80.00,
      "recommendation": "You have 3 active tools in the \"Project Management\" category. Consider consolidating to reduce costs.",
      "vendors": [ ... ]
    }
  ]
}
```

---

### Dashboard Overview

```bash
curl http://localhost:3000/analytics/overview
```

---

### Trigger an Alert Check Manually

```bash
curl -X POST http://localhost:3000/alerts/trigger
```

Useful during setup to verify your SMTP configuration without waiting for the scheduled cron run.

---

## Example: Adding a Batch of Vendors

```bash
vendors=(
  '{"name":"Slack","cost":8.75,"billing_cycle":"monthly","renewal_date":"2026-05-10","category":"Communication"}'
  '{"name":"Notion","cost":16,"billing_cycle":"monthly","renewal_date":"2026-04-22","category":"Productivity"}'
  '{"name":"GitHub","cost":21,"billing_cycle":"monthly","renewal_date":"2026-05-01","category":"Developer Tools"}'
  '{"name":"Figma","cost":45,"billing_cycle":"monthly","renewal_date":"2026-06-15","category":"Design"}'
  '{"name":"Datadog","cost":1200,"billing_cycle":"annual","renewal_date":"2027-01-01","category":"Developer Tools"}'
  '{"name":"Asana","cost":13.49,"billing_cycle":"monthly","renewal_date":"2026-04-30","category":"Project Management"}'
  '{"name":"Monday.com","cost":20,"billing_cycle":"monthly","renewal_date":"2026-05-05","category":"Project Management"}'
)

for body in "${vendors[@]}"; do
  curl -s -X POST http://localhost:3000/vendors \
    -H "Content-Type: application/json" \
    -d "$body" | python3 -m json.tool
done
```

---

## Deployment

### Environment Variables for Production

```bash
NODE_ENV=production
PORT=8080
DATABASE_PATH=/data/vendor-radar.db   # persistent volume in Docker / Fly.io
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=SG.xxxxxx
ALERT_EMAIL=ops@yourcompany.com
```

### Docker (minimal example)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
```

```bash
docker build -t vendor-radar .
docker run -d \
  -p 8080:8080 \
  -v vendor-radar-data:/data \
  --env-file .env \
  vendor-radar
```

---

## Pricing

Vendor Radar is offered as a hosted SaaS with simple, transparent pricing:

| Plan           | Price          | Users    | Features                                              |
|----------------|----------------|----------|-------------------------------------------------------|
| **Solo**       | $19 / month    | 1        | Unlimited vendors, email alerts, spend analytics      |
| **Team**       | $49 / month    | Up to 10 | Everything in Solo + team access, priority support    |
| **Enterprise** | Custom pricing | Unlimited| SSO, audit log, dedicated instance, SLA               |

All plans include a **14-day free trial** — no credit card required.

---

## Roadmap

- [ ] Multi-user authentication (JWT + refresh tokens)
- [ ] Browser dashboard (React frontend)
- [ ] CSV / spreadsheet import
- [ ] Slack / Teams webhook notifications
- [ ] Vendor contract file attachments
- [ ] Budget threshold alerts
- [ ] Per-seat usage tracking via API integrations

---

## License

MIT — see `LICENSE` for details.
