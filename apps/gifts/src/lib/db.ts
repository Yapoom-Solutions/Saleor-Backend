import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL || "postgres://saleor:saleor@db/saleor";
const pool = new Pool({
	connectionString
});

console.log("Connected to Gifts PostgreSQL client pool");

export interface TenantConfig {
	domain: string;
	saleor_token?: string;
	storage_limit_mb: number;
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
	file_size?: number;
	created_at: number;
}

export async function initDb(): Promise<void> {
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

export async function getTenantConfig(domain: string): Promise<TenantConfig | null> {
	const res = await pool.query(
		"SELECT * FROM gifts_tenant_config WHERE domain = $1",
		[domain]
	);
	return res.rows[0] || null;
}

export async function saveTenantToken(domain: string, token: string): Promise<void> {
	await pool.query(
		`INSERT INTO gifts_tenant_config (domain, saleor_token, storage_limit_mb)
		 VALUES ($1, $2, 2048)
		 ON CONFLICT (domain)
		 DO UPDATE SET saleor_token = EXCLUDED.saleor_token`,
		[domain, token]
	);
}

export async function saveTenantConfig(domain: string, limitMb: number): Promise<void> {
	await pool.query(
		`INSERT INTO gifts_tenant_config (domain, saleor_token, storage_limit_mb)
		 VALUES ($1, '', $2)
		 ON CONFLICT (domain)
		 DO UPDATE SET storage_limit_mb = EXCLUDED.storage_limit_mb`,
		[domain, limitMb]
	);
}

export async function saveCustomization(
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
	const now = Date.now();
	await pool.query(
		`INSERT INTO gifts_customization_records 
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
		 	created_at = EXCLUDED.created_at`,
		[id, domain, orderId, orderNumber, variantSku, variantName, instructions || "", fileUrl || "", filePath || "", fileSize, now]
	);
}

export async function getCustomizations(domain: string): Promise<CustomizationRecord[]> {
	const res = await pool.query(
		"SELECT * FROM gifts_customization_records WHERE domain = $1 ORDER BY created_at DESC",
		[domain]
	);
	
	// Map row results and convert bigints back to numbers
	return res.rows.map((row) => ({
		...row,
		file_size: row.file_size ? parseInt(row.file_size, 10) : 0,
		created_at: parseInt(row.created_at, 10)
	}));
}

export async function getCustomization(id: string): Promise<CustomizationRecord | null> {
	const res = await pool.query(
		"SELECT * FROM gifts_customization_records WHERE id = $1",
		[id]
	);
	
	const row = res.rows[0];
	if (!row) return null;
	
	return {
		...row,
		file_size: row.file_size ? parseInt(row.file_size, 10) : 0,
		created_at: parseInt(row.created_at, 10)
	};
}

export async function deleteCustomization(id: string): Promise<void> {
	await pool.query(
		"DELETE FROM gifts_customization_records WHERE id = $1",
		[id]
	);
}

export async function getStorageUsage(domain: string): Promise<number> {
	const res = await pool.query(
		"SELECT SUM(file_size) as total_size FROM gifts_customization_records WHERE domain = $1",
		[domain]
	);
	const total = res.rows[0]?.total_size;
	return total ? parseInt(total, 10) : 0;
}
export { pool };
