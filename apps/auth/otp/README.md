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

---

## 💻 Storefront GraphQL Integration Guide

Customers interact with OTP authentication directly using standard GraphQL mutations against the Saleor GraphQL endpoint (`/graphql/`).

### Step 1: Request OTP (`otpRequest` Mutation)

Call the `otpRequest` mutation passing the customer's phone number:

```graphql
mutation RequestPhoneOTP($phone: String!) {
  otpRequest(phone: $phone) {
    success
    errors {
      field
      message
      code
    }
  }
}
```

**GraphQL Variables**:
```json
{
  "phone": "+919876543210"
}
```

**JavaScript Example**:
```javascript
const response = await fetch('https://santhiyavaathukadai.udayamarketing.in/graphql/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `
      mutation RequestPhoneOTP($phone: String!) {
        otpRequest(phone: $phone) {
          success
          errors {
            message
          }
        }
      }
    `,
    variables: { phone: "+919876543210" }
  })
});
const result = await response.json();
if (result.data.otpRequest.success) {
  console.log('OTP sent successfully to +919876543210');
}
```

---

### Step 2: Confirm OTP & Authenticate User (`otpConfirm` Mutation)

When the user enters the received 6-digit code, call `otpConfirm`. Upon successful verification, Saleor returns the JWT access token and refresh token:

```graphql
mutation ConfirmPhoneOTP($phone: String!, $otp: String!) {
  otpConfirm(phone: $phone, otp: $otp) {
    token
    refreshToken
    csrfToken
    user {
      id
      email
    }
    errors {
      field
      message
      code
    }
  }
}
```

**GraphQL Variables**:
```json
{
  "phone": "+919876543210",
  "otp": "482910"
}
```

**JavaScript Example & Storing Session**:
```javascript
const response = await fetch('https://santhiyavaathukadai.udayamarketing.in/graphql/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `
      mutation ConfirmPhoneOTP($phone: String!, $otp: String!) {
        otpConfirm(phone: $phone, otp: $otp) {
          token
          refreshToken
          user {
            id
            email
          }
          errors {
            message
          }
        }
      }
    `,
    variables: { phone: "+919876543210", otp: "482910" }
  })
});

const result = await response.json();
const { token, refreshToken, user } = result.data.otpConfirm;

// Save token in localStorage or HttpOnly cookie for authenticated storefront requests
localStorage.setItem('auth_token', token);
```

---

### Step 3: Making Authenticated GraphQL Requests

Pass the received JWT token in the `Authorization` header for subsequent storefront operations (checkout, order history, profile):

```javascript
const authenticatedResponse = await fetch('https://santhiyavaathukadai.udayamarketing.in/graphql/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
  },
  body: JSON.stringify({
    query: `
      query GetUserProfile {
        me {
          id
          email
          orders(first: 5) {
            edges {
              node {
                id
                number
              }
            }
          }
        }
      }
    `
  })
});
```

