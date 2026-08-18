"""
Migration 0003 — Add slug, is_active, updated_at to the Tenant model.

These fields were not present in the original schema (0001 + 0002) but are
required by the current model definition to satisfy the user specification.

slug       — SlugField, unique, nullable for backwards compatibility during
             the first migrate_schemas run; populate then add NOT NULL if needed.
is_active  — BooleanField, default True (all existing rows become active).
updated_at — DateTimeField auto_now, nullable so the column is safe to add
             to rows that were created before this migration.
"""

import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tenants", "0002_remove_tenant_api_keys_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenant",
            name="slug",
            field=models.SlugField(max_length=100, null=True, blank=True, unique=True),
        ),
        migrations.AddField(
            model_name="tenant",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="tenant",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, null=True),
        ),
    ]
