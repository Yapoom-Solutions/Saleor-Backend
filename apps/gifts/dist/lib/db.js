"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.getTenantConfig = getTenantConfig;
exports.saveTenantToken = saveTenantToken;
exports.saveTenantConfig = saveTenantConfig;
exports.saveCustomization = saveCustomization;
exports.getCustomizations = getCustomizations;
exports.getCustomization = getCustomization;
exports.deleteCustomization = deleteCustomization;
exports.getStorageUsage = getStorageUsage;
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dataDir = path_1.default.resolve(__dirname, "../../data");
if (!fs_1.default.existsSync(dataDir)) {
    fs_1.default.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path_1.default.join(dataDir, "gifts.db");
const db = new sqlite3_1.default.Database(dbPath);
console.log(`Connected to Gifts SQLite database at: ${dbPath}`);
function initDb() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // 1. Tenant storage limits & token configurations
            db.run(`CREATE TABLE IF NOT EXISTS tenant_gifts_config (
					domain TEXT PRIMARY KEY,
					saleor_token TEXT,
					storage_limit_mb INTEGER DEFAULT 2048
				)`, (err) => {
                if (err)
                    return reject(err);
            });
            // 2. Customizations record mapping order items to instructions & uploaded files
            db.run(`CREATE TABLE IF NOT EXISTS customization_records (
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
				)`, (err) => {
                if (err)
                    return reject(err);
                resolve();
            });
        });
    });
}
function getTenantConfig(domain) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM tenant_gifts_config WHERE domain = ?", [domain], (err, row) => {
            if (err)
                reject(err);
            else
                resolve(row || null);
        });
    });
}
function saveTenantToken(domain, token) {
    return new Promise((resolve, reject) => {
        db.run("INSERT OR IGNORE INTO tenant_gifts_config (domain, saleor_token, storage_limit_mb) VALUES (?, ?, 2048)", [domain, token], (err) => {
            if (err)
                return reject(err);
            db.run("UPDATE tenant_gifts_config SET saleor_token = ? WHERE domain = ?", [token, domain], (err2) => {
                if (err2)
                    reject(err2);
                else
                    resolve();
            });
        });
    });
}
function saveTenantConfig(domain, limitMb) {
    return new Promise((resolve, reject) => {
        db.run("INSERT OR IGNORE INTO tenant_gifts_config (domain, saleor_token, storage_limit_mb) VALUES (?, '', ?)", [domain, limitMb], (err) => {
            if (err)
                return reject(err);
            db.run("UPDATE tenant_gifts_config SET storage_limit_mb = ? WHERE domain = ?", [limitMb, domain], (err2) => {
                if (err2)
                    reject(err2);
                else
                    resolve();
            });
        });
    });
}
function saveCustomization(id, domain, orderId, orderNumber, variantSku, variantName, instructions, fileUrl, filePath, fileSize = 0) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        db.run(`INSERT OR REPLACE INTO customization_records 
			(id, domain, order_id, order_number, variant_sku, variant_name, instructions, file_url, file_path, file_size, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, domain, orderId, orderNumber, variantSku, variantName, instructions || "", fileUrl || "", filePath || "", fileSize, now], (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}
function getCustomizations(domain) {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM customization_records WHERE domain = ? ORDER BY created_at DESC", [domain], (err, rows) => {
            if (err)
                reject(err);
            else
                resolve(rows || []);
        });
    });
}
function getCustomization(id) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM customization_records WHERE id = ?", [id], (err, row) => {
            if (err)
                reject(err);
            else
                resolve(row || null);
        });
    });
}
function deleteCustomization(id) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM customization_records WHERE id = ?", [id], (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}
function getStorageUsage(domain) {
    return new Promise((resolve, reject) => {
        db.get("SELECT SUM(file_size) as total_size FROM customization_records WHERE domain = ?", [domain], (err, row) => {
            if (err)
                reject(err);
            else
                resolve(row?.total_size || 0);
        });
    });
}
