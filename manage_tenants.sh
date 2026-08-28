#!/bin/bash
set -e

# Configuration
DB_USER="saleor"
DB_NAME="saleor"

show_menu() {
    echo "=========================================================="
    echo "🏢 Saleor Multi-Tenant Manager"
    echo "=========================================================="
    echo "1) Create a New Tenant"
    echo "2) Delete an Existing Tenant"
    echo "3) List All Tenants & Domains"
    echo "4) Exit"
    echo "=========================================================="
    read -p "Select an option [1-4]: " OPTION
}

create_tenant() {
    echo ""
    echo "--- 🆕 Create a New Tenant ---"
    
    # 1. Mandatory Schema Name
    read -p "Enter Schema Name [Mandatory] (e.g. tenant_myshop): " SCHEMA_NAME
    if [ -z "$SCHEMA_NAME" ]; then
        echo "❌ Error: Schema Name is mandatory."
        return
    fi
    
    # 2. Mandatory Human-readable Store Name
    read -p "Enter Store Name [Mandatory] (e.g. My Shop): " STORE_NAME
    if [ -z "$STORE_NAME" ]; then
        echo "❌ Error: Store Name is mandatory."
        return
    fi
    
    # 3. Mandatory Tenant ID
    read -p "Enter Unique Tenant ID [Mandatory] (e.g. myshop): " TENANT_ID
    if [ -z "$TENANT_ID" ]; then
        echo "❌ Error: Tenant ID is mandatory."
        return
    fi
    
    # 4. Mandatory Domain
    read -p "Enter Backend Domain [Mandatory] (e.g. myshop.udayamarketing.in): " DOMAIN_NAME
    if [ -z "$DOMAIN_NAME" ]; then
        echo "❌ Error: Domain Name is mandatory."
        return
    fi
    
    # 5. Optional Slug (defaults to Tenant ID)
    read -p "Enter Slug [Optional] (press Enter to use '$TENANT_ID'): " SLUG
    if [ -z "$SLUG" ]; then
        SLUG="$TENANT_ID"
    fi
    
    # 6. Optional Admin User
    CREATE_ADMIN="n"
    read -p "Do you want to create an Admin Superuser for this store? (y/n) [n]: " CREATE_ADMIN
    if [ "$CREATE_ADMIN" = "y" ] || [ "$CREATE_ADMIN" = "Y" ]; then
        read -p "  Admin Email: " ADMIN_EMAIL
        read -s -p "  Admin Password: " ADMIN_PASSWORD
        echo ""
        if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
            echo "⚠️ Email or Password empty. Superuser creation skipped."
            CREATE_ADMIN="n"
        fi
    fi

    # Confirmation
    echo ""
    echo "Summary of actions:"
    echo "  - Schema Name: $SCHEMA_NAME"
    echo "  - Store Name:  $STORE_NAME"
    echo "  - Tenant ID:   $TENANT_ID"
    echo "  - Slug:        $SLUG"
    echo "  - Domain:      $DOMAIN_NAME"
    if [ "$CREATE_ADMIN" = "y" ]; then
        echo "  - Create Admin Account: Yes ($ADMIN_EMAIL)"
    else
        echo "  - Create Admin Account: No"
    fi
    echo ""
    read -p "Do you want to proceed with creation? (y/n): " PROCEED
    if [ "$PROCEED" != "y" ] && [ "$PROCEED" != "Y" ]; then
        echo "❌ Cancelled."
        return
    fi

    echo "🌐 Registering Tenant metadata in public schema..."
    docker compose exec -T api python manage.py shell <<EOF
from saleor.tenants.models import Tenant, Domain

try:
    tenant = Tenant.objects.get(schema_name="${SCHEMA_NAME}")
    print("Tenant already exists in DB.")
except Tenant.DoesNotExist:
    tenant = Tenant(
        schema_name="${SCHEMA_NAME}",
        name="${STORE_NAME}",
        tenant_id="${TENANT_ID}",
        slug="${SLUG}"
    )
    tenant.auto_create_schema = False
    tenant.save()

Domain.objects.get_or_create(
    domain="${DOMAIN_NAME}",
    defaults={
        "tenant": tenant,
        "is_primary": True
    }
)
print("SUCCESS: Tenant registered in public database.")
EOF

    echo "🛠️ Ensuring hstore extension is enabled in pg_catalog..."
    docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS hstore SCHEMA pg_catalog;"

    echo "🛠️ Creating physical schema in PostgreSQL..."
    docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c "CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME};"

    echo "🗄️ Running migrations for tenant: ${SCHEMA_NAME} (this can take 30-40 seconds)..."
    docker compose exec -T api python manage.py migrate_schemas --schema="$SCHEMA_NAME"

    if [ "$CREATE_ADMIN" = "y" ]; then
        echo "👤 Creating Admin Superuser..."
        docker compose exec -T -e DJANGO_SUPERUSER_EMAIL="$ADMIN_EMAIL" -e DJANGO_SUPERUSER_PASSWORD="$ADMIN_PASSWORD" api python manage.py tenant_command createsuperuser --schema="$SCHEMA_NAME" --noinput
    fi

    echo ""
    echo "🎉 Success! Tenant '$SCHEMA_NAME' has been created."
    echo "Dashboard URL: https://$DOMAIN_NAME/dashboard/"
    echo "API URL:       https://$DOMAIN_NAME/graphql/"
    echo ""
}

delete_tenant() {
    echo ""
    echo "--- 🗑️ Delete an Existing Tenant ---"
    read -p "Enter Schema Name to Delete [Mandatory]: " SCHEMA_NAME
    if [ -z "$SCHEMA_NAME" ]; then
        echo "❌ Error: Schema Name is mandatory."
        return
    fi

    if [ "$SCHEMA_NAME" = "public" ]; then
        echo "❌ Error: You cannot delete the public schema."
        return
    fi

    echo "⚠️ ⚠️ ⚠️ WARNING ⚠️ ⚠️ ⚠️"
    echo "This will permanently delete the schema '$SCHEMA_NAME' and ALL its data (products, orders, users)."
    echo "This action is completely IRREVERSIBLE!"
    echo ""
    
    read -p "To confirm deletion, please type the schema name again ('$SCHEMA_NAME'): " CONFIRM_NAME
    if [ "$CONFIRM_NAME" != "$SCHEMA_NAME" ]; then
        echo "❌ Confirmation name does not match. Deletion cancelled."
        return
    fi

    echo "🗑️ Dropping schema in PostgreSQL..."
    docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE;"

    echo "🌐 Removing Tenant metadata from public database..."
    docker compose exec -T api python manage.py shell <<EOF
from saleor.tenants.models import Tenant
Tenant.objects.filter(schema_name="${SCHEMA_NAME}").delete()
print("SUCCESS: Tenant metadata removed from DB.")
EOF

    echo ""
    echo "🗑️ Tenant '$SCHEMA_NAME' has been completely deleted."
    echo ""
}

list_tenants() {
    echo ""
    echo "--- 📋 List of Active Tenants ---"
    docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT id, schema_name, name, status, created_on FROM tenants_tenant;"
    echo ""
    echo "--- 📋 List of Mapped Domains ---"
    docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT id, domain, is_primary, tenant_id FROM tenants_domain;"
    echo ""
}

# Main Loop
while true; do
    show_menu
    case $OPTION in
        1) create_tenant ;;
        2) delete_tenant ;;
        3) list_tenants ;;
        4) echo "Goodbye!"; exit 0 ;;
        *) echo "❌ Invalid option. Please select 1-4." ;;
    esac
done
