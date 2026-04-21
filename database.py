"""Database setup for Vendor Radar using SQLite."""
import os
import sqlite3

DB_PATH = os.getenv("DB_PATH", "vendor_radar.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            vendor TEXT NOT NULL,
            cost_monthly REAL NOT NULL,
            billing_cycle TEXT DEFAULT 'monthly',
            renewal_date TEXT NOT NULL,
            category TEXT DEFAULT 'Other',
            owner_email TEXT,
            notes TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS alert_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id INTEGER NOT NULL,
            alert_type TEXT NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_subs_renewal ON subscriptions(renewal_date);
        CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);
    """)
    conn.commit()
    conn.close()
