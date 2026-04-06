'use strict';

require('dotenv').config();

const express        = require('express');
const cors           = require('cors');
const { getDb, closeDb }          = require('./db');
const vendorRoutes   = require('./routes/vendors');
const analyticsRoutes = require('./routes/analytics');
const { startAlertScheduler, checkAndSendAlerts } = require('./alerts');

const app  = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ─── Health check ────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  let dbOk = false;
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch (_) {
    dbOk = false;
  }

  const status = dbOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    version:   process.env.npm_package_version || '1.0.0',
    services: {
      database: dbOk ? 'ok' : 'unavailable',
    },
  });
});

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use('/vendors',   vendorRoutes);
app.use('/analytics', analyticsRoutes);

// Manual trigger for alert check (useful for testing / on-demand runs)
app.post('/alerts/trigger', async (req, res) => {
  try {
    const result = await checkAndSendAlerts();
    res.json({ message: 'Alert check complete', result });
  } catch (err) {
    console.error('[server] Alert trigger error:', err.message);
    res.status(500).json({ error: 'Alert check failed', detail: err.message });
  }
});

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    available_routes: [
      'GET    /health',
      'GET    /vendors',
      'POST   /vendors',
      'GET    /vendors/alerts',
      'GET    /vendors/:id',
      'PUT    /vendors/:id',
      'DELETE /vendors/:id',
      'GET    /analytics/spend',
      'GET    /analytics/duplicates',
      'GET    /analytics/overview',
      'POST   /alerts/trigger',
    ],
  });
});

// ─── Global error handler ────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : err.message,
  });
});

// ─── Startup ─────────────────────────────────────────────────────────────────

function start() {
  // Initialise the database (creates the file and schema if needed)
  try {
    getDb();
    console.log('[server] Database initialised successfully.');
  } catch (err) {
    console.error('[server] Failed to initialise database:', err.message);
    process.exit(1);
  }

  // Start the daily renewal-alert cron job
  startAlertScheduler();

  const server = app.listen(PORT, () => {
    console.log(`[server] Vendor Radar is running on http://localhost:${PORT}`);
    console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Graceful shutdown
  function shutdown(signal) {
    console.log(`\n[server] Received ${signal} — shutting down gracefully…`);
    server.close(() => {
      closeDb();
      console.log('[server] Server closed. Goodbye.');
      process.exit(0);
    });

    // Force exit after 10 s if graceful shutdown stalls
    setTimeout(() => {
      console.error('[server] Forced exit after timeout.');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start();

module.exports = app; // exported for testing
