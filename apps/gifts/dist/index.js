"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("./lib/db");
const storage_1 = require("./lib/storage");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const PORT = process.env.PORT || 8082;
function getAppUrl(req) {
    const host = req.get("host") || `localhost:${PORT}`;
    const proto = req.get("x-forwarded-proto") || "http";
    return `${proto}://${host}`;
}
// 1. GET /api/manifest
app.get("/api/manifest", (req, res) => {
    const appUrl = getAppUrl(req);
    const internalAppUrl = process.env.INTERNAL_APP_URL || "http://gifts-app:8082";
    const manifest = {
        id: "saleor.gifts.customization",
        version: "1.0.0",
        name: "Gift Shop Customizations",
        about: "Custom multi-tenant Gifts customization and storage app for Saleor",
        permissions: ["MANAGE_ORDERS", "MANAGE_SETTINGS"],
        appUrl: `${appUrl}/configuration`,
        tokenTargetUrl: `${internalAppUrl}/api/register`,
        extensions: [],
        webhooks: [
            {
                name: "order-created",
                targetUrl: `${internalAppUrl}/api/webhooks/order-created`,
                events: ["ORDER_CREATED"],
                isActive: true,
                query: `
					subscription {
						event {
							... on OrderCreated {
								order {
									id
									number
									userEmail
									lines {
										id
										variant {
											sku
											name
										}
										metadata {
											key
											value
										}
									}
								}
							}
						}
					}
				`
            }
        ]
    };
    res.json(manifest);
});
// 2. POST /api/register
app.post("/api/register", async (req, res) => {
    const auth_token = req.body.auth_token;
    const saleorApiUrlHeader = req.headers["saleor-api-url"];
    if (!auth_token) {
        console.warn("Register request missing auth_token");
        return res.status(400).json({ error: "Missing auth_token" });
    }
    if (!saleorApiUrlHeader) {
        console.warn("Register request missing saleor-api-url header");
        return res.status(400).json({ error: "Missing saleor-api-url header" });
    }
    let domain = "";
    try {
        const parsed = new URL(saleorApiUrlHeader);
        domain = parsed.host;
    }
    catch {
        domain = saleorApiUrlHeader;
    }
    try {
        await (0, db_1.saveTenantToken)(domain, auth_token);
        console.log(`Successfully registered tenant token for: ${domain}`);
        res.status(200).json({ success: true });
    }
    catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({ error: "Failed to persist registration" });
    }
});
// 3. GET /configuration (serves the admin settings HTML page)
app.get("/configuration", (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, "../public/configuration.html"));
});
// 4. GET /api/configuration (retrieves current keys/limits & customization list)
app.get("/api/configuration", async (req, res) => {
    const domain = req.query.domain;
    if (!domain) {
        return res.status(400).json({ error: "Missing domain query parameter" });
    }
    try {
        const config = await (0, db_1.getTenantConfig)(domain);
        const limitMb = config?.storage_limit_mb || 2048; // Default 2GB
        const usedBytes = await (0, db_1.getStorageUsage)(domain);
        const customizations = await (0, db_1.getCustomizations)(domain);
        res.json({
            storage_limit_mb: limitMb,
            usedBytes,
            customizations
        });
    }
    catch (err) {
        console.error("Failed to fetch configuration:", err);
        res.status(500).json({ error: "Failed to retrieve configuration" });
    }
});
// 5. POST /api/configuration (saves storage limit configuration)
app.post("/api/configuration", async (req, res) => {
    const { domain, storage_limit_mb } = req.body;
    if (!domain || storage_limit_mb === undefined) {
        return res.status(400).json({ error: "Missing required configuration fields" });
    }
    try {
        await (0, db_1.saveTenantConfig)(domain, parseInt(storage_limit_mb, 10));
        res.status(200).json({ success: true });
    }
    catch (err) {
        console.error("Failed to save config:", err);
        res.status(500).json({ error: "Failed to save configuration" });
    }
});
// 6. GET /api/quota-check (storefront checks if there is enough space left to allow uploads)
app.get("/api/quota-check", async (req, res) => {
    const domain = req.query.domain;
    if (!domain) {
        return res.status(400).json({ error: "Missing domain query parameter" });
    }
    try {
        const config = await (0, db_1.getTenantConfig)(domain);
        const limitMb = config?.storage_limit_mb || 2048; // Default 2GB
        const usedBytes = await (0, db_1.getStorageUsage)(domain);
        const limitBytes = limitMb * 1024 * 1024;
        res.json({
            ok: usedBytes < limitBytes,
            usedBytes,
            limitBytes,
            limitMb
        });
    }
    catch (err) {
        console.error("Quota check error:", err);
        res.status(500).json({ error: "Failed to check storage quota" });
    }
});
// 7. POST /api/webhooks/order-created (resolves line metadata & saves file sizes on order placement)
app.post("/api/webhooks/order-created", async (req, res) => {
    const domain = req.headers["saleor-domain"];
    if (!domain) {
        return res.status(400).json({ error: "Missing saleor-domain header" });
    }
    const orderData = req.body?.order || req.body;
    if (!orderData) {
        return res.status(400).json({ error: "Missing order details in payload" });
    }
    // Resolve the correct order parameters depending on webhook version
    const orderId = orderData.id;
    const orderNumber = orderData.number || orderData.userEmail || "N/A";
    const lines = orderData.lines || [];
    try {
        for (const line of lines) {
            const lineId = line.id;
            const variantSku = line.variant?.sku || "";
            const variantName = line.variant?.name || "";
            const metadataList = line.metadata || [];
            let fileUrl = "";
            let instructions = "";
            for (const item of metadataList) {
                if (item.key === "file_url") {
                    fileUrl = item.value;
                }
                else if (item.key === "instructions") {
                    instructions = item.value;
                }
            }
            // If there is no customization, skip saving this line
            if (!fileUrl && !instructions) {
                continue;
            }
            let filePath = "";
            let fileSize = 0;
            if (fileUrl) {
                const resolvedPath = (0, storage_1.getFilePathFromUrl)(fileUrl);
                if (resolvedPath) {
                    filePath = resolvedPath;
                    const stats = (0, storage_1.getFileStats)(resolvedPath);
                    if (stats.exists) {
                        fileSize = stats.size;
                    }
                }
            }
            await (0, db_1.saveCustomization)(lineId, domain, orderId, String(orderNumber), variantSku, variantName, instructions, fileUrl, filePath, fileSize);
        }
        res.status(200).json({ success: true });
    }
    catch (err) {
        console.error("Error processing ORDER_CREATED webhook:", err);
        res.status(500).json({ error: err.message || "Failed to process webhook" });
    }
});
// 8. GET /api/customizations/:id/download (streams file directly from shared media volume)
app.get("/api/customizations/:id/download", async (req, res) => {
    const id = req.params.id;
    try {
        const record = await (0, db_1.getCustomization)(id);
        if (!record || !record.file_path) {
            return res.status(404).send("File customization record not found");
        }
        const filePath = record.file_path;
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).send("File no longer exists on server storage");
        }
        const filename = path_1.default.basename(filePath);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.sendFile(filePath);
    }
    catch (err) {
        console.error("File download error:", err);
        res.status(500).send("Error reading file");
    }
});
// 9. DELETE /api/customizations/:id/file (unlinks file on shared volume and updates quota count)
app.delete("/api/customizations/:id/file", async (req, res) => {
    const id = req.params.id;
    try {
        const record = await (0, db_1.getCustomization)(id);
        if (!record) {
            return res.status(404).json({ error: "Record not found" });
        }
        if (record.file_path) {
            (0, storage_1.deleteFile)(record.file_path);
        }
        // Clear file metadata from DB
        await (0, db_1.saveCustomization)(record.id, record.domain, record.order_id, record.order_number, record.variant_sku, record.variant_name, record.instructions || "", "", // empty URL
        "", // empty path
        0 // 0 size
        );
        res.status(200).json({ success: true });
    }
    catch (err) {
        console.error("File deletion error:", err);
        res.status(500).json({ error: "Failed to delete file" });
    }
});
// Start express server
(0, db_1.initDb)().then(() => {
    app.listen(PORT, () => {
        console.log(`Gifts Customization App is listening on port ${PORT}`);
    });
}).catch((err) => {
    console.error("Database initialization failed:", err);
});
