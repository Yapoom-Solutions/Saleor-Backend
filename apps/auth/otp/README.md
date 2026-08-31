# Udaya OTP Authentication App

A custom multi-tenant **Saleor App** that enables customers to register, sign in, or recover their accounts using a **One-Time Password (OTP)** sent to their mobile phone. It integrates with SMS gateways and automates session creation inside the Saleor backend.

---

## 🚀 Features

*   **Multi-Tenant Isolation**: Configuration keys, SMS gateway configurations, and OTP templates are scoped by tenant domain and stored securely.
*   **Secure Code Sessions**: OTP codes are temporarily stored in a SQLite database with expiration rules (e.g. valid for 5 minutes).
*   **Dashboard Integration**: Embeds directly into the Saleor Admin Dashboard settings page via an iframe.
*   **Passwordless Flow**: Generates JWT access/refresh tokens dynamically upon successful verification.

---

## 🗄️ Database Schema

The app uses a persistent SQLite database located at `data/otp.db` containing the following tables:
1.  **`tenant_otp_config`**: Stores SMS API keys, sender ID, templates, and Saleor access tokens per tenant domain.
2.  **`otp_sessions`**: Tracks active OTP request codes, phone numbers, and expiration timestamps.

---

## 🔌 API Endpoints

### 1. Saleor Registry
*   `GET /api/manifest`: Returns the Saleor App Manifest configuration JSON (needed for installation).
*   `POST /api/register`: Target URL callback invoked by Saleor to register the app and save the access token.

### 2. OTP Authentication
*   `POST /api/auth/otp/request`: Triggers the SMS gateway to send a code to the user.
    *   **Payload**: `{ "phone": "+91XXXXXXXXXX" }`
    *   **Header**: `saleor-domain: <tenant_domain>`
*   `POST /api/auth/otp/confirm`: Validates the code and exchanges it for a JWT authentication session from the Saleor API.
    *   **Payload**: `{ "phone": "+91XXXXXXXXXX", "otp": "XXXXXX" }`
    *   **Header**: `saleor-domain: <tenant_domain>`
    *   **Response**: `{ "token": "...", "refreshToken": "..." }`

### 3. Administrator Console
*   `GET /configuration`: Serves the dashboard configuration settings UI.

---

## 🛠️ Deploying & Port Configuration

The OTP app service runs inside Docker Compose on port **`8081`**:

```yaml
  otp-app:
    build:
      context: ./apps/auth/otp
      dockerfile: Dockerfile
    ports:
      - 8081:8081
    restart: unless-stopped
    volumes:
      - saleor-otp-app-db:/app/data
```

### Nginx Routing Setup
Add the following server block to proxy traffic to your subdomain:
```nginx
server {
    listen 443 ssl http2;
    server_name otp-app.udayamarketing.in;

    ssl_certificate /etc/letsencrypt/live/udayamarketing.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/udayamarketing.in/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
