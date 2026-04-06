'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

/**
 * Calculate the number of days between today and a given date string (YYYY-MM-DD).
 * Returns a negative value if the date is in the past.
 */
function daysUntil(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

/**
 * Attach computed fields to a raw vendor row.
 */
function enrichVendor(vendor) {
  return {
    ...vendor,
    days_until_renewal: daysUntil(vendor.renewal_date),
    monthly_cost: vendor.billing_cycle === 'annual'
      ? parseFloat((vendor.cost / 12).toFixed(2))
      : vendor.cost,
    annual_cost: vendor.billing_cycle === 'annual'
      ? vendor.cost
      : parseFloat((vendor.cost * 12).toFixed(2)),
  };
}

// ─── Alerts ────────────────────────────────────────────────────────────────
// GET /vendors/alerts  — must be registered BEFORE /:id to avoid route conflict
router.get('/alerts', (req, res) => {
  const days = parseInt(req.query.days, 10) || 30;
  const db = getDb();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + days);

  const todayStr  = today.toISOString().slice(0, 10);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT * FROM vendors
    WHERE status = 'active'
      AND renewal_date BETWEEN ? AND ?
    ORDER BY renewal_date ASC
  `).all(todayStr, cutoffStr);

  res.json({
    alert_window_days: days,
    count: rows.length,
    vendors: rows.map(enrichVendor),
  });
});

// ─── List all vendors ───────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { status, category, sort_by = 'renewal_date', order = 'asc' } = req.query;

  const allowed_sort   = ['renewal_date', 'name', 'cost', 'category', 'created_at'];
  const allowed_order  = ['asc', 'desc'];
  const safeSort  = allowed_sort.includes(sort_by)  ? sort_by  : 'renewal_date';
  const safeOrder = allowed_order.includes(order.toLowerCase()) ? order.toUpperCase() : 'ASC';

  const conditions = [];
  const params     = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows  = db.prepare(`SELECT * FROM vendors ${where} ORDER BY ${safeSort} ${safeOrder}`).all(...params);

  res.json({
    count: rows.length,
    vendors: rows.map(enrichVendor),
  });
});

// ─── Get single vendor ──────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vendor not found' });
  res.json(enrichVendor(row));
});

// ─── Create vendor ──────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const {
    name,
    cost,
    billing_cycle = 'monthly',
    renewal_date,
    category = 'Other',
    status = 'active',
    notes = '',
    website = '',
    contact_email = '',
  } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'name is required' });
  }
  if (cost === undefined || cost === null || isNaN(parseFloat(cost))) {
    return res.status(400).json({ error: 'cost must be a valid number' });
  }
  if (!renewal_date || !/^\d{4}-\d{2}-\d{2}$/.test(renewal_date)) {
    return res.status(400).json({ error: 'renewal_date is required in YYYY-MM-DD format' });
  }
  const validCycles  = ['monthly', 'annual', 'quarterly', 'one-time'];
  const validStatuses = ['active', 'inactive', 'cancelled', 'pending'];
  if (!validCycles.includes(billing_cycle)) {
    return res.status(400).json({ error: `billing_cycle must be one of: ${validCycles.join(', ')}` });
  }
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO vendors (name, cost, billing_cycle, renewal_date, category, status, notes, website, contact_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    name.trim(),
    parseFloat(cost),
    billing_cycle,
    renewal_date,
    category.trim(),
    status,
    notes,
    website,
    contact_email,
  );

  const created = db.prepare('SELECT * FROM vendors WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(enrichVendor(created));
});

// ─── Update vendor ──────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const db  = getDb();
  const existing = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Vendor not found' });

  const {
    name          = existing.name,
    cost          = existing.cost,
    billing_cycle = existing.billing_cycle,
    renewal_date  = existing.renewal_date,
    category      = existing.category,
    status        = existing.status,
    notes         = existing.notes,
    website       = existing.website,
    contact_email = existing.contact_email,
  } = req.body;

  if (renewal_date && !/^\d{4}-\d{2}-\d{2}$/.test(renewal_date)) {
    return res.status(400).json({ error: 'renewal_date must be in YYYY-MM-DD format' });
  }

  db.prepare(`
    UPDATE vendors
    SET name = ?, cost = ?, billing_cycle = ?, renewal_date = ?,
        category = ?, status = ?, notes = ?, website = ?, contact_email = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name,
    parseFloat(cost),
    billing_cycle,
    renewal_date,
    category,
    status,
    notes,
    website,
    contact_email,
    req.params.id,
  );

  const updated = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  res.json(enrichVendor(updated));
});

// ─── Delete vendor ──────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Vendor not found' });

  db.prepare('DELETE FROM vendors WHERE id = ?').run(req.params.id);
  res.json({ message: `Vendor "${existing.name}" deleted successfully`, id: existing.id });
});

module.exports = router;
