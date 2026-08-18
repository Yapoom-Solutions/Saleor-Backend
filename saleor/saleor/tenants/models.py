"""Tenant and Domain models for django-tenants integration.

The DB columns are determined by the already-applied migrations
(0001_initial + 0002_remove_tenant_api_keys_and_more).
New fields (slug, is_active, updated_at) are added via 0003_*.
"""
from django.db import models
from django_tenants.models import DomainMixin, TenantMixin


class Tenant(TenantMixin):
    """
    A Saleor tenant.  Each tenant gets its own PostgreSQL schema containing
    the full set of Saleor commerce tables.

    schema_name is inherited from TenantMixin (CharField, unique, max_length=63).
    auto_create_schema = True means django-tenants will CREATE SCHEMA automatically
    when a Tenant is saved for the first time.
    """

    #: Human-readable store name.
    name = models.CharField(max_length=100)

    #: Optional external identifier (e.g. subscription system ID).
    tenant_id = models.CharField(max_length=100, unique=True, default="")

    #: Simple lifecycle status; use "active" / "suspended" / "inactive".
    status = models.CharField(max_length=20, default="active")

    #: URL-safe unique identifier — added in migration 0003.
    slug = models.SlugField(max_length=100, unique=True, null=True, blank=True)

    #: Soft-delete / enable-disable flag — added in migration 0003.
    is_active = models.BooleanField(default=True)

    #: Record-creation timestamp (from original migration, kept as-is).
    created_on = models.DateTimeField(auto_now_add=True)

    #: Last-updated timestamp — added in migration 0003.
    updated_at = models.DateTimeField(auto_now=True, null=True)

    auto_create_schema = True

    class Meta:
        app_label = "tenants"

    def __str__(self) -> str:
        return f"{self.name} ({self.schema_name})"


class Domain(DomainMixin):
    """
    Maps a hostname to a Tenant.

    domain    e.g. "acme.localhost"
    is_primary  only one primary domain per tenant (enforced by app logic)
    """

    class Meta:
        app_label = "tenants"

    def __str__(self) -> str:
        flag = " [primary]" if self.is_primary else ""
        return f"{self.domain}{flag} → {self.tenant}"
