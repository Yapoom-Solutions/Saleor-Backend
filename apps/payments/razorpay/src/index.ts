import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import crypto from "crypto";
import Razorpay from "razorpay";
import { getTenant, saveTenantToken, saveTenantKeys, deleteTenant } from "./lib/db";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Helper to construct host URLs dynamically
function getAppUrl(req: express.Request): string {
	const host = req.get("host") || `localhost:${PORT}`;
	const proto = req.get("x-forwarded-proto") || "http";
	return `${proto}://${host}`;
}

// 1. GET /api/manifest
app.get("/api/manifest", (req, res) => {
	const appUrl = getAppUrl(req);
	const internalAppUrl = process.env.INTERNAL_APP_URL || "http://razorpay-app:8080";
	const manifest = {
		id: "saleor.payments.razorpay",
		version: "1.0.0",
		name: "Razorpay Payments",
		about: "Custom multi-tenant Razorpay app for Saleor",
		permissions: ["MANAGE_ORDERS", "HANDLE_PAYMENTS", "MANAGE_SETTINGS"],
		appUrl: `${appUrl}/configuration`,
		tokenTargetUrl: `${internalAppUrl}/api/register`,
		extensions: []
	};
	res.json(manifest);
});

// 2. POST /api/register
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

// 3. GET /configuration (serves the settings HTML page)
app.get("/configuration", (req, res) => {
	res.sendFile(path.resolve(__dirname, "../public/configuration.html"));
});

// 4. GET /api/configuration (retrieves current keys)
app.get("/api/configuration", async (req, res) => {
	const domain = req.query.domain as string;
	if (!domain) {
		return res.status(400).json({ error: "Missing domain query parameter" });
	}

	try {
		const tenant = await getTenant(domain);
		if (!tenant) {
			return res.status(404).json({ error: "Tenant not found" });
		}
		res.json({
			razorpay_key_id: tenant.razorpay_key_id || "",
			razorpay_key_secret: tenant.razorpay_key_secret ? "********" : "",
			razorpay_webhook_secret: tenant.razorpay_webhook_secret || ""
		});
	} catch (err) {
		res.status(500).json({ error: "Failed to retrieve configuration" });
	}
});

// 5. POST /api/configuration (saves the keys)
app.post("/api/configuration", async (req, res) => {
	const { domain, razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret } = req.body;
	if (!domain || !razorpay_key_id || !razorpay_key_secret || !razorpay_webhook_secret) {
		return res.status(400).json({ error: "Missing required configuration fields" });
	}

	try {
		await saveTenantKeys(domain, razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret);
		console.log(`Saved Razorpay keys for tenant: ${domain}`);
		res.status(200).json({ success: true });
	} catch (err) {
		res.status(500).json({ error: "Failed to save configuration" });
	}
});

// Helper to extract clean UUID from Base64 checkout ID to fit Razorpay's 56-char receipt limit
function getReceiptId(checkoutId: string): string {
	try {
		const decoded = Buffer.from(checkoutId, "base64").toString("utf-8");
		if (decoded.includes(":")) {
			return decoded.split(":")[1];
		}
	} catch {}
	return checkoutId.substring(0, 40);
}

// 6. POST /api/razorpay/create-order
app.post("/api/razorpay/create-order", async (req, res) => {
	const { domain, checkout_id, amount, currency } = req.body;
	if (!domain || !checkout_id || !amount || !currency) {
		return res.status(400).json({ error: "Missing order creation arguments" });
	}

	try {
		const tenant = await getTenant(domain);
		if (!tenant || !tenant.razorpay_key_id || !tenant.razorpay_key_secret) {
			return res.status(400).json({ error: "Razorpay is not configured for this tenant" });
		}

		// Initialize Razorpay SDK instance for this specific tenant's keys
		const razorpay = new Razorpay({
			key_id: tenant.razorpay_key_id,
			key_secret: tenant.razorpay_key_secret
		});

		// Create Razorpay order (amount in smallest currency unit, e.g., paise for INR, cents for USD)
		const amountInCents = Math.round(parseFloat(amount) * 100);
		const options = {
			amount: amountInCents,
			currency: currency.toUpperCase(),
			receipt: getReceiptId(checkout_id),
			notes: {
				checkout_id,
				domain
			}
		};

		const order = await razorpay.orders.create(options);
		console.log(`Created Razorpay order: ${order.id} for checkout: ${checkout_id} (${domain})`);

		res.status(200).json({
			success: true,
			order_id: order.id,
			amount: order.amount,
			currency: order.currency,
			razorpay_key_id: tenant.razorpay_key_id
		});
	} catch (err: any) {
		console.error("Order creation error:", err);
		res.status(500).json({ error: err.message || "Failed to create order" });
	}
});

