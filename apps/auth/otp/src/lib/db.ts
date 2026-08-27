import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.resolve(__dirname, "../../data");
if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "otp.db");
const db = new sqlite3.Database(dbPath);

console.log(`Connected to OTP SQLite database at: ${dbPath}`);

export interface TenantConfig {
	domain: string;
	saleor_token?: string;
	apikey: string;
	senderid: string;
	template: string;
}

export interface OtpSession {
	phone: string;
	code: string;
	expires_at: number;
}

export function initDb(): Promise<void> {
	return new Promise((resolve, reject) => {
		db.serialize(() => {
			// 1. Tenant OTP provider credentials/settings
			db.run(
				`CREATE TABLE IF NOT EXISTS tenant_otp_config (
					domain TEXT PRIMARY KEY,
					saleor_token TEXT,
					apikey TEXT,
					senderid TEXT,
					template TEXT
				)`,
				(err) => {
					if (err) return reject(err);
				}
			);

			// 2. Currently active OTP codes and their expirations
			db.run(
				`CREATE TABLE IF NOT EXISTS otp_sessions (
					phone TEXT PRIMARY KEY,
					code TEXT NOT NULL,
					expires_at INTEGER NOT NULL
				)`,
				(err) => {
					if (err) return reject(err);
					resolve();
				}
			);
		});
	});
}

export function getTenantConfig(domain: string): Promise<TenantConfig | null> {
	return new Promise((resolve, reject) => {
		db.get(
			"SELECT * FROM tenant_otp_config WHERE domain = ?",
			[domain],
			(err, row) => {
				if (err) reject(err);
				else resolve((row as TenantConfig) || null);
			}
		);
	});
}

export function saveTenantToken(domain: string, token: string): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run(
			"INSERT OR IGNORE INTO tenant_otp_config (domain, saleor_token, apikey, senderid, template) VALUES (?, ?, '', '', '')",
			[domain, token],
			(err) => {
				if (err) return reject(err);
				db.run(
					"UPDATE tenant_otp_config SET saleor_token = ? WHERE domain = ?",
					[token, domain],
					(err2) => {
						if (err2) reject(err2);
						else resolve();
					}
				);
			}
		);
	});
}

export function saveTenantConfig(
	domain: string,
	apikey: string,
	senderid: string,
	template: string
): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run(
			"INSERT OR IGNORE INTO tenant_otp_config (domain, saleor_token, apikey, senderid, template) VALUES (?, '', '', '', '')",
			[domain],
			(err) => {
				if (err) return reject(err);
				db.run(
					"UPDATE tenant_otp_config SET apikey = ?, senderid = ?, template = ? WHERE domain = ?",
					[apikey, senderid, template, domain],
					(err2) => {
						if (err2) reject(err2);
						else resolve();
					}
				);
			}
		);
	});
}

export function saveOtpSession(phone: string, code: string, expiresAt: number): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run(
			"INSERT OR REPLACE INTO otp_sessions (phone, code, expires_at) VALUES (?, ?, ?)",
			[phone, code, expiresAt],
			(err) => {
				if (err) reject(err);
				else resolve();
			}
		);
	});
}

export function getOtpSession(phone: string): Promise<OtpSession | null> {
	return new Promise((resolve, reject) => {
		db.get(
			"SELECT * FROM otp_sessions WHERE phone = ?",
			[phone],
			(err, row) => {
				if (err) reject(err);
				else resolve((row as OtpSession) || null);
			}
		);
	});
}

export function deleteOtpSession(phone: string): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run("DELETE FROM otp_sessions WHERE phone = ?", [phone], (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}
