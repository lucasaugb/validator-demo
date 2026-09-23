"""
Carga incremental de OPERACOES: janela movel do Fabric -> MERGE no BigQuery por ticket.

Captura:
- operacoes novas (abertas na janela);
- operacoes antigas que MUDARAM (fecharam / modificaram SL-TP), close/modify na janela.
Idempotente: rodar varias vezes nao duplica (MERGE por ticket).

Desenho a prova de escala (tabela cresce indefinidamente com operacoes de clientes):
1. TRIGGER-ON-REFRESH: so faz o pull pesado quando o modelo semantico refrescou
   (gate barato: 1 chamada de API + watermark no BQ). Os demais runs saem em segundos.
2. STREAMING: cada pagina vai direto pra staging e e' descartada da RAM, memoria
   proporcional a UMA pagina, nunca a janela inteira (era o que causava OOM).
3. MERGE COM PARTITION PRUNING: o scan do target fica limitado ao range de
   open_date_brt presente na staging (open_date e' imutavel por ticket), entao o
   custo do MERGE escala com o dado MUDADO, nao com o tamanho total da tabela.

Task separada do transactions: nao toca em nada do validator.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from google.cloud import bigquery

from common import (
    STAGING_TABLE,
    TARGET_TABLE,
    ensure_watermark_table,
    get_token,
    get_watermark,
    iter_pages,
    latest_refresh_end,
    normalize,
    required_env,
    set_watermark,
)

WINDOW_DAYS = 7
WATERMARK_JOB = "operations"
BRT = ZoneInfo("America/Sao_Paulo")


def window_predicate() -> str:
    cutoff = (datetime.now(BRT) - timedelta(days=WINDOW_DAYS)).date()
    d = f"DATE({cutoff.year}, {cutoff.month}, {cutoff.day})"
    t = "fOperations Album"
    print(f"   janela: aberta/fechada/modificada desde {cutoff.isoformat()} (BRT)")
    # Pega aberturas, fechamentos e modificacoes recentes.
    return (
        " && (\n"
        f"            '{t}'[OPEN_TIME BRT] >= {d}\n"
        f"            || '{t}'[CLOSE_TIME BRT] >= {d}\n"
        f"            || '{t}'[MODIFY_TIME] >= {d}\n"
        "        )"
    )


def stream_to_staging(
    client: bigquery.Client, token: str, project: str, dataset: str, target_id: str
) -> tuple[int, str]:
    """Puxa a janela pagina-a-pagina e carrega direto na staging (memoria O(1 pagina)).

    Staging tem nome UNICO por run (evita colisao entre execucoes concorrentes) e
    schema explicito do target (evita drift de dtype entre paginas). Load jobs no BQ
    sao gratuitos: streaming de N paginas nao adiciona custo de bytes.
    """
    # nome unico + expiracao: orfaos (run que crashou) se auto-deletam.
    suffix = f"{os.getpid()}_{int(time.time())}"
    staging_id = f"{project}.{dataset}.{STAGING_TABLE}_{suffix}"

    target = client.get_table(target_id)
    staging = bigquery.Table(staging_id, schema=target.schema)
    staging.expires = datetime.now(timezone.utc) + timedelta(hours=6)
    client.delete_table(staging_id, not_found_ok=True)
    client.create_table(staging)

    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
        schema=target.schema,
    )
    total = 0
    for rows in iter_pages(token, where_extra=window_predicate()):
        df = normalize(rows)
        client.load_table_from_dataframe(df, staging_id, job_config=job_config).result()
        total += len(df)
        del df
    return total, staging_id


def merge_pruned(client: bigquery.Client, staging_id: str, target_id: str) -> int:
    """MERGE por ticket, com prune de particoes via range de open_date_brt da staging.

    open_date_brt e' imutavel por ticket: uma linha da staging com open_date=D so
    pode casar com a linha do target na particao D. Logo, filtrar o target pelo
    range [min,max] de open_date_brt da staging e' SEMPRE seguro (nunca perde match)
    e permite ao BigQuery podar todas as outras particoes do scan.
    """
    rng = list(
        client.query(
            f"SELECT MIN(open_date_brt) AS lo, MAX(open_date_brt) AS hi FROM `{staging_id}`"
        ).result()
    )[0]
    lo, hi = rng["lo"], rng["hi"]
    if lo is None:
        return 0

    columns = [f.name for f in client.get_table(target_id).schema]
    update_set = ", ".join(f"T.{c} = S.{c}" for c in columns if c != "ticket")
    cols_csv = ", ".join(columns)
    values_csv = ", ".join(f"S.{c}" for c in columns)
    merge_sql = f"""
    MERGE `{target_id}` T
    USING `{staging_id}` S
    ON T.ticket = S.ticket
       AND T.open_date_brt BETWEEN DATE '{lo.isoformat()}' AND DATE '{hi.isoformat()}'
    WHEN MATCHED THEN UPDATE SET {update_set}
    WHEN NOT MATCHED THEN INSERT ({cols_csv}) VALUES ({values_csv})
    """
    print(f"   prune de particoes: open_date_brt {lo} -> {hi}")
    job = client.query(merge_sql)
    job.result()
    print(f"   bytes faturados no MERGE: {(job.total_bytes_billed or 0) / 1e6:.1f} MB")
    return job.num_dml_affected_rows or 0


def main() -> None:
    project = required_env("GCP_PROJECT_ID")
    dataset = required_env("GCP_BQ_DATASET")
    target_id = f"{project}.{dataset}.{TARGET_TABLE}"
    client = bigquery.Client(project=project)
    ensure_watermark_table(client, project, dataset)

    print("[1/5] Token Azure")
    token = get_token()

    print("[2/5] Gate: o modelo refrescou desde o ultimo pull?")
    latest = latest_refresh_end(token)
    wm = get_watermark(client, project, dataset, WATERMARK_JOB)
    if latest is not None and wm is not None and latest <= wm:
        print(f"[SKIP] sem refresh novo (ultimo {latest} <= watermark {wm}). Nada a fazer.")
        return
    print(f"   refresh novo: {latest} (watermark anterior: {wm})")

    print(f"[3/5] Streaming da janela de {WINDOW_DAYS} dias pra staging")
    total, staging_id = stream_to_staging(client, token, project, dataset, target_id)
    if total == 0:
        print("[OK] Nenhuma operacao na janela.")
        client.delete_table(staging_id, not_found_ok=True)
        if latest is not None:
            set_watermark(client, project, dataset, WATERMARK_JOB, latest)
        return
    print(f"       staged: {total:,} linhas")

    print("[4/5] MERGE no BigQuery (com partition pruning)")
    affected = merge_pruned(client, staging_id, target_id)
    client.delete_table(staging_id, not_found_ok=True)
    print(f"   {affected:,} linhas afetadas (insert+update)")

    print("[5/5] Atualizando watermark")
    if latest is not None:
        set_watermark(client, project, dataset, WATERMARK_JOB, latest)
    print("[OK] concluido.")


if __name__ == "__main__":
    main()
