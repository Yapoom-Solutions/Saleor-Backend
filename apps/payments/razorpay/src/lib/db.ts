import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.resolve(__dirname, "../../data");
if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.resolve(dataDir, "app.db");

// Initialize database
const db = new sqlite3.Database(dbPath, (err) => {
	if (err) {
		console.error("Error opening database:", err);
	} else {
		console.log("Connected to SQLite database at:", dbPath);
	}
});

// Create tables
db.serialize(() => {
	db.run(`
		CREATE TABLE IF NOT EXISTS tenants (
			domain TEXT PRIMARY KEY,
			saleor_token TEXT,
			razorpay_key_id TEXT,
			razorpay_key_secret TEXT,
			razorpay_webhook_secret TEXT
		)
	`, (err) => {
		if (err) {
			console.error("Error creating tenants table:", err);
		}
	});
});

export interface TenantRow {
	domain: string;
	saleor_token?: string;
	razorpay_key_id?: string;
	razorpay_key_secret?: string;
	razorpay_webhook_secret?: string;
}

export function getTenant(domain: string): Promise<TenantRow | null> {
	return new Promise((resolve, reject) => {
		db.get("SELECT * FROM tenants WHERE domain = ?", [domain], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve((row as TenantRow) || null);
			}
		});
	});
}

export function saveTenantToken(domain: string, token: string): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run(
			`INSERT INTO tenants (domain, saleor_token) 
			 VALUES (?, ?) 
			 ON CONFLICT(domain) DO UPDATE SET saleor_token = excluded.saleor_token`,
			[domain, token],
			(err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			}
		);
	});
}

export function saveTenantKeys(
	domain: string,
	keyId: string,
	keySecret: string,
	webhookSecret: string
): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run(
			`INSERT INTO tenants (domain, razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret) 
			 VALUES (?, ?, ?, ?) 
			 ON CONFLICT(domain) DO UPDATE SET 
				razorpay_key_id = excluded.razorpay_key_id,
				razorpay_key_secret = excluded.razorpay_key_secret,
				razorpay_webhook_secret = excluded.razorpay_webhook_secret`,
			[domain, keyId, keySecret, webhookSecret],
			(err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			}
		);
	});
}

export function deleteTenant(domain: string): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run("DELETE FROM tenants WHERE domain = ?", [domain], (err) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}
