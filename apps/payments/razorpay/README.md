# Razorpay Payments App

A custom multi-tenant **Saleor App** that integrates **Razorpay** to process checkouts and capture credit card, UPI, net banking, or wallet transactions. It handles webhook callbacks, secure signature verification, and automated order status transitions in Saleor.

---

## 🚀 Features

*   **Multi-Tenant Gateway Mapping**: Distinct merchants can input their specific Razorpay Key IDs and Key Secrets, all saved in isolated namespaces.
*   **Secure Payment Verification**: Verifies HMAC-SHA256 signature tokens sent from client browsers to prevent fraud.
*   **Webhook Handling**: Receives automated payment success notifications directly from Razorpay servers and reconciles checkouts/orders in Saleor.
*   **Dashboard Embedded Admin**: Configures gateway credentials within the Saleor settings dashboard using a premium responsive iframe.

---

## 🗄️ Database Schema

The app uses a persistent SQLite database located at `data/razorpay.db` containing the following table:
*   **`tenant_payment_config`**: Stores the Razorpay Key ID, encrypted Key Secret, webhook secrets, and registered Saleor access tokens per domain.

---

## 🔌 API Endpoints

### 1. Saleor Registry
*   `GET /api/manifest`: Returns the app manifest configuration.
*   `POST /api/register`: Target URL callback invoked by Saleor to register the app and save the access token.

### 2. Transaction Processing
*   `POST /api/razorpay/create-order`: Prepares a Razorpay transaction receipt.
    *   **Payload**: `{ "checkoutId": "...", "amount": 100, "currency": "INR" }`
    *   **Header**: `saleor-domain: <tenant_domain>`
    *   **Response**: `{ "orderId": "rzp_order_XXX" }`
*   `POST /api/razorpay/verify-payment`: Validates signatures and confirms capture.
    *   **Payload**: `{ "orderId": "...", "paymentId": "...", "signature": "...", "checkoutId": "..." }`
    *   **Header**: `saleor-domain: <tenant_domain>`

### 3. Administrator Console
*   `GET /configuration`: Serves the dashboard configuration settings UI.

---

## 🛠️ Deploying & Port Configuration

The Razorpay payment service runs inside Docker Compose on port **`8080`**:

```yaml
  razorpay-app:
    build:
      context: ./apps/payments/razorpay
      dockerfile: Dockerfile
    ports:
      - 8080:8080
    restart: unless-stopped
    volumes:
      - saleor-razorpay-app-db:/app/data
```

### Nginx Routing Setup
Add the following server block to proxy traffic to your subdomain:
```nginx
server {
    listen 443 ssl http2;
    server_name razorpay-app.udayamarketing.in;

    ssl_certificate /etc/letsencrypt/live/udayamarketing.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/udayamarketing.in/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
