#!/bin/sh
# Start Celery in the background
celery -A saleor --app=saleor.celeryconf:app worker --loglevel=info -B &

# Start Uvicorn in the foreground (replacing the shell process)
exec uvicorn saleor.asgi:application --host=0.0.0.0 --port=8000 --workers=1 --lifespan=auto --ws=none --no-server-header --no-access-log
