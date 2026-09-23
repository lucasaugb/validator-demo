"""
Cloud Run Job: validacao dos transactions do Validator contra source_transactions.

Processa todos os Firestore transactions com systemValidation='pending'.
Para cada um:
  - Match LINHA POR LINHA em source_transactions por (clientId, amount, currency, transactionDate)
  - Cada source_transactions.id pode ser "consumido" por no maximo 1 Validator transaction
  - Se ha mais Validator transactions do que transacoes reais, FIFO valida os primeiros,
    resto vira 'duplicate'. Se duplicate envolve agentes diferentes, dispara alerta de fraude.
  - Se nao achou match e idade < 12h, mantem 'pending' (espera dado do source chegar).
  - Se nao achou match e idade >= 12h, marca 'invalid' definitivo.
  - Computa isActivation: true se o source_transactions.id consumido eh o mais antigo do clientId.

Designado pra rodar a cada 30 min via Cloud Scheduler.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from google.cloud import bigquery, firestore
from dotenv import load_dotenv

# Janela de 12h DEPOIS do fim do dia BRT do transactionDate. Ou seja:
# - transactionDate de ontem (ou antes) → fim do dia BRT + 12h ja passou → pode invalidar a qualquer hora
# - transactionDate de hoje → fim do dia BRT (23:59 BRT) + 12h = amanha meio-dia BRT → so invalida depois disso
POST_TRANSACTION_GRACE_HOURS = 12
BRT = ZoneInfo("America/Sao_Paulo")
SOURCE_TABLE = "source_transactions"
SOURCE_DATASET = "origem"
TRANSACTIONS_COLLECTION = "transactions"

# CRM Pipedrive espelhado no BigQuery: vive em OUTRO projeto (`crm-demo-project`),
# consultado a partir da mesma service account (só LEITURA, nunca escreve lá).
# A SA precisa de BigQuery Data Viewer nesse dataset. Sem acesso, a
# classificação falha DEFENSIVAMENTE (loga e não grava) e o resto segue normal.
PIPEDRIVE_PROJECT = os.environ.get("PIPEDRIVE_PROJECT", "crm-demo-project")
PIPEDRIVE_DATASET = os.environ.get("PIPEDRIVE_DATASET", "Pipedrive_gcf")
PIPEDRIVE_TABLE = os.environ.get("PIPEDRIVE_TABLE", "deals_all_primary")
# PRM = Premium (produto mais caro), STR = Starter (entrada mais barata).
SUBCONTA_MAP = {"PRM": "premium", "STR": "starter"}

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)


def required_env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.exit(f"[ERRO] {name} nao definida")
    return v


def can_invalidate_now(transaction_date_str: str) -> bool:
    """
    Retorna True quando ja passaram >= 12h apos o fim do dia BRT do transactionDate.

    Exemplos (now em 2026-05-10):
    - transactionDate=2026-05-09 (ontem) → end_of_day = 2026-05-09 23:59 BRT → +12h = 2026-05-10 11:59 BRT
      Se now BRT >= 2026-05-10 12:00 → True. Antes disso → False.
    - transactionDate=2026-05-10 (hoje) → end_of_day = 2026-05-10 23:59 BRT → +12h = 2026-05-11 11:59 BRT
      Aguarda ate amanha meio-dia.
    """
    try:
        d = date.fromisoformat(transaction_date_str)
    except (TypeError, ValueError):
        return False
    end_of_day_brt = datetime.combine(d, time(23, 59, 59), tzinfo=BRT)
    deadline = end_of_day_brt + timedelta(hours=POST_TRANSACTION_GRACE_HOURS)
    return datetime.now(BRT) >= deadline


def coerce_login(client_id) -> str | None:
    """O campo `clientId` no Validator agora representa a `login` (conta do cliente)
    do cliente: STRING no source_transactions. Normaliza pra string sem espacos extras.
    Retorna None se vazio."""
    if client_id is None:
        return None
    s = str(client_id).strip()
    return s or None


def query_source_candidates(
    bq: bigquery.Client,
    project: str,
    client_id: str,
    amount: float,
    currency: str,
    transaction_date: str,
) -> list[dict]:
    """Retorna lista de source_transactions.id que casam nas 4 dimensoes, ordenada por id ASC.

    Match agora eh por `login` (a conta do cliente), o que o agente preenche no
    Validator. `from_user_id` so eh usado depois pra calcular isActivation.
    """
    login = coerce_login(client_id)
    if login is None:
        log.warning(f"login '{client_id}' vazio, retornando sem candidatos")
        return []
    # Partition prune: tabela particionada por `created_date_brt`. Janela ±1
    # dia cobre TZ skew (created_at vs created_date_brt em dias adjacentes).
    sql = f"""
    SELECT id, created_at_brt_copy, country, partner_code
    FROM `{project}.{SOURCE_DATASET}.{SOURCE_TABLE}`
    WHERE created_date_brt BETWEEN DATE_SUB(@transaction_date, INTERVAL 1 DAY)
                              AND DATE_ADD(@transaction_date, INTERVAL 1 DAY)
      AND login = @login
      AND processed_amount = @amount
      AND processed_currency = @currency
      AND DATE(created_at_brt_copy) = @transaction_date
    ORDER BY id ASC
    """
    job = bq.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("login", "STRING", login),
                bigquery.ScalarQueryParameter("amount", "FLOAT64", float(amount)),
                bigquery.ScalarQueryParameter("currency", "STRING", currency),
                bigquery.ScalarQueryParameter("transaction_date", "DATE", transaction_date),
            ]
        ),
    )
    return [
        {
            "id": int(r["id"]),
            "created_at_brt_copy": r["created_at_brt_copy"],
            # País ISO-2 do sistema de origem, informativo (mapa geográfico). Pode ser
            # None; nunca participa de match/ativação/comissão.
            "country": (str(r["country"]).strip().upper() or None) if r["country"] is not None else None,
            # parceria (PartnerCode): informativo (indicador "Fora da parceria"). str ou None
            # (orgânico). Nunca participa de match/ativação/comissão.
            "partner_code": normalize_partner(r["partner_code"]),
        }
        for r in job
    ]


def normalize_partner(value) -> str | None:
    """partner_code (FLOAT no source, ex.: 90001.0) → "90001". None/vazio → None."""
    if value is None:
        return None
    try:
        return str(int(float(value)))
    except (TypeError, ValueError):
        s = str(value).strip()
        return s or None


def query_partial_checks(
    bq: bigquery.Client,
    project: str,
    client_id: str,
    amount: float,
    currency: str,
    transaction_date: str,
) -> dict[str, bool]:
    """Quando same_row_check falha, descobre quais dimensoes batem isoladas (pra UI).
    `id_check` agora confere se a `login` existe na source."""
    login = coerce_login(client_id)
    if login is None:
        return {"id_check": False, "value_check": False, "currency_check": False, "date_check": False}
    sql = f"""
    SELECT
      COUNTIF(login = @login) > 0 AS id_check,
      COUNTIF(login = @login AND processed_amount = @amount AND processed_currency = @currency) > 0 AS value_check,
      COUNTIF(login = @login AND processed_currency = @currency) > 0 AS currency_check,
      COUNTIF(login = @login AND DATE(created_at_brt_copy) = @transaction_date) > 0 AS date_check
    FROM `{project}.{SOURCE_DATASET}.{SOURCE_TABLE}`
    """
    job = bq.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("login", "STRING", login),
                bigquery.ScalarQueryParameter("amount", "FLOAT64", float(amount)),
                bigquery.ScalarQueryParameter("currency", "STRING", currency),
                bigquery.ScalarQueryParameter("transaction_date", "DATE", transaction_date),
            ]
        ),
    )
    row = next(iter(job))
    return {
        "id_check": bool(row["id_check"]),
        "value_check": bool(row["value_check"]),
        "currency_check": bool(row["currency_check"]),
        "date_check": bool(row["date_check"]),
    }


def query_best_candidate(
    bq: bigquery.Client,
    project: str,
    client_id: str,
    amount: float,
    currency: str,
    transaction_date: str,
) -> dict | None:
    """Acha a transacao do source mais parecida com o que o agente preencheu.

    A `login` (conta do cliente) eh AUTORITATIVA: se ela existe na source,
    o best candidate eh forcosamente uma tx desse login, `loginMatch` sempre
    True: e o que pode falhar sao os outros 3 campos (amount/currency/date).
    Login so eh marcado como invalido quando NAO EXISTE NENHUMA tx com esse
    login no source.

    Pass 1: WHERE login = @login → pega a tx do mesmo login com mais matches
      em amount/currency/date. Empate desempata pela proximidade da data e
      depois pelo id mais novo.

    Quando a login NAO existe na source (pass 1 sem resultado), devolvemos
    None: a UI deve mostrar apenas "conta do cliente nao encontrada"
    sem campos parciais (#decisao 2026-05-26). Login eh o start da
    validacao; sem ela, nada mais faz sentido apontar.
    """
    login = coerce_login(client_id)
    if login is None:
        return None

    # Pass 1: login eh a chave. Partition prune ±7 dias (agente pode preencher
    # data errada por uns dias). Sem isso a query escaneava a tabela toda.
    sql_same_login = f"""
    SELECT
      id,
      processed_amount,
      processed_currency,
      DATE(created_at_brt_copy) AS source_date,
      (CASE WHEN processed_amount = @amount THEN 1 ELSE 0 END) AS amount_match,
      (CASE WHEN processed_currency = @currency THEN 1 ELSE 0 END) AS currency_match,
      (CASE WHEN DATE(created_at_brt_copy) = @transaction_date THEN 1 ELSE 0 END) AS date_match
    FROM `{project}.{SOURCE_DATASET}.{SOURCE_TABLE}`
    WHERE created_date_brt BETWEEN DATE_SUB(@transaction_date, INTERVAL 7 DAY)
                              AND DATE_ADD(@transaction_date, INTERVAL 7 DAY)
      AND login = @login
    QUALIFY ROW_NUMBER() OVER (
      ORDER BY
        (CASE WHEN processed_amount = @amount THEN 1 ELSE 0 END +
         CASE WHEN processed_currency = @currency THEN 1 ELSE 0 END +
         CASE WHEN DATE(created_at_brt_copy) = @transaction_date THEN 1 ELSE 0 END) DESC,
        ABS(DATE_DIFF(DATE(created_at_brt_copy), @transaction_date, DAY)) ASC,
        id DESC
    ) = 1
    """
    job = bq.query(
        sql_same_login,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("login", "STRING", login),
                bigquery.ScalarQueryParameter("amount", "FLOAT64", float(amount)),
                bigquery.ScalarQueryParameter("currency", "STRING", currency),
                bigquery.ScalarQueryParameter("transaction_date", "DATE", transaction_date),
            ]
        ),
    )
    row = next(iter(job), None)
    if row is not None:
        other = int(row["amount_match"]) + int(row["currency_match"]) + int(row["date_match"])
        # Login existe mas nenhuma tx parece relacionada (0 outros campos batem)
        # → nao adianta apontar uma tx aleatoria como referencia, deixa pro
        # partial_checks mostrar "login ok, resto vazio".
        if other < 1:
            return None
        return {
            "sourceTransactionId": str(int(row["id"])),
            "matchCount": 1 + other,
            "loginMatch": True,
            "amountMatch": bool(row["amount_match"]),
            "currencyMatch": bool(row["currency_match"]),
            "dateMatch": bool(row["date_match"]),
            "sourceAmount": float(row["processed_amount"]) if row["processed_amount"] is not None else None,
            "sourceCurrency": str(row["processed_currency"]) if row["processed_currency"] is not None else None,
            "sourceDate": row["source_date"].isoformat() if row["source_date"] is not None else None,
        }

    # Login NAO existe na source: pass 1 retornou vazio. Antigamente tinha
    # um pass 2 sugerindo tx de OUTRO login com 2+ campos batendo, mas isso
    # confundia o gestor ("achou conta, mas com outro login?"). Decisao
    # 2026-05-26: se a login nao existe, retorna None e a UI mostra so
    # "conta do cliente nao encontrada". Login eh o start da validacao.
    return None


def query_last_operation_date(bq: bigquery.Client, project: str, client_id: str) -> str | None | object:
    """Retorna a ultima data conhecida de operacao do cliente no source.

    Faz `MAX(DATE(last_operation_date))` em todas as rows com `login = @login`.

    Returns:
      - ISO `yyyy-mm-dd` string se o cliente ja operou alguma vez.
      - `None` (Python None) se o cliente esta no source mas nunca operou.
      - `firestore.DELETE_FIELD` se nao conseguimos consultar (login invalido),
        cuidado: tratar como "ainda nao verificado".

    A diferenca entre None (nunca operou) e DELETE_FIELD (nao consultado) eh
    importante pra UI: None vira "nao elegivel", DELETE_FIELD vira "aguardando".
    """
    login = coerce_login(client_id)
    if login is None:
        return firestore.DELETE_FIELD
    sql = f"""
    SELECT MAX(DATE(last_operation_date)) AS lod,
           COUNTIF(login = @login) AS rows_count
    FROM `{project}.{SOURCE_DATASET}.{SOURCE_TABLE}`
    WHERE login = @login
    """
    job = bq.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("login", "STRING", login),
            ]
        ),
    )
    row = next(iter(job), None)
    if not row or int(row["rows_count"] or 0) == 0:
        # login nao existe na source → ainda nao podemos afirmar nada
        return firestore.DELETE_FIELD
    if row["lod"] is None:
        # esta no source mas nunca teve operacao registrada
        return None
    return row["lod"].isoformat()


SOURCE_ENRICHED_VIEW = "source_transactions_enriched"


def is_activation(
    bq: bigquery.Client,
    fs: firestore.Client,  # noqa: ARG001 - mantido pra compat de chamadas existentes
    project: str,
    client_id: str,  # noqa: ARG001 - mantido pra compat; agora não é mais usado
    matched_id: int,
    current_transaction_id: str | None = None,  # noqa: ARG001
) -> bool:
    """isActivation = a tx `matched_id` está marcada como primeira do from_user_id
    na view `source_transactions_enriched`.

    🚨 ARQUITETURA (decisão 2026-05-20 r2): NÃO calculamos ativação em Python.
    Lemos o boolean `is_user_first_transaction` que vem da view BigQuery
    `origem.source_transactions_enriched`. A definição da view é UMA SQL com
    `FIRST_VALUE() OVER (PARTITION BY from_user_id ORDER BY created_at_brt_copy, id)`.
    Toda lógica de "primeira tx" vive nessa view, Python só lê.

    Por quê: a versão anterior tinha a mesma lógica DUPLICADA em 2 arquivos
    (validate.py + functions/main.py) e qualquer divergência reintroduzia
    bug. Centralizando em SQL, impossibilita divergência.

    Ver `feedback_validacao_zero_falso_positivo.md` em memory.
    """
    sql = f"""
    SELECT is_user_first_transaction
    FROM `{project}.{SOURCE_DATASET}.{SOURCE_ENRICHED_VIEW}`
    WHERE id = @matched_id
    LIMIT 1
    """
    job = bq.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("matched_id", "INT64", int(matched_id)),
            ]
        ),
    )
    row = next(iter(job), None)
    if row is None:
        # tx não está na view (não deveria acontecer pra um matched_id válido
        #: mas defensive: não é ativação).
        return False
    return bool(row["is_user_first_transaction"])


def list_all_in_group(fs: firestore.Client, key: tuple) -> list[tuple]:
    """Retorna [(doc_ref, data, doc_id), ...] de TODOS os transactions no Firestore com a mesma chave (clientId, amount, currency, transactionDate). Inclui pending, verified, duplicate, invalid."""
    client_id, amount, currency, transaction_date = key
    q = (
        fs.collection(TRANSACTIONS_COLLECTION)
        .where(filter=firestore.FieldFilter("clientId", "==", str(client_id)))
        .where(filter=firestore.FieldFilter("amount", "==", float(amount)))
        .where(filter=firestore.FieldFilter("currency", "==", currency))
        .where(filter=firestore.FieldFilter("transactionDate", "==", transaction_date))
    )
    out: list[tuple] = []
    for doc in q.stream():
        out.append((doc.reference, doc.to_dict() or {}, doc.id))
    return out


def mark_all_duplicate(
    transactions_in_group: list[tuple], stats: dict[str, int]
) -> None:
    """Marca TODOS os transactions do grupo como duplicate, com cross-reference."""
    agentes = {d.get("agenteId") for _, d, _ in transactions_in_group if d.get("agenteId")}
    cross_agent = len(agentes) > 1
    all_ids = [doc_id for _, _, doc_id in transactions_in_group]
    all_numbers = [d.get("transactionNumber") for _, d, _ in transactions_in_group]
    # Setores únicos envolvidos: supervisor depende disso pra ver "tá
    # duplicando com setor X" mesmo sem acesso ao doc cross-setor.
    setores_envolvidos = sorted(
        {d.get("agenteSetor") for _, d, _ in transactions_in_group if d.get("agenteSetor")}
    )
    # Info detalhada (uid + nome + setor), usado na UI pra mostrar "Lucas
    # (Premium)" mesmo quando o supervisor não acessa o outro doc.
    agentes_info_map: dict[str, dict] = {}
    for _, d, _ in transactions_in_group:
        uid = d.get("agenteId")
        if not uid or uid in agentes_info_map:
            continue
        entry: dict = {"uid": uid}
        if d.get("agenteName"):
            entry["name"] = d.get("agenteName")
        if d.get("agenteSetor"):
            entry["setor"] = d.get("agenteSetor")
        agentes_info_map[uid] = entry
    agentes_info = sorted(agentes_info_map.values(), key=lambda x: x.get("name") or x["uid"])

    for doc_ref, data, doc_id in transactions_in_group:
        others_ids = [i for i in all_ids if i != doc_id]
        others_numbers = [
            n
            for n, did in zip(all_numbers, all_ids)
            if did != doc_id and n is not None
        ]
        update_payload: dict = {
            "systemValidation": "duplicate",
            "isActivation": False,
            "matchedTransactionId": firestore.DELETE_FIELD,
            "bestCandidate": firestore.DELETE_FIELD,
            "validationChecks": {
                "id_check": True,
                "value_check": True,
                "currency_check": True,
                "date_check": True,
                "same_row_check": True,
                "duplicate_check": True,
            },
            "duplicateAlert": {
                "crossAgent": cross_agent,
                "agentes": sorted(agentes),
                "linkedTransactionIds": others_ids,
                "linkedTransactionNumbers": others_numbers,
                "setores": setores_envolvidos,
                "agentesInfo": agentes_info,
            },
            "validatedAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        doc_ref.update(update_payload)
        if data.get("systemValidation") != "duplicate":
            stats["duplicate"] += 1
        log.warning(
            f"  duplicate {doc_id} (cross_agent={cross_agent}, linked={others_numbers or others_ids})"
        )


def process_group(
    bq: bigquery.Client,
    fs: firestore.Client,
    project: str,
    key: tuple,
    transactions: list[tuple],
    stats: dict[str, int],
) -> None:
    client_id, amount, currency, transaction_date = key
    log.info(
        f"grupo (clientId={client_id}, amount={amount}, currency={currency}, "
        f"date={transaction_date}) com {len(transactions)} pending"
    )

    candidates = query_source_candidates(bq, project, client_id, amount, currency, transaction_date)
    # País (ISO-2) e parceria (PartnerCode) por source id, vêm de graça no candidates
    # query (sem query extra). Informativos: `sourceCountry` (mapa) e
    # `sourcePartnerCode` (indicador "Fora da parceria"). Não tocam validação.
    id_to_country = {c["id"]: c.get("country") for c in candidates}
    id_to_masterib = {c["id"]: c.get("partner_code") for c in candidates}

    # Busca TODOS os transactions do grupo (qualquer status) pra detectar conflito.
    all_in_group = list_all_in_group(fs, key)
    log.info(
        f"  candidates={len(candidates)} validators_total={len(all_in_group)}"
    )

    # CASO 1: nenhum candidato no source → regra de timing (12h pos fim do dia BRT)
    if not candidates:
        partial_checks_cache: dict | None = None
        best_cache: dict | None = None
        best_queried = False
        for doc_ref, data in transactions:
            if partial_checks_cache is None:
                partial_checks_cache = query_partial_checks(
                    bq, project, client_id, amount, currency, transaction_date
                )
            if not best_queried:
                best_cache = query_best_candidate(
                    bq, project, client_id, amount, currency, transaction_date
                )
                best_queried = True
            checks = dict(partial_checks_cache)
            checks["same_row_check"] = False
            checks["duplicate_check"] = False

            best_payload = best_cache if best_cache else firestore.DELETE_FIELD

            if can_invalidate_now(transaction_date):
                doc_ref.update(
                    {
                        "systemValidation": "invalid",
                        "isActivation": False,
                        "matchedTransactionId": firestore.DELETE_FIELD,
                        "duplicateAlert": firestore.DELETE_FIELD,
                        "validationChecks": checks,
                        "bestCandidate": best_payload,
                        "validatedAt": firestore.SERVER_TIMESTAMP,
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    }
                )
                stats["invalid"] += 1
                log.info(f"  invalid {doc_ref.id} (sem candidatos no source)")
            else:
                # Reset explicito pra 'pending' (importante quando entrou aqui sendo 'duplicate' antigo)
                doc_ref.update(
                    {
                        "systemValidation": "pending",
                        "isActivation": False,
                        "matchedTransactionId": firestore.DELETE_FIELD,
                        "duplicateAlert": firestore.DELETE_FIELD,
                        "validationChecks": checks,
                        "bestCandidate": best_payload,
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    }
                )
                stats["still_pending"] += 1
                log.info(
                    f"  pending {doc_ref.id} (aguardando 12h pos fim do dia BRT do transactionDate)"
                )
        return

    # CASO 2: mais Validator transactions do que transacoes no source → TODOS duplicate
    if len(all_in_group) > len(candidates):
        if len(all_in_group) > 1 and len({a for _, d, _ in all_in_group for a in [d.get("agenteId")] if a}) > 1:
            stats["fraud_alerts"] += 1
        mark_all_duplicate(all_in_group, stats)
        return

    # CASO 3: validator <= source → cada um consome uma transacao distinta (FIFO por createdAt)
    all_in_group.sort(
        key=lambda x: x[1].get("createdAt") or datetime.min.replace(tzinfo=timezone.utc)
    )
    # IDs ja consumidos por verifieds existentes
    already_assigned: dict[str, int] = {}
    for _, data, doc_id in all_in_group:
        if data.get("systemValidation") == "verified":
            tid = data.get("matchedTransactionId")
            if tid:
                try:
                    already_assigned[doc_id] = int(tid)
                except (TypeError, ValueError):
                    pass
    consumed_ids = set(already_assigned.values())
    available_ids = [c["id"] for c in candidates if c["id"] not in consumed_ids]

    for doc_ref, data, doc_id in all_in_group:
        if data.get("systemValidation") == "verified" and doc_id in already_assigned:
            # mantem como esta (idempotente)
            continue
        if not available_ids:
            # nao deveria acontecer (validator <= source) mas defensive
            log.warning(f"  {doc_id}: sem available_ids inesperado")
            continue
        match_id = available_ids.pop(0)
        act = is_activation(bq, fs, project, client_id, match_id, current_transaction_id=doc_id)
        lod = query_last_operation_date(bq, project, client_id)
        country = id_to_country.get(match_id)
        partner_code = id_to_masterib.get(match_id)
        update_payload = {
            "systemValidation": "verified",
            "isActivation": act,
            "matchedTransactionId": str(match_id),
            "validationChecks": {
                "id_check": True,
                "value_check": True,
                "currency_check": True,
                "date_check": True,
                "same_row_check": True,
                "duplicate_check": False,
            },
            "bestCandidate": firestore.DELETE_FIELD,
            "duplicateAlert": firestore.DELETE_FIELD,
            "lastOperationDate": lod,
            "validatedAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        if country:
            update_payload["sourceCountry"] = country
        # match_id sempre vem de candidates → grava sourcePartnerCode sempre
        # (None = orgânico/sem parceria, distinto de não-consultado).
        update_payload["sourcePartnerCode"] = partner_code
        doc_ref.update(update_payload)
        stats["verified"] += 1
        log.info(
            f"  verified {doc_id} (matched {match_id}, activation={act}, "
            f"lod={lod!r}, country={country!r}, partner_code={partner_code!r})"
        )


def main() -> None:
    load_dotenv(".env.local")

    project = required_env("GCP_PROJECT_ID")
    # Modo do Job: controlado por env var:
    #   "validate" (default): só processa pending+duplicate. Roda a cada 30min.
    #   "lod_refresh": só refresca lastOperationDate em ativações verified.
    #     Roda 1×/dia (a operação no source raramente muda em janela curta).
    #   "all" (legado): faz os dois: útil pra disparos manuais.
    mode = os.environ.get("VALIDATOR_MODE", "validate").lower()
    log.info(f"Validating transactions in project {project} (mode={mode})")

    fs = firestore.Client(project=project)
    bq = bigquery.Client(project=project)

    stats = {
        "verified": 0,
        "duplicate": 0,
        "invalid": 0,
        "still_pending": 0,
        "fraud_alerts": 0,
    }

    if mode in ("validate", "all"):
        # Reprocessa pending E duplicate. Duplicate eh incluido pra resolver casos onde
        # outro transaction do grupo saiu (via edit) e o que sobrou deveria virar verified
        # mas ficou "preso" como duplicate.
        candidates = list(
            fs.collection(TRANSACTIONS_COLLECTION)
            .where(filter=firestore.FieldFilter("systemValidation", "in", ["pending", "duplicate"]))
            .stream()
        )
        log.info(f"Found {len(candidates)} transactions to review (pending or duplicate)")

        if candidates:
            groups: dict[tuple, list[tuple]] = defaultdict(list)
            for doc_snap in candidates:
                data = doc_snap.to_dict() or {}
                key = (
                    data.get("clientId"),
                    float(data.get("amount") or 0),
                    data.get("currency"),
                    data.get("transactionDate"),
                )
                if not all(k is not None for k in key):
                    log.warning(f"transaction {doc_snap.id} sem campos suficientes, pulando")
                    continue
                groups[key].append((doc_snap.reference, data))

            for key, transactions in groups.items():
                try:
                    process_group(bq, fs, project, key, transactions, stats)
                except Exception as e:
                    log.exception(f"Erro processando grupo {key}: {e}")

    if mode in ("lod_refresh", "all"):
        # Pass: refresca `lastOperationDate` em ativacoes ja verificadas que
        # ainda nao bateram a regra "operou apos o transacao". Cliente pode ter
        # operado depois da primeira validacao: sem esse pass, comissao do 1%
        # nunca seria liberada. Operacao no source raramente muda intra-dia,
        # rodar 1×/dia é suficiente.
        refresh_activation_eligibility(bq, fs, project, stats)

        # Backfill/refresh da classificação Premium/Starter (CRM Pipedrive),
        # também 1×/dia. Registros NOVOS já são classificados na hora pela
        # Cloud Function on_transaction_create; este pass é a rede de segurança
        # pra docs pré-feature e pra reclassificar quando email/telefone mudou.
        classify_pipedrive_pass(bq, fs, project, stats)

    # 🚨 SEMPRE roda a auditoria de ativações (mesmo no mode `validate`).
    # É a camada de defesa contra falso positivo (decisão 2026-05-20).
    # Volume tipico: 30 transactions ativados × 1 query de ~7MB = ~210MB scan/run.
    # A cada 30min = ~10GB/mes ~= $0.05, trivial.
    audit_activations_pass(bq, fs, project, stats)

    log.info(f"Done. {stats}")


def refresh_activation_eligibility(
    bq: bigquery.Client,
    fs: firestore.Client,
    project: str,
    stats: dict[str, int],
) -> None:
    """Itera verified+isActivation cuja eligibilidade ainda nao foi confirmada
    (lastOperationDate ausente, None ou <= transactionDate) e refaz a query."""
    stats["lod_refreshed"] = 0
    stats["lod_unlocked"] = 0

    q = (
        fs.collection(TRANSACTIONS_COLLECTION)
        .where(filter=firestore.FieldFilter("systemValidation", "==", "verified"))
        .where(filter=firestore.FieldFilter("isActivation", "==", True))
    )

    # Limita a uma janela razoavel (90 dias) pra nao escanear historico antigo
    today = datetime.now(BRT).date()
    cutoff = today - timedelta(days=90)

    for doc_snap in q.stream():
        data = doc_snap.to_dict() or {}
        transaction_date_str = data.get("transactionDate")
        if not transaction_date_str:
            continue
        try:
            dd = date.fromisoformat(transaction_date_str)
        except (TypeError, ValueError):
            continue
        if dd < cutoff:
            continue

        current_lod = data.get("lastOperationDate")
        # Pula se ja temos uma data de operacao no mesmo dia ou posterior
        # (regra 2026-05-20: mesmo dia conta como elegivel, `>=` em vez de `>`).
        if isinstance(current_lod, str):
            try:
                if date.fromisoformat(current_lod[:10]) >= dd:
                    continue
            except ValueError:
                pass

        client_id = data.get("clientId")
        if not client_id:
            continue

        try:
            lod = query_last_operation_date(bq, project, client_id)
        except Exception as e:
            log.exception(f"  refresh_lod {doc_snap.id} falhou: {e}")
            continue

        # So escreve se mudou (evita writes desnecessarios)
        should_skip = False
        if isinstance(lod, str) and isinstance(current_lod, str) and lod == current_lod:
            should_skip = True
        elif lod is None and current_lod is None:
            should_skip = True
        elif lod is firestore.DELETE_FIELD and current_lod is None:
            # nao conseguimos consultar agora, mas ja sabiamos que era null:
            # preserva a info ao inves de deletar o campo
            should_skip = True
        if should_skip:
            continue

        doc_snap.reference.update(
            {
                "lastOperationDate": lod,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
        )
        stats["lod_refreshed"] += 1
        # "unlocked" = passou a ser elegivel ao 1% (regra 2026-05-20: `>=`)
        if isinstance(lod, str):
            try:
                if date.fromisoformat(lod[:10]) >= dd:
                    stats["lod_unlocked"] += 1
                    log.info(
                        f"  unlocked {doc_snap.id} (transaction {transaction_date_str} → lod {lod})"
                    )
            except ValueError:
                pass


def audit_activations_pass(
    bq: bigquery.Client,
    fs: firestore.Client,
    project: str,
    stats: dict[str, int],
) -> None:
    """Audit automático: defesa contra falso positivo de `isActivation`.

    Cross-check independente: pra cada transaction Firestore com `isActivation=true`,
    re-deriva via SQL RAW (sem a view) se o `matchedTransactionId` é mesmo a
    primeira tx do from_user_id. Se discordar da view ou se for falso positivo,
    auto-corrige e grava reporte em `/audit_reports/{timestamp}`.

    Roda a CADA execução do validator-validation (cada 30min). Volume típico:
    ~30 transactions ativados × 1 query agregada = ~50MB scan / run.

    Estados possíveis no report:
      - `clean`: tudo OK (mantém também `/audit_status/current` com lastCleanAt)
      - `auto_fixed`: detectou falsos positivos, corrigiu, lista no report
      - `view_disagreement`: view e raw discordam (CRÍTICO, NÃO auto-corrige,
        deixa intervenção manual; é um bug na view)
    """
    stats["audit_checked"] = 0
    stats["audit_auto_fixed"] = 0
    stats["audit_view_disagreement"] = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Pega todos os isActivation=true do Firestore
    transactions = list(
        fs.collection(TRANSACTIONS_COLLECTION)
        .where(filter=firestore.FieldFilter("isActivation", "==", True))
        .stream()
    )

    pairs: list[tuple] = []  # (doc_id, data, matched_id)
    for d in transactions:
        data = d.to_dict() or {}
        mid_str = data.get("matchedTransactionId")
        if not mid_str:
            continue
        try:
            pairs.append((d.id, data, int(mid_str)))
        except (TypeError, ValueError):
            continue

    stats["audit_checked"] = len(pairs)

    if not pairs:
        _write_audit_report(fs, now_iso, status="clean", checked=0, fixed=[], disagreements=[])
        return

    matched_ids = sorted({m for _, _, m in pairs})

    # 2. Cross-check RAW (sem usar a view): pra cada matched_id, qual é o
    #    earliest do from_user_id?
    sql_raw = f"""
    WITH targets AS (
      SELECT id FROM UNNEST(@ids) AS id
    ),
    target_users AS (
      SELECT b.id AS matched_id, b.from_user_id
      FROM `{project}.{SOURCE_DATASET}.{SOURCE_TABLE}` b
      JOIN targets t ON b.id = t.id
    ),
    user_earliest AS (
      SELECT
        from_user_id,
        ARRAY_AGG(id ORDER BY created_at_brt_copy ASC, id ASC LIMIT 1)[OFFSET(0)] AS earliest_id
      FROM `{project}.{SOURCE_DATASET}.{SOURCE_TABLE}`
      WHERE from_user_id IN (
        SELECT DISTINCT from_user_id FROM target_users WHERE from_user_id IS NOT NULL
      )
      GROUP BY from_user_id
    )
    SELECT tu.matched_id, tu.from_user_id, ue.earliest_id
    FROM target_users tu
    LEFT JOIN user_earliest ue USING (from_user_id)
    """
    job = bq.query(
        sql_raw,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ArrayQueryParameter("ids", "INT64", matched_ids),
            ]
        ),
    )
    raw_map: dict[int, dict] = {}
    for row in job:
        raw_map[int(row["matched_id"])] = {
            "from_user_id": row["from_user_id"],
            "earliest_id": int(row["earliest_id"]) if row["earliest_id"] is not None else None,
        }

    # 3. Cross-check da VIEW (que o validator usa em produção)
    sql_view = f"""
    SELECT id, is_user_first_transaction
    FROM `{project}.{SOURCE_DATASET}.{SOURCE_ENRICHED_VIEW}`
    WHERE id IN UNNEST(@ids)
    """
    job_view = bq.query(
        sql_view,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ArrayQueryParameter("ids", "INT64", matched_ids),
            ]
        ),
    )
    view_map: dict[int, bool] = {int(r["id"]): bool(r["is_user_first_transaction"]) for r in job_view}

    # 4. View e raw concordam? Se não, ABORTA auto-fix (problema sistêmico)
    disagreements: list[dict] = []
    for mid, raw in raw_map.items():
        if raw["from_user_id"] is None or raw["earliest_id"] is None:
            continue
        view_says = view_map.get(mid)
        audit_says = raw["earliest_id"] == mid
        if view_says is not None and view_says != audit_says:
            disagreements.append({"matched_id": mid, "view": view_says, "audit_raw": audit_says})

    if disagreements:
        stats["audit_view_disagreement"] = len(disagreements)
        log.error(
            f"AUDIT: view × raw DIVERGEM em {len(disagreements)} linhas, abortando auto-fix"
        )
        _write_audit_report(
            fs,
            now_iso,
            status="view_disagreement",
            checked=len(pairs),
            fixed=[],
            disagreements=disagreements,
        )
        return

    # 5. Identifica falsos positivos e corrige
    fixed: list[dict] = []
    for doc_id, data, mid in pairs:
        raw = raw_map.get(mid)
        if raw is None:
            # matched_id sumiu do source: anômalo, registra mas não toca
            continue
        if raw["from_user_id"] is None or raw["earliest_id"] is None:
            # without from_user_id não dá pra agrupar → defensive: falso positivo
            should_be_activation = False
        else:
            should_be_activation = raw["earliest_id"] == mid

        if not should_be_activation:
            # Auto-corrige
            ref = fs.collection(TRANSACTIONS_COLLECTION).document(doc_id)
            ref.update(
                {
                    "isActivation": False,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }
            )
            fixed.append(
                {
                    "docId": doc_id,
                    "transactionNumber": data.get("transactionNumber"),
                    "agenteName": data.get("agenteName"),
                    "agenteSetor": data.get("agenteSetor"),
                    "clientId": data.get("clientId"),
                    "matchedTransactionId": mid,
                    "earliestTransactionId": raw["earliest_id"],
                    "transactionDate": data.get("transactionDate"),
                }
            )
            log.warning(
                f"AUDIT: auto-fix {doc_id} (transaction #{data.get('transactionNumber')}) "
                f"matched={mid} earliest={raw['earliest_id']}"
            )

    stats["audit_auto_fixed"] = len(fixed)
    _write_audit_report(
        fs,
        now_iso,
        status="auto_fixed" if fixed else "clean",
        checked=len(pairs),
        fixed=fixed,
        disagreements=[],
    )


def _write_audit_report(
    fs: firestore.Client,
    when_iso: str,
    status: str,
    checked: int,
    fixed: list[dict],
    disagreements: list[dict],
) -> None:
    """Grava o report em /audit_reports/{ts} e atualiza /audit_status/current.

    /audit_status/current sempre tem o LAST RUN, pra UI mostrar status atual
    sem precisar paginar a coleção de history. Os reports históricos ficam
    em /audit_reports pra investigação se preciso.
    """
    doc_id = when_iso.replace(":", "-")
    report = {
        "ranAt": firestore.SERVER_TIMESTAMP,
        "status": status,
        "checked": checked,
        "fixedCount": len(fixed),
        "fixed": fixed,
        "disagreementCount": len(disagreements),
        "disagreements": disagreements,
    }
    fs.collection("audit_reports").document(doc_id).set(report)
    fs.collection("audit_status").document("current").set(
        {
            "lastRunAt": firestore.SERVER_TIMESTAMP,
            "status": status,
            "checked": checked,
            "fixedCount": len(fixed),
            "disagreementCount": len(disagreements),
            "lastReportId": doc_id,
        }
    )


# ---------------------------------------------------------------------------
# Classificação Premium/Starter via CRM (Pipedrive espelhado no BigQuery).
# Gêmea da lógica em functions/main.py: INDEPENDENTE da validação da origem.
# Ver domain_premium_starter_pipedrive em memory.
# ---------------------------------------------------------------------------


def _digits(value) -> str:
    """Só os dígitos (remove +, espaços, parênteses, traços)."""
    return re.sub(r"[^0-9]", "", str(value or ""))


def phone_tail(phone) -> str:
    """Sufixo do telefone pra match tolerante a DDI/máscara (número nacional BR
    = DDD+9 dígitos = 11). Vazio se < 10 dígitos (evita falso positivo por
    sufixo curto). Ver docstring gêmea em functions/main.py."""
    d = _digits(phone)
    if len(d) < 10:
        return ""
    return d[-11:] if len(d) >= 11 else d


def norm_email(email) -> str:
    return str(email or "").strip().lower()


# Bumpar FORÇA reclassificação de todos os docs (invalida o cache da chave).
# v2 = passou a gravar pipedriveStage (etapa no Pipedrive). Manter igual ao
# gêmeo em functions/main.py.
PIPEDRIVE_KEY_VERSION = "v2"


def pipedrive_key(email, phone) -> str:
    """Chave (versão|email|sufixoTelefone): muda quando email/telefone muda OU
    quando o schema (PIPEDRIVE_KEY_VERSION) muda."""
    return f"{PIPEDRIVE_KEY_VERSION}|{norm_email(email)}|{phone_tail(phone)}"


def classify_pipedrive_membership(bq: bigquery.Client, email, phone) -> dict:
    """Bate email OU telefone no CRM; duplicidade vence pelo `add_time` mais
    recente. subconta PRM→'premium', STR→'starter'; sem match → 'nao_encontrado'.
    Retorna {tribe, matched_by, add_time}. Não trata exceção (chamador envolve)."""
    em = norm_email(email)
    tail = phone_tail(phone)
    if not em and not tail:
        return {"tribe": "nao_encontrado", "matched_by": None, "add_time": None, "stage": None}
    sql = f"""
    SELECT
      UPPER(TRIM(CAST(subconta AS STRING))) AS subconta,
      add_time,
      NULLIF(TRIM(CAST(stage_name AS STRING)), '') AS stage_name,
      NULLIF(TRIM(CAST(origem AS STRING)), '') AS origem,
      (@email != '' AND LOWER(TRIM(person_email)) = @email) AS by_email
    FROM `{PIPEDRIVE_PROJECT}.{PIPEDRIVE_DATASET}.{PIPEDRIVE_TABLE}`
    WHERE
      (@email != '' AND LOWER(TRIM(person_email)) = @email)
      OR (@tail != '' AND ENDS_WITH(REGEXP_REPLACE(IFNULL(CAST(person_phone AS STRING), ''), r'[^0-9]', ''), @tail))
    ORDER BY add_time DESC
    LIMIT 1
    """
    job = bq.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("email", "STRING", em),
                bigquery.ScalarQueryParameter("tail", "STRING", tail),
            ]
        ),
    )
    row = next(iter(job), None)
    if row is None:
        return {"tribe": "nao_encontrado", "matched_by": None, "add_time": None, "stage": None}
    tribe = SUBCONTA_MAP.get((row["subconta"] or "").strip())
    if tribe is None:
        return {"tribe": "nao_encontrado", "matched_by": None, "add_time": None, "stage": None}
    add_time = row["add_time"].isoformat() if row["add_time"] is not None else None
    stage = row["stage_name"] or row["origem"] or None
    return {
        "tribe": tribe,
        "matched_by": "email" if row["by_email"] else "phone",
        "add_time": add_time,
        "stage": stage,
    }


def classify_pipedrive_pass(
    bq: bigquery.Client,
    fs: firestore.Client,
    project: str,  # noqa: ARG001 - Pipedrive vive em projeto próprio (PIPEDRIVE_PROJECT)
    stats: dict[str, int],
    limit: int = 500,
) -> None:
    """Classifica (Premium/Starter/Não encontrado) todos os transactions cuja chave
    (email|telefone) ainda não foi classificada ou mudou.

    Bounded: no máximo `limit` queries ao CRM por execução, o resto fica pro
    próximo run (backfill converge em poucos dias; steady-state = 0 queries,
    porque a Cloud Function já classifica registro novo na hora). DEFENSIVO:
    falha num doc não interrompe o pass; sem acesso ao CRM, nada é gravado.
    """
    stats["pipedrive_classified"] = 0
    stats["pipedrive_capped"] = 0
    processed = 0
    for doc_snap in fs.collection(TRANSACTIONS_COLLECTION).stream():
        data = doc_snap.to_dict() or {}
        email = data.get("clientEmail")
        phone = data.get("clientPhone")
        key = pipedrive_key(email, phone)
        # Já classificado pra essa chave → nada a fazer (sem query BQ).
        if data.get("pipedriveKey") == key and data.get("pipedriveTribe"):
            continue
        if processed >= limit:
            stats["pipedrive_capped"] += 1
            continue
        processed += 1
        try:
            result = classify_pipedrive_membership(bq, email, phone)
        except Exception as e:
            log.warning(f"  pipedrive classify {doc_snap.id} falhou (sem acesso ao CRM?): {e}")
            continue
        doc_snap.reference.update(
            {
                "pipedriveTribe": result["tribe"],
                "pipedriveKey": key,
                "pipedriveMatchedBy": result["matched_by"] or firestore.DELETE_FIELD,
                "pipedriveDealAddTime": result["add_time"] or firestore.DELETE_FIELD,
                "pipedriveStage": result.get("stage") or firestore.DELETE_FIELD,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
        )
        stats["pipedrive_classified"] += 1
    if stats["pipedrive_capped"]:
        log.info(
            f"pipedrive: {stats['pipedrive_classified']} classificados, "
            f"{stats['pipedrive_capped']} adiados pro próximo run (limit={limit})"
        )


if __name__ == "__main__":
    main()
