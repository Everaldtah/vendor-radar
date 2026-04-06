'use strict';

const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');

/**
 * Normalize a cost to a monthly figure regardless of billing_cycle.
 */
function toMonthly(cost, billing_cycle) {
  switch (billing_cycle) {
    case 'annual':    return cost / 12;
    case 'quarterly': return cost / 3;
    case 'one-time':  return 0;          // excluded from recurring spend
    case 'monthly':
    default:          return cost;
  }
}

// ─── GET /analytics/spend ────────────────────────────────────────────────────
// Returns monthly and annual spend broken down by category.
router.get('/spend', (req, res) => {
  const db   = getDb();
  const rows = db.prepare(`
    SELECT id, name, cost, billing_cycle, category, status, renewal_date
    FROM vendors
    WHERE status = 'active'
    ORDER BY category ASC, name ASC
  `).all();

  const byCategory = {};
  let totalMonthly = 0;

  for (const row of rows) {
    const monthly = toMonthly(row.cost, row.billing_cycle);
    totalMonthly += monthly;

    if (!byCategory[row.category]) {
      byCategory[row.category] = {
        category: row.category,
        monthly_spend: 0,
        annual_spend: 0,
        vendor_count: 0,
        vendors: [],
      };
    }

    byCategory[row.category].monthly_spend += monthly;
    byCategory[row.category].annual_spend  += monthly * 12;
    byCategory[row.category].vendor_count  += 1;
    byCategory[row.category].vendors.push({
      id:            row.id,
      name:          row.name,
      cost:          row.cost,
      billing_cycle: row.billing_cycle,
      monthly_cost:  parseFloat(monthly.toFixed(2)),
      renewal_date:  row.renewal_date,
    });
  }

  // Round all monetary values
  const categories = Object.values(byCategory).map(cat => ({
    ...cat,
    monthly_spend: parseFloat(cat.monthly_spend.toFixed(2)),
    annual_spend:  parseFloat(cat.annual_spend.toFixed(2)),
  }));

  // Sort by monthly_spend descending (biggest spends first)
  categories.sort((a, b) => b.monthly_spend - a.monthly_spend);

  res.json({
    summary: {
      total_monthly_spend: parseFloat(totalMonthly.toFixed(2)),
      total_annual_spend:  parseFloat((totalMonthly * 12).toFixed(2)),
      active_vendor_count: rows.length,
      category_count:      categories.length,
    },
    by_category: categories,
  });
});

// ─── GET /analytics/duplicates ───────────────────────────────────────────────
// Returns categories that contain more than one active vendor, flagging
// potential overlaps / duplicate tools.
router.get('/duplicates', (req, res) => {
  const db   = getDb();
  const rows = db.prepare(`
    SELECT id, name, cost, billing_cycle, category, notes, renewal_date
    FROM vendors
    WHERE status = 'active'
    ORDER BY category ASC, name ASC
  `).all();

  // Group vendors by category
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row);
  }

  const duplicates = [];
  for (const [category, vendors] of Object.entries(grouped)) {
    if (vendors.length < 2) continue;

    const monthlyCosts = vendors.map(v => toMonthly(v.cost, v.billing_cycle));
    const totalMonthly = monthlyCosts.reduce((a, b) => a + b, 0);

    duplicates.push({
      category,
      vendor_count:      vendors.length,
      total_monthly_cost: parseFloat(totalMonthly.toFixed(2)),
      potential_savings:  parseFloat((totalMonthly - Math.min(...monthlyCosts)).toFixed(2)),
      recommendation:    `You have ${vendors.length} active tools in the "${category}" category. Consider consolidating to reduce costs.`,
      vendors: vendors.map((v, i) => ({
        id:            v.id,
        name:          v.name,
        cost:          v.cost,
        billing_cycle: v.billing_cycle,
        monthly_cost:  parseFloat(monthlyCosts[i].toFixed(2)),
        renewal_date:  v.renewal_date,
        notes:         v.notes,
      })),
    });
  }

  // Sort: most vendors in a category first
  duplicates.sort((a, b) => b.vendor_count - a.vendor_count);

  const totalPotentialSavings = duplicates.reduce((sum, d) => sum + d.potential_savings, 0);

  res.json({
    summary: {
      categories_with_overlap: duplicates.length,
      total_potential_monthly_savings: parseFloat(totalPotentialSavings.toFixed(2)),
      total_potential_annual_savings:  parseFloat((totalPotentialSavings * 12).toFixed(2)),
    },
    overlapping_categories: duplicates,
  });
});

// ─── GET /analytics/overview ─────────────────────────────────────────────────
// High-level dashboard numbers.
router.get('/overview', (req, res) => {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*)                                     AS total_vendors,
      SUM(CASE WHEN status = 'active'    THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'inactive'  THEN 1 ELSE 0 END) AS inactive,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM vendors
  `).get();

  // Renewals in the next 7 / 30 / 90 days
  const today  = new Date();
  today.setHours(0, 0, 0, 0);

  function cutoffStr(days) {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  const todayStr = today.toISOString().slice(0, 10);

  const renewals7  = db.prepare(`SELECT COUNT(*) AS c FROM vendors WHERE status='active' AND renewal_date BETWEEN ? AND ?`).get(todayStr, cutoffStr(7)).c;
  const renewals30 = db.prepare(`SELECT COUNT(*) AS c FROM vendors WHERE status='active' AND renewal_date BETWEEN ? AND ?`).get(todayStr, cutoffStr(30)).c;
  const renewals90 = db.prepare(`SELECT COUNT(*) AS c FROM vendors WHERE status='active' AND renewal_date BETWEEN ? AND ?`).get(todayStr, cutoffStr(90)).c;

  // Spend totals (active only)
  const activeVendors = db.prepare(`SELECT cost, billing_cycle FROM vendors WHERE status = 'active'`).all();
  const totalMonthly  = activeVendors.reduce((sum, v) => sum + toMonthly(v.cost, v.billing_cycle), 0);

  res.json({
    vendor_counts:    totals,
    upcoming_renewals: {
      next_7_days:  renewals7,
      next_30_days: renewals30,
      next_90_days: renewals90,
    },
    spend: {
      total_monthly: parseFloat(totalMonthly.toFixed(2)),
      total_annual:  parseFloat((totalMonthly * 12).toFixed(2)),
    },
  });
});

module.exports = router;
