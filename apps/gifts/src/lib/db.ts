import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.resolve(__dirname, "../../data");
if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "gifts.db");
const db = new sqlite3.Database(dbPath);

console.log(`Connected to Gifts SQLite database at: ${dbPath}`);

export interface TenantConfig {
	domain: string;
	saleor_token?: string;
	storage_limit_mb: number; // Storage quota limit per tenant
}

export interface CustomizationRecord {
	id: string;
	domain: string;
	order_id: string;
	order_number: string;
	variant_sku: string;
	variant_name: string;
	instructions?: string;
	file_url?: string;
	file_path?: string;
	file_size?: number; // Size in bytes
	created_at: number;
}

export function initDb(): Promise<void> {
	return new Promise((resolve, reject) => {
		db.serialize(() => {
			// 1. Tenant storage limits & token configurations
			db.run(
				`CREATE TABLE IF NOT EXISTS tenant_gifts_config (
					domain TEXT PRIMARY KEY,
					saleor_token TEXT,
					storage_limit_mb INTEGER DEFAULT 2048
				)`,
				(err) => {
					if (err) return reject(err);
				}
			);

			// 2. Customizations record mapping order items to instructions & uploaded files
			db.run(
				`CREATE TABLE IF NOT EXISTS customization_records (
					id TEXT PRIMARY KEY,
					domain TEXT NOT NULL,
					order_id TEXT NOT NULL,
					order_number TEXT NOT NULL,
					variant_sku TEXT,
					variant_name TEXT,
					instructions TEXT,
					file_url TEXT,
					file_path TEXT,
					file_size INTEGER DEFAULT 0,
					created_at INTEGER NOT NULL
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
			"SELECT * FROM tenant_gifts_config WHERE domain = ?",
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
			"INSERT OR IGNORE INTO tenant_gifts_config (domain, saleor_token, storage_limit_mb) VALUES (?, ?, 2048)",
			[domain, token],
			(err) => {
				if (err) return reject(err);
				db.run(
					"UPDATE tenant_gifts_config SET saleor_token = ? WHERE domain = ?",
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

export function saveTenantConfig(domain: string, limitMb: number): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run(
			"INSERT OR IGNORE INTO tenant_gifts_config (domain, saleor_token, storage_limit_mb) VALUES (?, '', ?)",
			[domain, limitMb],
			(err) => {
				if (err) return reject(err);
				db.run(
					"UPDATE tenant_gifts_config SET storage_limit_mb = ? WHERE domain = ?",
					[limitMb, domain],
					(err2) => {
						if (err2) reject(err2);
						else resolve();
					}
				);
			}
		);
	});
}

export function saveCustomization(
	id: string,
	domain: string,
	orderId: string,
	orderNumber: string,
	variantSku: string,
	variantName: string,
	instructions?: string,
	fileUrl?: string,
	filePath?: string,
	fileSize: number = 0
): Promise<void> {
	return new Promise((resolve, reject) => {
		const now = Date.now();
		db.run(
			`INSERT OR REPLACE INTO customization_records 
			(id, domain, order_id, order_number, variant_sku, variant_name, instructions, file_url, file_path, file_size, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, domain, orderId, orderNumber, variantSku, variantName, instructions || "", fileUrl || "", filePath || "", fileSize, now],
			(err) => {
				if (err) reject(err);
				else resolve();
			}
		);
	});
}

export function getCustomizations(domain: string): Promise<CustomizationRecord[]> {
	return new Promise((resolve, reject) => {
		db.all(
			"SELECT * FROM customization_records WHERE domain = ? ORDER BY created_at DESC",
			[domain],
			(err, rows) => {
				if (err) reject(err);
				else resolve((rows as CustomizationRecord[]) || []);
			}
		);
	});
}

export function getCustomization(id: string): Promise<CustomizationRecord | null> {
	return new Promise((resolve, reject) => {
		db.get(
			"SELECT * FROM customization_records WHERE id = ?",
			[id],
			(err, row) => {
				if (err) reject(err);
				else resolve((row as CustomizationRecord) || null);
			}
		);
	});
}

export function deleteCustomization(id: string): Promise<void> {
	return new Promise((resolve, reject) => {
		db.run("DELETE FROM customization_records WHERE id = ?", [id], (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

export function getStorageUsage(domain: string): Promise<number> {
	return new Promise((resolve, reject) => {
		db.get(
			"SELECT SUM(file_size) as total_size FROM customization_records WHERE domain = ?",
			[domain],
			(err, row: any) => {
				if (err) reject(err);
				else resolve(row?.total_size || 0);
			}
		);
	});
}
