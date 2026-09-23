FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY common.py incremental.py backfill.py ./

# Job de sync incremental das operacoes. Credenciais Azure vem do Secret Manager,
# config (workspace/dataset/projeto) vem de env vars do Cloud Run Job.
CMD ["python", "incremental.py"]
