import logging
import os

from celery import Celery
from celery.signals import setup_logging, worker_process_init, before_task_publish, task_prerun
from django.conf import settings
from django.db import connection

from .core.telemetry import initialize_telemetry
from .plugins import discover_plugins_modules

CELERY_LOGGER_NAME = "celery"


@setup_logging.connect
def setup_celery_logging(loglevel=None, **kwargs):
    """Skip default Celery logging configuration.

    Will rely on Django to set up the base root logger.
    Celery loglevel will be set if provided as Celery command argument.
    """
    if loglevel:
        logging.getLogger(CELERY_LOGGER_NAME).setLevel(loglevel)


@worker_process_init.connect(weak=False)
def init_celery_telemetry(*args, **kwargs):
    initialize_telemetry()


# --- Multi-Tenant Celery Signal Listeners -----------------------------------

@before_task_publish.connect
def tenant_before_task_publish(headers=None, **kwargs):
    """Captures the current active schema name and injects it into task headers."""
    if headers:
        headers["tenant_schema"] = getattr(connection, "schema_name", "public")


@task_prerun.connect
def tenant_task_prerun(task=None, **kwargs):
    """Before executing a task on the worker, switch search_path to the tenant."""
    schema_name = "public"
    if task and task.request:
        headers = getattr(task.request, "headers", None) or {}
        schema_name = headers.get("tenant_schema") or getattr(task.request, "tenant_schema", "public")
    
    connection.set_schema(schema_name)


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "saleor.settings")

app = Celery("saleor", task_cls="saleor.core.tasks:RestrictWriterDBTask")

app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
app.autodiscover_tasks(
    packages=[
        "saleor.account.migrations.tasks",
        "saleor.order.migrations.tasks",
        "saleor.app.migrations.tasks",
        "saleor.checkout.migrations.tasks",
        "saleor.product.migrations.tasks",
    ],
    related_name="saleor3_23",
)
app.autodiscover_tasks(
    packages=[
        "saleor.order.migrations.tasks",
        "saleor.account.migrations.tasks",
        "saleor.attribute.migrations.tasks",
        "saleor.channel.migrations.tasks",
        "saleor.giftcard.migrations.tasks",
    ],
    related_name="saleor3_22",
)
app.autodiscover_tasks(
    packages=[
        "saleor.checkout.migrations.tasks",
    ],
    related_name="saleor3_21",
)
app.autodiscover_tasks(
    packages=[
        "saleor.checkout.migrations.tasks",
        "saleor.order.migrations.tasks",
    ],
    related_name="saleor3_20",
)
app.autodiscover_tasks(lambda: discover_plugins_modules(settings.PLUGINS))
app.autodiscover_tasks(related_name="search_tasks")
