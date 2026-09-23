FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY incremental.py validate.py reconcile.py ./

# Sem CMD: cada Cloud Run Job define seu proprio entrypoint via --command/--args.
