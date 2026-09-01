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

---

## 💻 Storefront GraphQL Integration Guide

The storefront browser interacts exclusively through standard **Saleor GraphQL mutations**, ensuring clean separation and complete multi-tenant security.

### Step 1: Pre-Upload Quota Check (Optional)
Before allowing a customer to upload large assets, query the Gifts app quota endpoint to verify disk space availability:

```javascript
const res = await fetch('https://gifts-app.udayamarketing.in/api/quota-check?domain=santhiyavaathukadai.udayamarketing.in');
const quota = await res.json();

if (!quota.ok) {
  alert('Store storage quota reached. Please contact shop administration.');
}
```

---

### Step 2: Upload Customer File via Saleor GraphQL (`fileUpload`)
Upload the file using Saleor's native `fileUpload` mutation:

```graphql
mutation UploadCustomizationFile($file: Upload!) {
  fileUpload(file: $file) {
    uploadedFile {
      url
      contentType
    }
    errors {
      field
      message
    }
  }
}
```

**JavaScript Example**:
```javascript
const formData = new FormData();
formData.append('operations', JSON.stringify({
  query: `
    mutation UploadCustomizationFile($file: Upload!) {
      fileUpload(file: $file) {
        uploadedFile {
          url
        }
        errors {
          field
          message
        }
      }
    }
  `,
  variables: { file: null }
}));
formData.append('map', JSON.stringify({ '0': ['variables.file'] }));
formData.append('0', fileInput.files[0]);

const response = await fetch('https://santhiyavaathukadai.udayamarketing.in/graphql/', {
  method: 'POST',
  body: formData
});
const result = await response.json();
const uploadedFileUrl = result.data.fileUpload.uploadedFile.url;
```

---

### Step 3: Add Customized Product Variant to Cart (`checkoutLinesAdd`)
Attach the returned `uploadedFileUrl` and customer text instructions as line metadata when adding the variant to the checkout:

```graphql
mutation AddCustomizedItemToCart($checkoutId: ID!, $lines: [CheckoutLineInput!]!) {
  checkoutLinesAdd(checkoutId: $checkoutId, lines: $lines) {
    checkout {
      id
      lines {
        id
        quantity
        variant {
          id
          name
        }
        metadata {
          key
          value
        }
      }
    }
    errors {
      field
      message
    }
  }
}
```

**GraphQL Variables**:
```json
{
  "checkoutId": "Q2hlY2tvdXQ6ZjQ3YTgwYjctZjVjMC00ZDA4LWJkNDEt...",
  "lines": [
    {
      "variantId": "UHJvZHVjdFZhcmlhbnQ6MQ==",
      "quantity": 1,
      "metadata": [
        { "key": "file_url", "value": "https://santhiyavaathukadai.udayamarketing.in/media/file_uploads/greeting_card.png" },
        { "key": "instructions", "value": "Print 'Happy 25th Birthday Anish!' on the wooden frame." }
      ]
    }
  ]
}
```

---

### Step 4: Automatic Order Processing & Admin Dashboard
When the customer completes checkout (`checkoutComplete`), Saleor automatically copies the `CheckoutLine` metadata into the permanent `OrderLine` metadata. The Gifts app webhook intercepts `ORDER_CREATED`, indexes the file path and size, and displays it in the Saleor Dashboard for staff review and file purging.
