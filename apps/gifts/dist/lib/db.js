"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initDb = initDb;
exports.getTenantConfig = getTenantConfig;
exports.saveTenantToken = saveTenantToken;
exports.saveTenantConfig = saveTenantConfig;
exports.saveCustomization = saveCustomization;
exports.getCustomizations = getCustomizations;
exports.getCustomization = getCustomization;
exports.deleteCustomization = deleteCustomization;
exports.getStorageUsage = getStorageUsage;
const pg_1 = require("pg");
const connectionString = process.env.DATABASE_URL || "postgres://saleor:saleor@db/saleor";
const pool = new pg_1.Pool({
    connectionString
});
exports.pool = pool;
console.log("Connected to Gifts PostgreSQL client pool");
async function initDb() {
    // Create table for storing merchant configurations
    await pool.query(`
		CREATE TABLE IF NOT EXISTS gifts_tenant_config (
			domain VARCHAR(255) PRIMARY KEY,
			saleor_token TEXT,
			storage_limit_mb INTEGER DEFAULT 2048
		)
	`);
    // Create table for tracking gift item customization metadata and uploaded assets
    await pool.query(`
		CREATE TABLE IF NOT EXISTS gifts_customization_records (
			id VARCHAR(255) PRIMARY KEY,
			domain VARCHAR(255) NOT NULL,
			order_id VARCHAR(255) NOT NULL,
			order_number VARCHAR(255) NOT NULL,
			variant_sku VARCHAR(255),
			variant_name VARCHAR(255),
			instructions TEXT,
			file_url TEXT,
			file_path TEXT,
			file_size BIGINT DEFAULT 0,
			created_at BIGINT NOT NULL
		)
	`);
}
async function getTenantConfig(domain) {
    const res = await pool.query("SELECT * FROM gifts_tenant_config WHERE domain = $1", [domain]);
    return res.rows[0] || null;
}
async function saveTenantToken(domain, token) {
    await pool.query(`INSERT INTO gifts_tenant_config (domain, saleor_token, storage_limit_mb)
		 VALUES ($1, $2, 2048)
		 ON CONFLICT (domain)
		 DO UPDATE SET saleor_token = EXCLUDED.saleor_token`, [domain, token]);
}
async function saveTenantConfig(domain, limitMb) {
    await pool.query(`INSERT INTO gifts_tenant_config (domain, saleor_token, storage_limit_mb)
		 VALUES ($1, '', $2)
		 ON CONFLICT (domain)
		 DO UPDATE SET storage_limit_mb = EXCLUDED.storage_limit_mb`, [domain, limitMb]);
}
async function saveCustomization(id, domain, orderId, orderNumber, variantSku, variantName, instructions, fileUrl, filePath, fileSize = 0) {
    const now = Date.now();
    await pool.query(`INSERT INTO gifts_customization_records 
		 (id, domain, order_id, order_number, variant_sku, variant_name, instructions, file_url, file_path, file_size, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 ON CONFLICT (id)
		 DO UPDATE SET 
		 	domain = EXCLUDED.domain,
		 	order_id = EXCLUDED.order_id,
		 	order_number = EXCLUDED.order_number,
		 	variant_sku = EXCLUDED.variant_sku,
		 	variant_name = EXCLUDED.variant_name,
		 	instructions = EXCLUDED.instructions,
		 	file_url = EXCLUDED.file_url,
		 	file_path = EXCLUDED.file_path,
		 	file_size = EXCLUDED.file_size,
		 	created_at = EXCLUDED.created_at`, [id, domain, orderId, orderNumber, variantSku, variantName, instructions || "", fileUrl || "", filePath || "", fileSize, now]);
}
async function getCustomizations(domain) {
    const res = await pool.query("SELECT * FROM gifts_customization_records WHERE domain = $1 ORDER BY created_at DESC", [domain]);
    // Map row results and convert bigints back to numbers
    return res.rows.map((row) => ({
        ...row,
        file_size: row.file_size ? parseInt(row.file_size, 10) : 0,
        created_at: parseInt(row.created_at, 10)
    }));
}
async function getCustomization(id) {
    const res = await pool.query("SELECT * FROM gifts_customization_records WHERE id = $1", [id]);
    const row = res.rows[0];
    if (!row)
        return null;
    return {
        ...row,
        file_size: row.file_size ? parseInt(row.file_size, 10) : 0,
        created_at: parseInt(row.created_at, 10)
    };
}
async function deleteCustomization(id) {
    await pool.query("DELETE FROM gifts_customization_records WHERE id = $1", [id]);
}
async function getStorageUsage(domain) {
    const res = await pool.query("SELECT SUM(file_size) as total_size FROM gifts_customization_records WHERE domain = $1", [domain]);
    const total = res.rows[0]?.total_size;
    return total ? parseInt(total, 10) : 0;
}
