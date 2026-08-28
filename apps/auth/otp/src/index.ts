import express from "express";
import fetch from "node-fetch";
import path from "path";
import {
	initDb,
	getTenantConfig,
	saveTenantConfig,
	saveTenantToken,
	saveOtpSession,
	getOtpSession,
	deleteOtpSession
} from "./lib/db";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8081;

// Default fallbacks provided by the user
const DEFAULT_API_KEY = "e9TZX5FJ7RDzrgrP";
const DEFAULT_SENDER_ID = "MYDTEH";
const DEFAULT_TEMPLATE = "Use OTP {#var#} to log in to your Account. Never share your OTP with anyone . Support contact: {#var#} - My Dreams";

// 1. GET /api/manifest (returns the Saleor App Manifest URL)
app.get("/api/manifest", (req, res) => {
	const appUrl = getAppUrl(req);
	const manifest = {
		id: "saleor.auth.otp",
		version: "1.0.0",
		name: "Udaya OTP Authentication",
		about: "Custom multi-tenant OTP App for Saleor using Udaya SMS Gateway",
		permissions: ["MANAGE_USERS", "MANAGE_SETTINGS"],
		appUrl: `${appUrl}/configuration`,
		tokenTargetUrl: `${appUrl}/api/register`,
		extensions: []
	};
	res.json(manifest);
});

// 2. POST /api/register (handles app registration callback from Saleor Core)
app.post("/api/register", async (req, res) => {
	const auth_token = req.body.auth_token;
	const saleorApiUrlHeader = req.headers["saleor-api-url"] as string;

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
	} catch {
		domain = saleorApiUrlHeader;
	}

	try {
		await saveTenantToken(domain, auth_token);
		console.log(`Successfully registered tenant token for: ${domain}`);
		res.status(200).json({ success: true });
	} catch (err) {
		console.error("Registration error:", err);
		res.status(500).json({ error: "Failed to persist registration" });
	}
});

// 3. GET /configuration (serves the HTML settings page)
app.get("/configuration", (req, res) => {
	res.sendFile(path.resolve(__dirname, "../public/configuration.html"));
});

// 4. POST /api/configuration (saves settings per tenant domain)
app.post("/api/configuration", async (req, res) => {
	const { domain, apikey, senderid, template } = req.body;
	if (!domain || !apikey || !senderid || !template) {
		return res.status(400).json({ error: "Missing configuration fields" });
	}

	try {
		await saveTenantConfig(domain, apikey, senderid, template);
		console.log(`Saved OTP configuration for domain: ${domain}`);
		res.status(200).json({ success: true });
	} catch (err: any) {
		res.status(500).json({ error: err.message || "Failed to save configuration" });
	}
});

// 5. GET /api/configuration (retrieves config for admin dashboard UI)
app.get("/api/configuration", async (req, res) => {
	const domain = req.query.domain as string;
	if (!domain) {
		return res.status(400).json({ error: "Missing domain query parameter" });
	}

	try {
		const config = await getTenantConfig(domain);
		res.status(200).json(config || {
			domain,
			apikey: DEFAULT_API_KEY,
			senderid: DEFAULT_SENDER_ID,
			template: DEFAULT_TEMPLATE
		});
	} catch (err: any) {
		res.status(500).json({ error: err.message || "Failed to retrieve configuration" });
	}
});

// 6. POST /api/request-otp (sends the OTP code via Udaya SMS API)
app.post("/api/request-otp", async (req, res) => {
	const { phone, domain } = req.body;
	if (!phone || !domain) {
		return res.status(400).json({ error: "Missing phone or domain parameter" });
	}

	try {
		// Lookup tenant config or fallback to defaults
		const config = await getTenantConfig(domain) || {
			domain,
			apikey: DEFAULT_API_KEY,
			senderid: DEFAULT_SENDER_ID,
			template: DEFAULT_TEMPLATE
		};

		// Generate random 6-digit OTP code
		const code = Math.floor(100000 + Math.random() * 900000).toString();
		const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

		await saveOtpSession(phone, code, expiresAt);

		// Format SMS message replacing {#var#} placeholders
		let message = config.template;
		message = message.replace("{#var#}", code); // First replaces code
		message = message.replace("{#var#}", "9999999999"); // Second replaces support phone

		// Compile Udaya GET query URL
		const encodedMessage = encodeURIComponent(message);
		const smsUrl = `http://app.mydreamstechnology.in/vb/apikey.php?apikey=${config.apikey}&senderid=${config.senderid}&number=${phone}&message=${encodedMessage}`;

		console.log(`[OTP Request] Generated code: ${code} for phone: ${phone} (${domain})`);
		console.log(`[OTP Request] Dispatching SMS payload: ${smsUrl}`);

		const smsResponse = await fetch(smsUrl, { method: "GET" });
		const smsResult = await smsResponse.text();
		
		console.log(`[OTP Request] SMS Gateway response: ${smsResult}`);

		res.status(200).json({ success: true });
	} catch (err: any) {
		console.error("[OTP Request] Error sending OTP:", err);
		res.status(500).json({ error: err.message || "Failed to send OTP" });
	}
});

// 7. POST /api/verify-otp (validates the OTP code)
app.post("/api/verify-otp", async (req, res) => {
	const { phone, otp, domain } = req.body;
	if (!phone || !otp || !domain) {
		return res.status(400).json({ error: "Missing phone, otp, or domain parameter" });
	}

	try {
		const session = await getOtpSession(phone);
		if (!session) {
			return res.status(400).json({ error: "No active OTP request found for this phone number" });
		}

		if (Date.now() > session.expires_at) {
			await deleteOtpSession(phone);
			return res.status(400).json({ error: "OTP code has expired. Please request a new one." });
		}

		if (session.code !== otp) {
			return res.status(400).json({ error: "Invalid OTP code. Please try again." });
		}

		// Success: Clean up verified session
		await deleteOtpSession(phone);
		console.log(`[OTP Verify] Successfully verified phone: ${phone} (${domain})`);
		res.status(200).json({ success: true });
	} catch (err: any) {
		console.error("[OTP Verify] Error verifying OTP:", err);
		res.status(500).json({ error: err.message || "Failed to verify OTP" });
	}
});

// Start server after database initialization
initDb()
	.then(() => {
		app.listen(PORT, () => {
			console.log(`OTP Extension service running on port ${PORT}`);
		});
	})
	.catch((err) => {
		console.error("Failed to initialize database:", err);
	});
