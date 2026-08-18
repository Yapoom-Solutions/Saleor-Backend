"""A hack to allow safe clearing of the cache in django.contrib.sites.

Since django.contrib.sites may not be thread-safe when there are
multiple instances of the application server, we're patching it with
a thread-safe structure and methods that use it underneath.
"""

import threading

from django.contrib.sites.models import Site, SiteManager
from django.core.exceptions import ImproperlyConfigured
from django.http.request import split_domain_port

lock = threading.Lock()
with lock:
    THREADED_SITE_CACHE: dict[str | int, Site] = {}


def new_get_current(self, request=None):
    from django.conf import settings
    from django.db import connection
    from django.apps import apps as django_apps

    from ..graphql.core.context import get_database_connection_name

    # If we are in a tenant context (schema is not public), we must query the
    # default connection, which has been switched to the correct schema.
    # Otherwise, fallback to the configured replica connection.
    current_schema = getattr(connection, "schema_name", "public")
    db_conn = (
        "default"
        if current_schema != "public"
        else settings.DATABASE_CONNECTION_REPLICA_NAME
    )

    # If the model class is historical (i.e., inside a migration registry),
    # do not use or write to the global site cache.
    is_historical = self.model._meta.apps is not django_apps

    if getattr(settings, "SITE_ID", ""):
        site_id = settings.SITE_ID
        if is_historical:
            return (
                self.prefetch_related("settings")
                .using(db_conn)
                .filter(pk=site_id)[0]
            )
        cache_key = f"{current_schema}:{site_id}"
        if cache_key not in THREADED_SITE_CACHE:
            with lock:
                site = (
                    self.prefetch_related("settings")
                    .using(db_conn)
                    .filter(pk=site_id)[0]
                )
                THREADED_SITE_CACHE[cache_key] = site
        return THREADED_SITE_CACHE[cache_key]
    if request:
        host = request.get_host()
        host_key = f"{current_schema}:{host}"
        try:
            # First attempt to look up the site by host with or without port.
            if is_historical or host_key not in THREADED_SITE_CACHE:
                with lock:
                    # If tenant is active, use db_conn (default), otherwise resolve
                    database_connection_name = (
                        db_conn
                        if current_schema != "public"
                        else get_database_connection_name(request)
                    )
                    site = (
                        self.prefetch_related("settings")
                        .using(database_connection_name)
                        .filter(domain__iexact=host)[0]
                    )
                    if not is_historical:
                        THREADED_SITE_CACHE[host_key] = site
            return THREADED_SITE_CACHE[host_key] if not is_historical else site
        except Site.DoesNotExist:
            # Fallback to looking up site after stripping port from the host.
            domain, dummy_port = split_domain_port(host)
            domain_key = f"{current_schema}:{domain}"
            if is_historical or domain_key not in THREADED_SITE_CACHE:
                with lock:
                    site = (
                        self.prefetch_related("settings")
                        .using(db_conn)
                        .filter(domain__iexact=domain)[0]
                    )
                    if not is_historical:
                        THREADED_SITE_CACHE[domain_key] = site
            return THREADED_SITE_CACHE[domain_key] if not is_historical else site
        return THREADED_SITE_CACHE[domain_key]

    raise ImproperlyConfigured(
        "You're using the Django sites framework without having"
        " set the SITE_ID setting. Create a site in your database and"
        " set the SITE_ID setting or pass a request to"
        " Site.objects.get_current() to fix this error."
    )


def new_clear_cache(self):
    global THREADED_SITE_CACHE
    with lock:
        THREADED_SITE_CACHE = {}


def new_get_by_natural_key(self, domain):
    return self.prefetch_related("settings").filter(domain__iexact=domain)[0]


def patch_contrib_sites():
    SiteManager.get_current = new_get_current  # type: ignore[method-assign] # hack
    SiteManager.clear_cache = new_clear_cache  # type: ignore[method-assign] # hack
    SiteManager.get_by_natural_key = new_get_by_natural_key  # type: ignore[method-assign] # hack # noqa: E501
