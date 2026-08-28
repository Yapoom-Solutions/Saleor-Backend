#!/bin/bash
set -e

# Production Domains
PRIMARY_DOMAIN="udayamarketing.in"
TENANT_DOMAIN="santhiyavaathukadai.udayamarketing.in"
TENANT_SCHEMA="tenant_santhiyavaathu"
TENANT_NAME="Santhiyavaathu Kadai"
TENANT_ID="santhiyavaathukadai"
TENANT_SLUG="santhiyavaathukadai"

echo "=========================================================="
echo "🚀 Starting One-Click Saleor Backend Setup on Ubuntu"
echo "=========================================================="

# 1. Check for Docker
if ! [ -x "$(command -v docker)" ]; then
    echo "📦 Installing Docker and Docker Compose..."
    apt-get update
    apt-get install -y docker.io docker-compose-v2
    systemctl start docker
    systemctl enable docker
fi

# 2. Setup environment files if missing
if [ ! -f "common.env" ]; then
    echo "📄 Creating default common.env..."
    cat <<EOF > common.env
DEFAULT_CHANNEL_SLUG=default-channel
HTTP_IP_FILTER_ALLOW_LOOPBACK_IPS=True
HTTP_IP_FILTER_ENABLED=True
EOF
fi

if [ ! -f "backend.env" ]; then
    echo "📄 Creating default backend.env..."
    GEN_SECRET=$(openssl rand -hex 32)
    cat <<EOF > backend.env
CACHE_URL=redis://cache:6379/0
CELERY_BROKER_URL=redis://cache:6379/1
DATABASE_URL=postgres://saleor:saleor@db/saleor
DEFAULT_FROM_EMAIL=noreply@example.com
EMAIL_URL=smtp://mailpit:1025
SECRET_KEY=${GEN_SECRET}
OTEL_SERVICE_NAME=saleor
OTEL_TRACES_EXPORTER=none
HTTP_IP_FILTER_ENABLED=False
EOF
fi

# 3. Start Docker containers
echo "🏗️ Building and launching Docker containers..."
docker compose up --build -d

# 4. Wait for Postgres to be ready
echo "⏳ Waiting for PostgreSQL database to start..."
until docker compose exec -T db pg_isready -U saleor -d saleor >/dev/null 2>&1; do
    sleep 2
done
echo "✅ Database is ready."

# Enable necessary database extensions in pg_catalog so they are available globally to all tenant schemas
echo "🛠️ Enabling database extensions (hstore, pg_trgm, btree_gin) in PostgreSQL..."
docker compose exec -T db psql -U saleor -d saleor -c "ALTER EXTENSION hstore SET SCHEMA pg_catalog;" >/dev/null 2>&1 || docker compose exec -T db psql -U saleor -d saleor -c "CREATE EXTENSION IF NOT EXISTS hstore SCHEMA pg_catalog;"
docker compose exec -T db psql -U saleor -d saleor -c "ALTER EXTENSION pg_trgm SET SCHEMA pg_catalog;" >/dev/null 2>&1 || docker compose exec -T db psql -U saleor -d saleor -c "CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA pg_catalog;"
docker compose exec -T db psql -U saleor -d saleor -c "ALTER EXTENSION btree_gin SET SCHEMA pg_catalog;" >/dev/null 2>&1 || docker compose exec -T db psql -U saleor -d saleor -c "CREATE EXTENSION IF NOT EXISTS btree_gin SCHEMA pg_catalog;"

# 5. Run Database Migrations (Public Schema)
echo "🗄️ Running migrations on public schema..."
docker compose exec -T api python manage.py migrate_schemas --shared

# 6. Initialize Multi-Tenant Routing
echo "🌐 Registering Tenant and Domain details..."
docker compose exec -T api python manage.py shell <<EOF
from saleor.tenants.models import Tenant, Domain

# Create Public Tenant
pub, created = Tenant.objects.get_or_create(
    schema_name="public",
    defaults={
        "name": "Public Schema",
        "tenant_id": "public",
        "slug": "public"
    }
)
Domain.objects.get_or_create(
    domain="${PRIMARY_DOMAIN}",
    defaults={
        "tenant": pub,
        "is_primary": True
    }
)

# Create Store Tenant (without auto-migration to avoid locks)
try:
    store_tenant = Tenant.objects.get(schema_name="${TENANT_SCHEMA}")
except Tenant.DoesNotExist:
    store_tenant = Tenant(
        schema_name="${TENANT_SCHEMA}",
        name="${TENANT_NAME}",
        tenant_id="${TENANT_ID}",
        slug="${TENANT_SLUG}"
    )
    store_tenant.auto_create_schema = False
    store_tenant.save()

# Create Domain
Domain.objects.get_or_create(
    domain="${TENANT_DOMAIN}",
    defaults={
        "tenant": store_tenant,
        "is_primary": True
    }
)
print("SUCCESS: Tenant and Domain saved in public schema.")
EOF

# 7. Create Schema physically
echo "🛠️ Creating schema physically in Postgres..."
docker compose exec -T db psql -U saleor -d saleor -c "CREATE SCHEMA IF NOT EXISTS ${TENANT_SCHEMA};"

# 8. Run Migrations for Store Tenant Schema
echo "🗄️ Running migrations for tenant: ${TENANT_SCHEMA}..."
docker compose exec -T api python manage.py migrate_schemas --schema=${TENANT_SCHEMA}

# 9. Create Superuser for the store tenant
echo "👤 Please configure the Administrator (Superuser) details below:"
docker compose exec api python manage.py tenant_command createsuperuser --schema=${TENANT_SCHEMA}

echo "=========================================================="
echo "🎉 Setup Complete!"
echo "GraphQL API: https://${TENANT_DOMAIN}/graphql/"
echo "Admin Panel: https://${TENANT_DOMAIN}/dashboard/"
echo "=========================================================="
