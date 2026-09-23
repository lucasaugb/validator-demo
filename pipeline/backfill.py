"""
Backfill: dump completo da tabela `transactions` do modelo Fabric pro BigQuery.

- Paginacao por `id` ASC (50k por chamada, abaixo dos limites do executeQueries).
- Normaliza nomes de coluna: `transactions[createdAt BRT - copy]` -> `created_at_brt_copy`.
- Calcula `created_date_brt` (date) pra particionamento.
- Carrega em validator-demo-project.origem.source_transactions com WRITE_TRUNCATE.
- Particionada por `created_date_brt`, clusterizada por `from_user_id, id`.

Roda uma vez. Pra atualizacoes incrementais, ver `incremental.py` (Fase 5).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time

import msal
import pandas as pd
import requests
from dotenv import load_dotenv
from google.cloud import bigquery

PAGE_SIZE = 50_000
TARGET_TABLE = "source_transactions"


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"[ERRO] Variavel {name} nao definida em .env.local")
    return value


def get_token(tenant: str, client_id: str, client_secret: str) -> str:
    app = msal.ConfidentialClientApplication(
        client_id,
        authority=f"https://login.microsoftonline.com/{tenant}",
        client_credential=client_secret,
    )
    result = app.acquire_token_for_client(
        scopes=["https://analysis.windows.net/powerbi/api/.default"]
    )
    if "access_token" not in result:
        sys.exit(f"[ERRO] Token: {json.dumps(result, indent=2)}")
    return result["access_token"]


def execute_dax(token: str, workspace: str, dataset: str, dax: str) -> list[dict]:
    url = (
        f"https://api.powerbi.com/v1.0/myorg/groups/{workspace}"
        f"/datasets/{dataset}/executeQueries"
    )
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "queries": [{"query": dax}],
            "serializerSettings": {"includeNulls": True},
        },
        timeout=300,
    )
    if response.status_code != 200:
        sys.exit(
            f"[ERRO] HTTP {response.status_code}:\n{response.text[:2000]}"
        )
    return response.json()["results"][0]["tables"][0]["rows"]


def fetch_all(
    token: str, workspace: str, dataset: str, table: str, page_size: int
) -> list[dict]:
    """
    Pagina por id ASC ate o response vir vazio.

    Importante: NAO usar `len(rows) < page_size` como sinal de fim, a API trunca
    antes do TOPN baseado em tamanho de payload, entao paginas podem vir menores
    que page_size no meio do dump. So o response vazio indica fim de verdade.
    """
    all_rows: list[dict] = []
    last_id = -1
    page = 0
    id_col = f"{table}[id]"
    while True:
        page += 1
        dax = (
            f"EVALUATE\n"
            f"TOPN(\n"
            f"    {page_size},\n"
            f"    FILTER('{table}', '{table}'[id] > {last_id}),\n"
            f"    '{table}'[id], ASC\n"
            f")\n"
            f"ORDER BY '{table}'[id] ASC"
        )
        t0 = time.time()
        rows = execute_dax(token, workspace, dataset, dax)
        elapsed = time.time() - t0
        if not rows:
            break
        new_last_id = max(int(r[id_col]) for r in rows)
        if new_last_id == last_id:
            sys.exit(
                f"[ERRO] paginacao travada em id={last_id} (loop infinito evitado)"
            )
        last_id = new_last_id
        all_rows.extend(rows)
        print(
            f"   pagina {page}: +{len(rows):>6,} linhas em {elapsed:5.1f}s "
            f"(total {len(all_rows):>7,} | last_id {last_id})"
        )
    return all_rows


def clean_col(name: str) -> str:
    name = re.sub(r"^[^\[]+\[", "", name).rstrip("]")
    name = name.replace("-", "_").replace("-", "_").replace(" ", "_")
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()
    name = re.sub(r"_+", "_", name).strip("_")
    return name


def normalize(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df.columns = [clean_col(c) for c in df.columns]

    datetime_cols = [
        c for c in df.columns
        if "_at" in c or "_date" in c or c == "last_operation_date"
    ]
    for col in datetime_cols:
        df[col] = pd.to_datetime(df[col], errors="coerce")

    if "created_at_brt" in df.columns:
        df["created_date_brt"] = df["created_at_brt"].dt.date
    elif "created_at" in df.columns:
        df["created_date_brt"] = (
            df["created_at"].dt.tz_localize("UTC").dt.tz_convert(
                "America/Sao_Paulo"
            ).dt.date
        )
    return df


def load_to_bq(df: pd.DataFrame, project: str, dataset: str, table: str) -> None:
    client = bigquery.Client(project=project)
    table_id = f"{project}.{dataset}.{table}"

    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        time_partitioning=bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.DAY,
            field="created_date_brt",
        ),
        clustering_fields=["from_user_id", "id"],
    )
    print(f"\n[BQ] carregando {len(df):,} linhas em {table_id}...")
    t0 = time.time()
    job = client.load_table_from_dataframe(df, table_id, job_config=job_config)
    result = job.result()
    elapsed = time.time() - t0
    print(f"[BQ] OK · {result.output_rows:,} linhas em {elapsed:.1f}s")
    print(f"[BQ] particao: created_date_brt | cluster: from_user_id, id")


def main() -> None:
    load_dotenv(".env.local")

    tenant = required_env("AZURE_TENANT_ID")
    client_id = required_env("AZURE_CLIENT_ID")
    client_secret = required_env("AZURE_CLIENT_SECRET")
    workspace = required_env("FABRIC_WORKSPACE_ID")
    dataset = required_env("FABRIC_DATASET_ID")
    table = required_env("FABRIC_TABLE_NAME")
    gcp_project = required_env("GCP_PROJECT_ID")
    bq_dataset = required_env("GCP_BQ_DATASET")

    print(f"[1/4] Token Azure (tenant {tenant[:8]}...)")
    token = get_token(tenant, client_id, client_secret)

    print(f"[2/4] Pull paginado de '{table}' (page_size={PAGE_SIZE:,})")
    rows = fetch_all(token, workspace, dataset, table, PAGE_SIZE)
    if not rows:
        sys.exit("[ERRO] Nenhuma linha retornada")
    print(f"       total: {len(rows):,} linhas")

    print(f"[3/4] Normalizando colunas e tipos")
    df = normalize(rows)
    print(f"       colunas: {list(df.columns)}")
    print(f"       periodo: {df['created_date_brt'].min()} ate {df['created_date_brt'].max()}")

    print(f"[4/4] Carregando no BigQuery")
    load_to_bq(df, gcp_project, bq_dataset, TARGET_TABLE)


if __name__ == "__main__":
    main()
