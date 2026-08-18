from django.contrib import admin

from .models import Domain, Tenant


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("name", "schema_name", "slug", "status", "is_active", "created_on")
    list_filter = ("status", "is_active")
    search_fields = ("name", "schema_name", "slug", "tenant_id")
    readonly_fields = ("schema_name", "created_on", "updated_at")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Domain)
class DomainAdmin(admin.ModelAdmin):
    list_display = ("domain", "tenant", "is_primary")
    list_filter = ("is_primary",)
    search_fields = ("domain", "tenant__name")
