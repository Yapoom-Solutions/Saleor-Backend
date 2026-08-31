# Gifts Customization & Space Purger App

A custom multi-tenant **Saleor App** that allows customers to specify personal instructions and attach file uploads (greetings, images, card designs) to order lines. It monitors server storage space quotas per tenant and provides an interface for shop administrators to download files or permanently purge them to reclaim disk space.

---

## 🚀 Features

*   **GraphQL-Only Storefront Integration**: The customer browser never calls the app API directly. It uploads files using Saleor's native `fileUpload` mutation and attaches URL and text instructions to `CheckoutLine` metadata, which Saleor automatically duplicates to the `OrderLine` during checkout completion.
*   **Shared Volume Architecture**: Shares the persistent media folder (`./saleor/media`) with the Saleor API container to read file sizes and physically delete/purge files directly.
*   **Space Quota Limiting**: Monitors cumulative disk usage per tenant and enforces custom limits (e.g. 2 GB). Prevents storefront checkout items if the store quota is reached.
*   **Admin Purging Dashboard**: Features an iframe control board to review custom items, stream media downloads, and permanently erase files.

---

## 🗄️ Database Schema

The app uses a persistent SQLite database located at `data/gifts.db` containing the following tables:
1.  **`tenant_gifts_config`**: Stores registered Saleor access tokens and customized storage limit quotas (in MB) per tenant.
2.  **`customization_records`**: Records metadata details, product SKU/name, customer instructions, file paths, and sizes in bytes per order line item.

---

## 🔌 API Endpoints

### 1. Saleor Registry & Webhooks
*   `GET /api/manifest`: Returns the Saleor App manifest with a subscription payload for the `ORDER_CREATED` event webhook.
*   `POST /api/register`: Registry callback invoked by Saleor to save the access token.
*   `POST /api/webhooks/order-created`: Webhook handler parsing custom lines. Checks files on the shared media disk and records their size.

### 2. Space & Media Control
*   `GET /api/quota-check`: Returns space metrics.
    *   **Query Params**: `?domain=santhiyavaathukadai.udayamarketing.in`
    *   **Response**: `{ "ok": true, "usedBytes": 10240, "limitBytes": 2147483648, "limitMb": 2048 }`
*   `GET /api/customizations/:id/download`: Streams file downloads directly from the shared `/app/media/` folder.
*   `DELETE /api/customizations/:id/file`: Erases the file from disk and releases space.

---

## 🛠️ Deploying & Port Configuration

The Gifts app service runs inside Docker Compose on port **`8082`** and mounts the shared media volume:

```yaml
  gifts-app:
    build:
      context: ./apps/gifts
      dockerfile: Dockerfile
    ports:
      - 8082:8082
    restart: unless-stopped
    volumes:
      - saleor-gifts-app-db:/app/data
      - ./saleor/media:/app/media:rw   # Shared media directory mount
```

### Nginx Routing Setup
Add the following server block to proxy traffic to your subdomain:
```nginx
server {
    listen 443 ssl http2;
    server_name gifts-app.udayamarketing.in;

    ssl_certificate /etc/letsencrypt/live/udayamarketing.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/udayamarketing.in/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
