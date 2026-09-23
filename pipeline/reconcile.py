"""
Reconciliação full Fabric -> BigQuery.

Diferente do incremental.py (que pega só ultimos 7 dias):
- Puxa TODOS os IDs do modelo semantico do Fabric.
- Faz MERGE no source_transactions (atualiza qualquer linha que tenha mudado).
- DELETA do BQ linhas que sumiram do Fabric (espelho exato).

Designado pra rodar 1x/dia (Cloud Scheduler -> Cloud Run Job).
Cobre qualquer drift que o incremental nao capturar (status mudou em
transacao antigo, linha foi removida do Fabric, etc).

Safeguards:
- Aborta se o pull veio com menos de 80% das linhas que existem no BQ
  (sinaliza falha de pull, evita DELETE em massa por acidente).
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

PAGE_SIZE = 40_000
TARGET_TABLE = "source_transactions"
STAGING_TABLE = "source_transactions_reconcile_staging"
SAFETY_FLOOR_RATIO = 0.80  # se Fabric < 80% do BQ, aborta


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"[ERRO] Variavel {name} nao definida")
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
        timeout=600,
    )
    if response.status_code != 200:
        sys.exit(f"[ERRO] HTTP {response.status_code}:\n{response.text[:2000]}")
    return response.json()["results"][0]["tables"][0]["rows"]


def fetch_all(
    token: str, workspace: str, dataset: str, table: str, page_size: int
) -> list[dict]:
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
        new_last = max(int(r[id_col]) for r in rows)
        if new_last == last_id:
            sys.exit(f"[ERRO] paginacao travada em id={last_id}")
        last_id = new_last
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
        c
        for c in df.columns
        if "_at" in c or "_date" in c or c == "last_operation_date"
    ]
    for col in datetime_cols:
        df[col] = pd.to_datetime(df[col], errors="coerce")

    if "created_at_brt" in df.columns:
        df["created_date_brt"] = df["created_at_brt"].dt.date
    return df


def reconcile(df: pd.DataFrame, project: str, dataset: str) -> None:
    client = bigquery.Client(project=project)
    staging_id = f"{project}.{dataset}.{STAGING_TABLE}"
    target_id = f"{project}.{dataset}.{TARGET_TABLE}"

    # Safety check: quantas linhas tem no target hoje?
    target_count = list(
        client.query(f"SELECT COUNT(*) AS n FROM `{target_id}`").result()
    )[0]["n"]
    pulled = len(df)
    ratio = pulled / target_count if target_count else 1.0
    print(f"\n[SAFETY] BQ: {target_count:,} | Fabric: {pulled:,} | ratio: {ratio:.2%}")
    if ratio < SAFETY_FLOOR_RATIO:
        sys.exit(
            f"[ABORTADO] Fabric retornou {ratio:.2%} do BQ "
            f"(piso {SAFETY_FLOOR_RATIO:.0%}). Provavelmente erro de pull. "
            f"Sem MERGE/DELETE pra evitar destruir dados."
        )

    # 1. Stage tudo
    print(f"\n[BQ] staging {pulled:,} linhas em {staging_id}")
    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )
    client.load_table_from_dataframe(df, staging_id, job_config=job_config).result()

    # 2. MERGE (upsert)
    columns = list(df.columns)
    update_set = ", ".join(f"T.{c} = S.{c}" for c in columns if c != "id")
    cols_csv = ", ".join(columns)
    values_csv = ", ".join(f"S.{c}" for c in columns)

    merge_sql = f"""
    MERGE `{target_id}` T
    USING `{staging_id}` S
    ON T.id = S.id
    WHEN MATCHED THEN UPDATE SET {update_set}
    WHEN NOT MATCHED THEN INSERT ({cols_csv}) VALUES ({values_csv})
    """
    print("[BQ] MERGE (upsert)...")
    job = client.query(merge_sql)
    job.result()
    merged = job.num_dml_affected_rows or 0
    print(f"[BQ] MERGE: {merged:,} linhas afetadas")

    # 3. DELETE linhas que sumiram do Fabric
    delete_sql = f"""
    DELETE FROM `{target_id}`
    WHERE id NOT IN (SELECT id FROM `{staging_id}`)
    """
    print("[BQ] DELETE de linhas que sumiram do Fabric...")
    job = client.query(delete_sql)
    job.result()
    deleted = job.num_dml_affected_rows or 0
    print(f"[BQ] DELETE: {deleted:,} linhas removidas")

    # 4. Drop staging
    client.delete_table(staging_id, not_found_ok=True)

    print(
        f"\n[OK] reconcile concluido. merged={merged:,} deleted={deleted:,} "
        f"final_count={target_count + (pulled - target_count) - deleted:,}"
    )


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

    print("[2/4] Pull FULL do Fabric (paginado)")
    rows = fetch_all(token, workspace, dataset, table, PAGE_SIZE)
    if not rows:
        sys.exit("[ABORTADO] Fabric retornou 0 linhas, pull falhou.")
    print(f"       total: {len(rows):,} linhas")

    print("[3/4] Normalizando")
    df = normalize(rows)

    print("[4/4] Reconcile no BigQuery")
    reconcile(df, gcp_project, bq_dataset)


if __name__ == "__main__":
    main()
