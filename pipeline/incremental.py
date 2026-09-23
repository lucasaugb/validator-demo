"""
Carga incremental: pega ultimos N dias do Fabric e faz MERGE no BQ por id.

Cobre o delay de 2-4h do sistema de origem -> Fabric com folga de seguranca (default 7 dias).
- Inserts novas linhas (id ainda nao na tabela).
- Atualiza linhas existentes que mudaram (status final, processed_at, etc).
- Idempotente: rodar varias vezes nao gera duplicatas.

Designado pra rodar em loop (Cloud Scheduler -> Cloud Run Job a cada 2h).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import msal
import pandas as pd
import requests
from dotenv import load_dotenv
from google.cloud import bigquery

WINDOW_DAYS = 7
# 40k * 21 colunas = 840k valores, abaixo do limite de 1M do executeQueries.
PAGE_SIZE = 40_000
TARGET_TABLE = "source_transactions"
STAGING_TABLE = "source_transactions_staging"
# Trigger-on-refresh: mesma tabela de watermark do pipeline de operations, com
# chave de job propria. Os dois jobs leem o refresh do MESMO modelo e disparam
# no mesmo tick */15 -> transactions e operations caem juntos no BQ.
WATERMARK_TABLE = "pipeline_watermarks"
WATERMARK_JOB = "transactions"
BRT = ZoneInfo("America/Sao_Paulo")


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
        sys.exit(f"[ERRO] HTTP {response.status_code}:\n{response.text[:2000]}")
    return response.json()["results"][0]["tables"][0]["rows"]


def fetch_recent(
    token: str,
    workspace: str,
    dataset: str,
    table: str,
    page_size: int,
    days_back: int,
) -> list[dict]:
    cutoff = (datetime.now(BRT) - timedelta(days=days_back)).date()
    cutoff_dax = f"DATE({cutoff.year}, {cutoff.month}, {cutoff.day})"
    # Pega tanto novos (createdAt) quanto atualizações em transações antigas
    # (Last Operation Date muda quando cliente opera, crítico pra ativação/comissão).
    print(
        f"   janela: createdAt BRT >= {cutoff.isoformat()} "
        f"OU Last Operation Date >= {cutoff.isoformat()}"
    )

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
            f"    FILTER(\n"
            f"        '{table}',\n"
            f"        '{table}'[id] > {last_id} && (\n"
            f"            '{table}'[createdAt BRT] >= {cutoff_dax}\n"
            f"            || '{table}'[Last Operation Date] >= {cutoff_dax}\n"
            f"        )\n"
            f"    ),\n"
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
            f"(total {len(all_rows):>6,} | last_id {last_id})"
        )
    return all_rows


# ---------------------------------------------------------------------------
# Trigger-on-refresh: so puxa quando o modelo semantico refrescou desde o ultimo
# pull. Roda barato (1 chamada de API + 1 leitura minima no BQ) e dispara o pull
# pesado apenas apos cada refresh do Fabric. Mesma mecanica do pipeline de
# operations, replicada aqui pra manter o fluxo de transactions autossuficiente.
# ---------------------------------------------------------------------------

def _parse_iso(s: str) -> datetime:
    """'2026-06-09T03:25:34.237Z' -> datetime tz-aware (UTC)."""
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def latest_refresh_end(
    token: str, workspace: str, dataset: str
) -> "datetime | None":
    """endTime (UTC) do refresh 'Completed' mais recente do dataset no Fabric.

    Retorna None se a API falhar, nesse caso o chamador segue sem o gate
    (degrada pra 'sempre roda', nunca trava o pipeline por causa do gate).
    """
    url = (
        f"https://api.powerbi.com/v1.0/myorg/groups/{workspace}"
        f"/datasets/{dataset}/refreshes?$top=10"
    )
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
    if r.status_code != 200:
        print(f"[WARN] refreshes API HTTP {r.status_code}; seguindo sem gate")
        return None
    for x in r.json().get("value", []):
        if x.get("status") == "Completed" and x.get("endTime"):
            return _parse_iso(x["endTime"])
    return None


def _wm_table_id(project: str, dataset: str) -> str:
    return f"{project}.{dataset}.{WATERMARK_TABLE}"


def ensure_watermark_table(client: bigquery.Client, project: str, dataset: str) -> None:
    schema = [
        bigquery.SchemaField("job", "STRING"),
        bigquery.SchemaField("last_refresh_end", "TIMESTAMP"),
        bigquery.SchemaField("updated_at", "TIMESTAMP"),
    ]
    client.create_table(
        bigquery.Table(_wm_table_id(project, dataset), schema=schema), exists_ok=True
    )


def get_watermark(
    client: bigquery.Client, project: str, dataset: str, job: str
) -> "datetime | None":
    q = f"SELECT last_refresh_end FROM `{_wm_table_id(project, dataset)}` WHERE job=@job"
    cfg = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("job", "STRING", job)]
    )
    rows = list(client.query(q, job_config=cfg).result())
    return rows[0]["last_refresh_end"] if rows else None


def set_watermark(
    client: bigquery.Client, project: str, dataset: str, job: str, end: datetime
) -> None:
    q = f"""
    MERGE `{_wm_table_id(project, dataset)}` T
    USING (SELECT @job AS job, @end AS last_refresh_end, CURRENT_TIMESTAMP() AS updated_at) S
    ON T.job = S.job
    WHEN MATCHED THEN UPDATE SET last_refresh_end = S.last_refresh_end, updated_at = S.updated_at
    WHEN NOT MATCHED THEN INSERT (job, last_refresh_end, updated_at)
      VALUES (S.job, S.last_refresh_end, S.updated_at)
    """
    cfg = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("job", "STRING", job),
            bigquery.ScalarQueryParameter("end", "TIMESTAMP", end),
        ]
    )
    client.query(q, job_config=cfg).result()


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
            df["created_at"].dt.tz_localize("UTC").dt.tz_convert(BRT).dt.date
        )
    return df


def merge_into_target(
    df: pd.DataFrame, project: str, dataset: str
) -> tuple[int, int]:
    """Carrega DF em staging, MERGE no target, retorna (inseridos, atualizados)."""
    client = bigquery.Client(project=project)
    staging_id = f"{project}.{dataset}.{STAGING_TABLE}"
    target_id = f"{project}.{dataset}.{TARGET_TABLE}"

    # 1. Stage (TRUNCATE)
    print(f"\n[BQ] staging: {len(df):,} linhas em {staging_id}")
    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )
    client.load_table_from_dataframe(df, staging_id, job_config=job_config).result()

    # 2. MERGE
    columns = list(df.columns)
    update_set = ", ".join(f"T.{c} = S.{c}" for c in columns if c != "id")
    cols_csv = ", ".join(columns)
    values_csv = ", ".join(f"S.{c}" for c in columns)

    merge_sql = f"""
    MERGE `{target_id}` T
    USING `{staging_id}` S
    ON T.id = S.id
    WHEN MATCHED THEN
      UPDATE SET {update_set}
    WHEN NOT MATCHED THEN
      INSERT ({cols_csv}) VALUES ({values_csv})
    """
    print("[BQ] executando MERGE...")
    job = client.query(merge_sql)
    job.result()
    affected = job.num_dml_affected_rows or 0

    # Conta inseridos vs atualizados via dry-run? Caro. Calcula via NOT EXISTS antes? Tambem caro.
    # Mais simples: depois do merge, rodar SELECT no target pra ver quantos ids da staging eram novos.
    new_count_sql = f"""
    SELECT COUNT(*) AS n FROM `{staging_id}` S
    WHERE NOT EXISTS (
        SELECT 1 FROM `{target_id}` T WHERE T.id = S.id
        AND T.last_operation_date != S.last_operation_date
    )
    """
    # Nota: depois do MERGE, target ja contem todas as linhas da staging.
    # Pra distinguir "novos" vs "atualizados" precisariamos snapshot antes.
    # Pulamos por simplicidade: `affected` ja eh a soma.

    # 3. Drop staging
    client.delete_table(staging_id, not_found_ok=True)

    return (affected, 0)  # so retornamos total afetado


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

    print(f"[1/5] Token Azure (tenant {tenant[:8]}...)")
    token = get_token(tenant, client_id, client_secret)

    print("[2/5] Gate: o modelo refrescou desde o ultimo pull?")
    wm_client = bigquery.Client(project=gcp_project)
    ensure_watermark_table(wm_client, gcp_project, bq_dataset)
    latest = latest_refresh_end(token, workspace, dataset)
    wm = get_watermark(wm_client, gcp_project, bq_dataset, WATERMARK_JOB)
    if latest is not None and wm is not None and latest <= wm:
        print(f"[SKIP] sem refresh novo (ultimo {latest} <= watermark {wm}). Nada a fazer.")
        return
    print(f"   refresh novo: {latest} (watermark anterior: {wm})")

    print(f"[3/5] Pull dos ultimos {WINDOW_DAYS} dias")
    rows = fetch_recent(token, workspace, dataset, table, PAGE_SIZE, WINDOW_DAYS)
    if not rows:
        print("[OK] Nenhuma linha na janela. Nada a fazer.")
        if latest is not None:
            set_watermark(wm_client, gcp_project, bq_dataset, WATERMARK_JOB, latest)
        return
    print(f"       total: {len(rows):,} linhas")

    print("[4/5] Normalizando")
    df = normalize(rows)

    print("[5/5] MERGE no BigQuery")
    affected, _ = merge_into_target(df, gcp_project, bq_dataset)
    print(f"\n[OK] MERGE concluido. {affected:,} linhas afetadas (insert+update).")

    if latest is not None:
        set_watermark(wm_client, gcp_project, bq_dataset, WATERMARK_JOB, latest)


if __name__ == "__main__":
    main()
