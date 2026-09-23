"""
Helpers compartilhados do pipeline de OPERACOES (fOperations Album -> BigQuery).

Task SEPARADA do transactions. Reaproveita apenas as credenciais do ../.env.local
(Azure SP + workspace/dataset do Fabric + projeto GCP). NAO importa nem altera
nenhum script do fluxo de transactions.
"""
from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime

import msal
import pandas as pd
import requests
from dotenv import load_dotenv
from google.cloud import bigquery

# Nome da tabela no modelo semantico (entre aspas no EVALUATE).
SOURCE_TABLE = "fOperations Album"
# Tabela alvo no BigQuery (espelho), dataset origem.
TARGET_TABLE = "source_operations"
STAGING_TABLE = "source_operations_staging"
# Tabela de watermark do trigger-on-refresh (1 linha por job).
WATERMARK_TABLE = "pipeline_watermarks"
# 23 colunas * 25k = 575k valores, com folga do limite de 1M do executeQueries.
# Tamanho menor tambem mantem cada pagina leve na RAM (streaming pra staging).
PAGE_SIZE = 25_000

_ENV_LOADED = False


def _load_env() -> None:
    global _ENV_LOADED
    if not _ENV_LOADED:
        here = os.path.dirname(__file__)
        load_dotenv(os.path.join(here, "..", ".env.local"))
        _ENV_LOADED = True


def required_env(name: str) -> str:
    _load_env()
    value = os.environ.get(name)
    if not value:
        sys.exit(f"[ERRO] Variavel {name} nao definida em ../.env.local")
    return value


def get_token() -> str:
    app = msal.ConfidentialClientApplication(
        required_env("AZURE_CLIENT_ID"),
        authority=f"https://login.microsoftonline.com/{required_env('AZURE_TENANT_ID')}",
        client_credential=required_env("AZURE_CLIENT_SECRET"),
    )
    result = app.acquire_token_for_client(
        scopes=["https://analysis.windows.net/powerbi/api/.default"]
    )
    if "access_token" not in result:
        sys.exit(f"[ERRO] Falha ao obter token Azure: {result.get('error_description')}")
    return result["access_token"]


def execute_dax(token: str, dax: str) -> list[dict]:
    url = (
        f"https://api.powerbi.com/v1.0/myorg/groups/{required_env('FABRIC_WORKSPACE_ID')}"
        f"/datasets/{required_env('FABRIC_DATASET_ID')}/executeQueries"
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
        sys.exit(f"[ERRO] HTTP {response.status_code} no executeQueries:\n{response.text[:2000]}")
    return response.json()["results"][0]["tables"][0]["rows"]


def iter_pages(token: str, where_extra: str = ""):
    """Gera paginas (list[dict]) da tabela por TICKET ASC, SEM acumular tudo em RAM.

    Cada `yield` entrega uma pagina de ate PAGE_SIZE linhas; o consumidor processa
    e descarta antes da proxima. Isso mantem a memoria proporcional a UMA pagina,
    independente do tamanho da janela (essencial com a tabela escalando).

    TICKET e' texto no modelo, entao usamos VALUE() pra comparar/ordenar numerico.
    where_extra: predicado DAX adicional, ex. janela de datas (com '&&' na frente).
    """
    t = SOURCE_TABLE
    last_ticket = -1
    page = 0
    ticket_key = f"{t}[TICKET]"
    while True:
        page += 1
        # ORDER BY explicito e' obrigatorio: o executeQueries trunca a resposta
        # por tamanho (~16k linhas/22 cols). Sem ordenacao, a truncagem devolve
        # linhas fora de ordem e a paginacao por watermark pula linhas do meio.
        # Com ORDER BY ASC, a truncagem mantem o bloco contiguo de menores tickets
        # e o loop continua a partir do ultimo ticket recebido ate esvaziar.
        dax = (
            "EVALUATE\n"
            "TOPN(\n"
            f"    {PAGE_SIZE},\n"
            "    FILTER(\n"
            f"        '{t}',\n"
            f"        VALUE('{t}'[TICKET]) > {last_ticket}{where_extra}\n"
            "    ),\n"
            f"    VALUE('{t}'[TICKET]), ASC\n"
            ")\n"
            f"ORDER BY VALUE('{t}'[TICKET]) ASC"
        )
        t0 = time.time()
        rows = execute_dax(token, dax)
        elapsed = time.time() - t0
        if not rows:
            break
        new_last = max(int(float(r[ticket_key])) for r in rows)
        if new_last == last_ticket:
            sys.exit(f"[ERRO] paginacao travada em ticket={last_ticket}")
        last_ticket = new_last
        print(
            f"   pagina {page}: +{len(rows):>6,} linhas em {elapsed:5.1f}s "
            f"(last_ticket {last_ticket})"
        )
        yield rows


def paginate(token: str, where_extra: str = "") -> list[dict]:
    """Compat: materializa todas as paginas numa lista (usado pelo backfill manual)."""
    all_rows: list[dict] = []
    for rows in iter_pages(token, where_extra):
        all_rows.extend(rows)
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

    # Operacoes usam *_time / *_date (transactions usava *_at / *_date).
    datetime_cols = [c for c in df.columns if "_time" in c or "_date" in c]
    for col in datetime_cols:
        df[col] = pd.to_datetime(df[col], errors="coerce")

    # Coluna DATE derivada pra particionar (data de abertura da operacao, BRT).
    if "open_time_brt" in df.columns:
        df["open_date_brt"] = df["open_time_brt"].dt.date
    elif "open_time" in df.columns:
        df["open_date_brt"] = df["open_time"].dt.date

    return df


# ---------------------------------------------------------------------------
# Trigger-on-refresh: so puxa quando o modelo semantico realmente refrescou.
# Evita ~24 pulls "no escuro"/dia; roda barato (1 chamada de API + 1 leitura
# minima no BQ) e dispara o pull pesado apenas apos cada refresh do Fabric.
# ---------------------------------------------------------------------------

def _parse_iso(s: str) -> datetime:
    """'2026-06-09T03:25:34.237Z' -> datetime tz-aware (UTC)."""
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def latest_refresh_end(token: str) -> datetime | None:
    """endTime (UTC) do refresh 'Completed' mais recente do dataset no Fabric.

    Retorna None se a API falhar, nesse caso o chamador segue sem o gate
    (degrada pra 'sempre roda', nunca trava o pipeline por causa do gate).
    """
    ws = required_env("FABRIC_WORKSPACE_ID")
    ds = required_env("FABRIC_DATASET_ID")
    url = f"https://api.powerbi.com/v1.0/myorg/groups/{ws}/datasets/{ds}/refreshes?$top=10"
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


def ensure_watermark_table(client: "bigquery.Client", project: str, dataset: str) -> None:
    schema = [
        bigquery.SchemaField("job", "STRING"),
        bigquery.SchemaField("last_refresh_end", "TIMESTAMP"),
        bigquery.SchemaField("updated_at", "TIMESTAMP"),
    ]
    client.create_table(
        bigquery.Table(_wm_table_id(project, dataset), schema=schema), exists_ok=True
    )


def get_watermark(
    client: "bigquery.Client", project: str, dataset: str, job: str
) -> datetime | None:
    q = f"SELECT last_refresh_end FROM `{_wm_table_id(project, dataset)}` WHERE job=@job"
    cfg = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("job", "STRING", job)]
    )
    rows = list(client.query(q, job_config=cfg).result())
    return rows[0]["last_refresh_end"] if rows else None


def set_watermark(
    client: "bigquery.Client", project: str, dataset: str, job: str, end: datetime
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