// 7. POST /api/razorpay/webhook
app.post("/api/razorpay/webhook", async (req, res) => {
	const signature = req.headers["x-razorpay-signature"] as string;
	const payload = JSON.stringify(req.body);

	// Retrieve domain and checkout_id from order notes inside body payload
	const orderEntity = req.body.payload?.payment?.entity || req.body.payload?.order?.entity;
	const notes = orderEntity?.notes || {};
	const domain = notes.domain;
	const checkoutId = notes.checkout_id;

	if (!domain || !checkoutId) {
		return res.status(400).json({ error: "Invalid webhook payload notes" });
	}

	try {
		const tenant = await getTenant(domain);
		if (!tenant || !tenant.razorpay_webhook_secret || !tenant.saleor_token) {
			return res.status(400).json({ error: "Tenant credentials missing" });
		}

		// Verify signature using tenant's webhook secret
		const expectedSignature = crypto
			.createHmac("sha256", tenant.razorpay_webhook_secret)
			.update(payload)
			.digest("hex");

		if (expectedSignature !== signature) {
			console.warn(`Webhook signature mismatch for tenant: ${domain}`);
			return res.status(400).json({ error: "Invalid signature" });
		}

		const eventType = req.body.event;
		console.log(`Received verified Razorpay event '${eventType}' for checkout ${checkoutId} on ${domain}`);

		if (eventType === "payment.captured") {
			const paymentId = orderEntity.id;
			const amountCaptured = orderEntity.amount / 100; // Smallest unit to main unit
			
			// Call Saleor Core GraphQL to complete the order/transaction
			const completed = await reportTransactionToSaleor(domain, tenant.saleor_token, checkoutId, paymentId, amountCaptured);
			if (completed) {
				console.log(`Successfully completed order for checkout: ${checkoutId}`);
			}
		}

		res.status(200).json({ status: "ok" });
	} catch (err) {
		console.error("Webhook processing error:", err);
		res.status(500).json({ error: "Internal server error" });
	}
});



// Helper: Call Saleor GraphQL to report payment capture and finalize order
async function reportTransactionToSaleor(
	domain: string,
	authToken: string,
	checkoutId: string,
	paymentId: string,
	amount: number
): Promise<boolean> {
	// 1. Get the Checkout's current order ID by running a mutation/query
	// Note: In Saleor, we can use transactionEventReport or checkoutComplete mutations.
	// For simple checkout completion, we will call:
	//   mutation checkoutComplete($checkoutId: ID!) {
	//     checkoutComplete(id: $checkoutId) {
	//       order { id }
	//       errors { message }
	//     }
	//   }
	// Before completing, we want to create a transaction or payment to log the captured cash.
	// For our simplified integration, completing the checkout creates the order:
	const query = `
		mutation CompleteCheckout($checkoutId: ID!) {
			checkoutComplete(id: $checkoutId) {
				order {
					id
					status
				}
				errors {
					field
					message
				}
			}
		}
	`;

	// Send GraphQL request to the specific tenant's endpoint
	const response = await fetch(`http://${domain}/graphql/`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${authToken}`
		},
		body: JSON.stringify({
			query,
			variables: { checkoutId }
		})
	});

	const result = await response.json() as any;
	if (result.errors || (result.data?.checkoutComplete?.errors && result.data.checkoutComplete.errors.length > 0)) {
		console.error("Saleor checkout completion failed:", JSON.stringify(result));
		return false;
	}

	return true;
}

app.listen(PORT, () => {
	console.log(`Razorpay App running on port ${PORT}`);
});
