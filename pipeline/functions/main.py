"""
Cloud Function gen2: validacao instantanea de transaction recem-criado.

Trigger: Firestore document.created em transactions/{transactionId}

Comportamento:
- Achou match unico no source_transactions -> valida na hora (verified)
- Achou candidato mas ja consumido por outro -> duplicate (com alerta de fraude se agentes diferentes)
- Nao achou nada -> NAO MEXE (deixa o scheduler 30min cuidar com a logica de 12h pending -> invalid)

Logica per-transaction-only. O batch + janela de 12h ficam por conta do validate.py scheduled.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import functions_framework
from cloudevents.http import CloudEvent
from google.cloud import bigquery, firestore

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

PROJECT = os.environ.get("GCP_PROJECT_ID", "validator-demo-project")
SOURCE_DATASET = os.environ.get("GCP_BQ_DATASET", "origem")
SOURCE_TABLE = "source_transactions"
TRANSACTIONS_COLLECTION = "transactions"
POST_TRANSACTION_GRACE_HOURS = 12
BRT = ZoneInfo("America/Sao_Paulo")

# CRM Pipedrive espelhado no BigQuery: vive em OUTRO projeto (`crm-demo-project`), mas
# faturado/consultado a partir da mesma service account. Só LEITURA, nunca
# escrevemos nada lá. A SA do runtime precisa de BigQuery Data Viewer nesse
# dataset (+ Job User no projeto de faturamento). Sem acesso, a classificação
# falha de forma DEFENSIVA (loga e não grava) e a validação segue normal.
PIPEDRIVE_PROJECT = os.environ.get("PIPEDRIVE_PROJECT", "crm-demo-project")
PIPEDRIVE_DATASET = os.environ.get("PIPEDRIVE_DATASET", "Pipedrive_gcf")
PIPEDRIVE_TABLE = os.environ.get("PIPEDRIVE_TABLE", "deals_all_primary")
# PRM = Premium (produto mais caro), STR = Starter (entrada mais barata).
SUBCONTA_MAP = {"PRM": "premium", "STR": "starter"}

_bq: bigquery.Client | None = None
_fs: firestore.Client | None = None


def get_bq() -> bigquery.Client:
    global _bq
    if _bq is None:
        _bq = bigquery.Client(project=PROJECT)
    return _bq


def get_fs() -> firestore.Client:
    global _fs
    if _fs is None:
        _fs = firestore.Client(project=PROJECT)
    return _fs


def extract_transaction_id(cloud_event: CloudEvent) -> str | None:
    """Subject typicamente eh 'documents/transactions/{id}'."""
    subject = cloud_event.get("subject") or ""
    parts = subject.split("/")
    if len(parts) >= 3 and parts[-2] == "transactions":
        return parts[-1]
    return None


@functions_framework.cloud_event
def on_transaction_create(cloud_event: CloudEvent) -> None:
    transaction_id = extract_transaction_id(cloud_event)
    if not transaction_id:
        log.warning(f"could not extract transaction id from subject: {cloud_event.get('subject')}")
        return

    log.info(f"on_transaction_create: {transaction_id}")
    try:
        try_instant_validate(transaction_id)
    except Exception as e:
        log.exception(f"erro validating {transaction_id}: {e}")
    # Classificação Premium/Starter (CRM): INDEPENDENTE da validação da origem.
    # Isolada em try/except: NUNCA pode quebrar o fluxo de validação.
    try:
        classify_pipedrive(transaction_id)
    except Exception as e:
        log.exception(f"erro classify_pipedrive {transaction_id}: {e}")


@functions_framework.cloud_event
def on_transaction_update(cloud_event: CloudEvent) -> None:
    """
    Fires em UPDATE de transactions/. Re-roda validacao quando systemValidation eh 'pending'.

    Casos cobertos:
    - Admin aprova edicao que mudou match key (transaction volta pra pending).
    - Lib reseta transactions linkados ao editado (eles tambem voltam pra pending).
    - Qualquer outra transicao manual pra pending.

    try_instant_validate eh idempotente: se nao estiver pending, retorna no-op.
    Funcao nao gera loop porque o write a partir dela coloca em 'verified' ou
    'duplicate' ou 'invalid', nao em 'pending'.
    """
    transaction_id = extract_transaction_id(cloud_event)
    if not transaction_id:
        return
    try:
        try_instant_validate(transaction_id)
    except Exception as e:
        log.exception(f"erro on_transaction_update {transaction_id}: {e}")


def try_instant_validate(transaction_id: str) -> None:
    fs = get_fs()
    bq = get_bq()

    doc_ref = fs.collection(TRANSACTIONS_COLLECTION).document(transaction_id)
    snap = doc_ref.get()
    if not snap.exists:
        log.info(f"{transaction_id}: doc nao existe (deletado?)")
        return

    data = snap.to_dict() or {}
    if data.get("systemValidation") != "pending":
        log.info(f"{transaction_id}: nao esta pending (estado: {data.get('systemValidation')}), skip")
        return

    client_id = data.get("clientId")
    amount = data.get("amount")
    currency = data.get("currency")
    transaction_date = data.get("transactionDate")

    if not all([client_id, amount, currency, transaction_date]):
        log.warning(f"{transaction_id}: campos insuficientes (clientId={client_id}, amount={amount})")
        return

    # 1) Procurar candidatos no source
    candidates = query_source_candidates(bq, client_id, amount, currency, transaction_date)
    log.info(f"{transaction_id}: {len(candidates)} candidates no source")

    if not candidates:
        # Sem match. Pode invalidar agora se ja passou 12h pos fim do dia BRT do transactionDate.
        if can_invalidate_now(transaction_date):
            checks = query_partial_checks(bq, client_id, amount, currency, transaction_date)
            checks["same_row_check"] = False
            checks["duplicate_check"] = False
            best = query_best_candidate(bq, client_id, amount, currency, transaction_date)
            doc_ref.update(
                {
                    "systemValidation": "invalid",
                    "validationChecks": checks,
                    "bestCandidate": best if best else firestore.DELETE_FIELD,
                    "validatedAt": firestore.SERVER_TIMESTAMP,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }
            )
            log.info(f"{transaction_id}: invalid imediato (transactionDate {transaction_date}, checks={checks}, best={best})")
        else:
            log.info(f"{transaction_id}: sem match, deixando pending pro scheduler")
        return

    # 2) Pega TODOS os transactions do grupo (qualquer status), pra detectar conflito.
    all_in_group = list_all_in_group(fs, client_id, amount, currency, transaction_date)
    log.info(
        f"{transaction_id}: validators_total={len(all_in_group)} candidates={len(candidates)}"
    )

    # 3) Mais Validators do que transacoes → ALL duplicate (inclusive verifieds antigos)
    if len(all_in_group) > len(candidates):
        mark_all_duplicate(all_in_group)
        return

    # 4) validators <= source → cada um consome uma transacao distinta (FIFO por createdAt)
    all_in_group.sort(
        key=lambda x: x[1].get("createdAt") or 0
    )
    consumed = set()
    for _, d, doc_id in all_in_group:
        if d.get("systemValidation") == "verified":
            tid = d.get("matchedTransactionId")
            if tid:
                try:
                    consumed.add(int(tid))
                except (TypeError, ValueError):
                    pass
    available = [c for c in candidates if c not in consumed]

    # Validar somente este transaction (o novo), os outros ja estao decididos ou serao
    # processados pelos seus proprios triggers / scheduler.
    if not available:
        log.warning(f"{transaction_id}: sem available apos consumo (race?), deixando pro scheduler")
        return

    matched = available[0]
    is_act = is_activation(bq, fs, client_id, matched, current_transaction_id=transaction_id)
    lod = query_last_operation_date(bq, client_id)
    meta = query_source_meta(bq, matched)
    update_data = {
        "systemValidation": "verified",
        "isActivation": is_act,
        "matchedTransactionId": str(matched),
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
    # country/partner_code sao puramente informativos. So grava se o lookup
    # funcionou (meta != None). partner_code=None significa "orgânico, sem parceria"
    # (distinto de não-consultado), entao grava o None explicitamente.
    if meta is not None:
        if meta.get("country"):
            update_data["sourceCountry"] = meta["country"]
        update_data["sourcePartnerCode"] = meta.get("partner_code")
    doc_ref.update(update_data)
    log.info(
        f"{transaction_id}: verified (matched source id {matched}, "
        f"activation={is_act}, lod={lod!r}, meta={meta!r})"
    )


def list_all_in_group(
    fs: firestore.Client, client_id, amount, currency: str, transaction_date: str
) -> list[tuple]:
    """Retorna [(doc_ref, data, doc_id), ...] de TODOS os transactions do grupo, qualquer status."""
    q = (
        fs.collection(TRANSACTIONS_COLLECTION)
        .where(filter=firestore.FieldFilter("clientId", "==", client_id))
        .where(filter=firestore.FieldFilter("amount", "==", float(amount)))
        .where(filter=firestore.FieldFilter("currency", "==", currency))
        .where(filter=firestore.FieldFilter("transactionDate", "==", transaction_date))
    )
    out: list[tuple] = []
    for doc in q.stream():
        out.append((doc.reference, doc.to_dict() or {}, doc.id))
    return out


def mark_all_duplicate(transactions_in_group: list[tuple]) -> None:
    """Marca TODOS os transactions do grupo como duplicate, com cross-reference."""
    agentes = {d.get("agenteId") for _, d, _ in transactions_in_group if d.get("agenteId")}
    cross_agent = len(agentes) > 1
    all_ids = [doc_id for _, _, doc_id in transactions_in_group]
    all_numbers = [d.get("transactionNumber") for _, d, _ in transactions_in_group]
    setores_envolvidos = sorted(
        {d.get("agenteSetor") for _, d, _ in transactions_in_group if d.get("agenteSetor")}
    )
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

    for doc_ref, _, doc_id in transactions_in_group:
        others_ids = [i for i in all_ids if i != doc_id]
        others_numbers = [
            n
            for n, did in zip(all_numbers, all_ids)
            if did != doc_id and n is not None
        ]
        doc_ref.update(
            {
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
        )
        log.warning(
            f"  duplicate {doc_id} (cross_agent={cross_agent}, linked={others_numbers or others_ids})"
        )


def coerce_login(client_id) -> str | None:
    """clientId no Validator = login (conta do cliente). STRING no source_transactions."""
    if client_id is None:
        return None
    s = str(client_id).strip()
    return s or None


def query_source_candidates(
    bq: bigquery.Client, client_id, amount, currency: str, transaction_date: str
) -> list[int]:
    login = coerce_login(client_id)
    if login is None:
        log.warning(f"login '{client_id}' vazio, sem candidatos")
        return []
    # Partition prune: tabela particionada por `created_date_brt`. Janela ±1 dia
    # cobre diferenças de timezone (created_at vs created_date_brt podem cair
    # em dias adjacentes em casos extremos). Sem isso a query fazia full scan.
    sql = f"""
    SELECT id
    FROM `{PROJECT}.{SOURCE_DATASET}.{SOURCE_TABLE}`
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
    return [int(r["id"]) for r in job]


def normalize_partner(value) -> str | None:
    """Normaliza partner_code (FLOAT no source, ex.: 90001.0) pra string "90001".
    None/vazio retorna None ("cliente sem parceria / orgânico")."""
    if value is None:
        return None
    try:
        return str(int(float(value)))
    except (TypeError, ValueError):
        s = str(value).strip()
        return s or None


def query_source_meta(bq: bigquery.Client, matched_id: int) -> dict | None:
    """country (ISO-2) e partner_code (id da parceria como str) da transacao casada.

    Isolado e DEFENSIVO de proposito: AMBOS sao puramente informativos
    (country alimenta o mapa; partner_code alimenta o indicador "Fora da parceria").
    NUNCA participam de match, ativacao ou comissao. Qualquer falha retorna
    None e a validacao segue normal. Point-lookup por id (tabela clusterizada
    por id): scan desprezivel.

    Retorno: None se a query falhar / sem linha; senao dict com:
      - "country": str ou ausente (se null no source)
      - "partner_code": str (tem parceria) ou None (orgânico, sem parceria)
    """
    try:
        sql = f"""
        SELECT country, partner_code
        FROM `{PROJECT}.{SOURCE_DATASET}.{SOURCE_TABLE}`
        WHERE id = @id
        LIMIT 1
        """
        job = bq.query(
            sql,
            job_config=bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("id", "INT64", int(matched_id)),
                ]
            ),
        )
        row = next(iter(job), None)
        if row is None:
            return None
        meta: dict = {"partner_code": normalize_partner(row["partner_code"])}
        if row["country"] is not None:
            c = str(row["country"]).strip().upper()
            if c:
                meta["country"] = c
        return meta
    except Exception as e:  # noqa: BLE001 - meta nunca pode quebrar validacao
        log.warning(f"source meta lookup falhou pra matched={matched_id}: {e}")
        return None


def query_consumed_and_agentes(
    fs: firestore.Client, client_id, amount, currency: str, transaction_date: str
) -> tuple[set[int], set[str]]:
    consumed: set[int] = set()
    agentes: set[str] = set()
    q = (
        fs.collection(TRANSACTIONS_COLLECTION)
        .where(filter=firestore.FieldFilter("clientId", "==", client_id))
        .where(filter=firestore.FieldFilter("amount", "==", float(amount)))
        .where(filter=firestore.FieldFilter("currency", "==", currency))
        .where(filter=firestore.FieldFilter("transactionDate", "==", transaction_date))
        .where(filter=firestore.FieldFilter("systemValidation", "==", "verified"))
    )
    for other in q.stream():
        d = other.to_dict() or {}
        tid = d.get("matchedTransactionId")
        if tid:
            try:
                consumed.add(int(tid))
            except (TypeError, ValueError):
                pass
        a = d.get("agenteId")
        if a:
            agentes.add(a)
    return consumed, agentes


def can_invalidate_now(transaction_date_str: str) -> bool:
    """True quando ja passaram >= 12h apos fim do dia BRT do transactionDate."""
    try:
        d = date.fromisoformat(transaction_date_str)
    except (TypeError, ValueError):
        return False
    end_of_day_brt = datetime.combine(d, time(23, 59, 59), tzinfo=BRT)
    return datetime.now(BRT) >= end_of_day_brt + timedelta(hours=POST_TRANSACTION_GRACE_HOURS)


def query_partial_checks(
    bq: bigquery.Client, client_id, amount, currency: str, transaction_date: str
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
    FROM `{PROJECT}.{SOURCE_DATASET}.{SOURCE_TABLE}`
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
    bq: bigquery.Client, client_id, amount, currency: str, transaction_date: str
) -> dict | None:
    """Login eh autoritativo: se existe na source, best candidate eh sempre uma
    tx desse login (loginMatch=True). Login so vira invalido se NAO existir.
    Ver docstring detalhada em validate.py."""
    login = coerce_login(client_id)
    if login is None:
        return None

    # Pass 1: login eh a chave; pega a melhor tx desse login.
    # Janela ±7 dias pra cobrir caso o agente preencher data errada por dias.
    # Sem o partition prune, full scan da tabela toda.
    sql_same_login = f"""
    SELECT
      id,
      processed_amount,
      processed_currency,
      DATE(created_at_brt_copy) AS source_date,
      (CASE WHEN processed_amount = @amount THEN 1 ELSE 0 END) AS amount_match,
      (CASE WHEN processed_currency = @currency THEN 1 ELSE 0 END) AS currency_match,
      (CASE WHEN DATE(created_at_brt_copy) = @transaction_date THEN 1 ELSE 0 END) AS date_match
    FROM `{PROJECT}.{SOURCE_DATASET}.{SOURCE_TABLE}`
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

    # Login NAO existe na source. Antigamente o codigo tentava um Pass 2
    # sugerindo uma tx de OUTRO login com 2+ campos batendo, mas isso
    # confundia o gestor (mostrava "amountMatch=True, dateMatch=True" pra uma
    # tx de outro cliente). Decisao 2026-05-26: se a login nao existe,
    # retorna None: a UI mostra apenas "conta do cliente nao encontrada".
    return None


def query_last_operation_date(bq: bigquery.Client, client_id):
    """Ver docstring em validate.py. Retorna ISO yyyy-mm-dd, None, ou DELETE_FIELD."""
    login = coerce_login(client_id)
    if login is None:
        return firestore.DELETE_FIELD
    sql = f"""
    SELECT MAX(DATE(last_operation_date)) AS lod,
           COUNTIF(login = @login) AS rows_count
    FROM `{PROJECT}.{SOURCE_DATASET}.{SOURCE_TABLE}`
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
        return firestore.DELETE_FIELD
    if row["lod"] is None:
        return None
    return row["lod"].isoformat()


SOURCE_ENRICHED_VIEW = "source_transactions_enriched"


def is_activation(
    bq: bigquery.Client,
    fs_client,  # noqa: ARG001 - mantido por compat
    client_id,  # noqa: ARG001 - mantido por compat; agora não é mais usado
    matched_id: int,
    current_transaction_id: str | None = None,  # noqa: ARG001
) -> bool:
    """isActivation = a tx `matched_id` está marcada como primeira do from_user_id
    na view `source_transactions_enriched`.

    🚨 ARQUITETURA (decisão 2026-05-20 r2): NÃO calculamos ativação em Python.
    Lemos o boolean `is_user_first_transaction` que vem da view BigQuery
    `origem.source_transactions_enriched`. UMA SQL define o que é "primeira tx"
    via `FIRST_VALUE() OVER (PARTITION BY from_user_id ORDER BY created_at_brt_copy, id)`.
    Esta função em `functions/main.py` e a gêmea em `pipeline/validate.py`
    leem do MESMO view: impossível divergir.

    Ver `feedback_validacao_zero_falso_positivo.md` em memory.
    """
    sql = f"""
    SELECT is_user_first_transaction
    FROM `{PROJECT}.{SOURCE_DATASET}.{SOURCE_ENRICHED_VIEW}`
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
        return False
    return bool(row["is_user_first_transaction"])


# ---------------------------------------------------------------------------
# Classificação Premium/Starter via CRM (Pipedrive espelhado no BigQuery).
# Independente da validação da origem. Ver domain_premium_starter_pipedrive.
# ---------------------------------------------------------------------------


def _digits(value) -> str:
    """Só os dígitos de uma string (remove +, espaços, parênteses, traços)."""
    return re.sub(r"[^0-9]", "", str(value or ""))


def phone_tail(phone) -> str:
    """Sufixo do telefone pra match tolerante a DDI/máscara.

    O Validator guarda `clientPhone` como "+55 11999998888"; o Pipedrive pode
    guardar com/sem DDI e com máscara. Normalizamos os dois lados pra dígitos e
    comparamos por SUFIXO (número nacional BR = DDD+9 dígitos = 11). Retorna
    string vazia quando há < 10 dígitos, evita match por sufixo curto (falso
    positivo). Com 10 (fixo) usa os 10; com 11+ usa os últimos 11.
    """
    d = _digits(phone)
    if len(d) < 10:
        return ""
    return d[-11:] if len(d) >= 11 else d


def norm_email(email) -> str:
    return str(email or "").strip().lower()


# Versão do schema de classificação. Bumpar FORÇA reclassificação de todos os
# docs (a chave muda → cache invalida), use quando adicionar campos novos
# vindos do CRM (ex.: v2 = passou a gravar pipedriveStage).
PIPEDRIVE_KEY_VERSION = "v2"


def pipedrive_key(email, phone) -> str:
    """Chave determinística (versão|email|sufixoTelefone), muda quando
    email/telefone muda OU quando o schema (PIPEDRIVE_KEY_VERSION) muda. Usada
    pra decidir se precisa reclassificar (evita query BQ à toa)."""
    return f"{PIPEDRIVE_KEY_VERSION}|{norm_email(email)}|{phone_tail(phone)}"


def classify_pipedrive_membership(bq: bigquery.Client, email, phone) -> dict:
    """Bate email OU telefone no CRM e devolve o tipo de membro.

    - Match por `person_email` (exato, lowercased) OU `person_phone` (sufixo
      dos dígitos). Se casar por qualquer um dos dois, já classifica.
    - Duplicidade: vence o deal de `add_time` MAIS RECENTE (o mais novo comprado).
    - `subconta`: PRM→'premium', STR→'starter'. Qualquer outra coisa / sem match
      → 'nao_encontrado'.
    - `stage`: etapa no Pipedrive (`stage_name`); quando vazia, cai pra `origem`.

    Retorna dict {tribe, matched_by, add_time, stage}. NÃO trata exceção, o
    chamador envolve em try/except (falha = não grava, registro fica sem tag).
    """
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
        # subconta fora de PRM/STR: não é Premium nem Starter.
        return {"tribe": "nao_encontrado", "matched_by": None, "add_time": None, "stage": None}
    add_time = row["add_time"].isoformat() if row["add_time"] is not None else None
    # Etapa no Pipedrive: stage_name; se vazia, cai pra origem.
    stage = row["stage_name"] or row["origem"] or None
    return {
        "tribe": tribe,
        "matched_by": "email" if row["by_email"] else "phone",
        "add_time": add_time,
        "stage": stage,
    }


def classify_pipedrive(transaction_id: str) -> None:
    """Grava `pipedriveTribe` (+ matchedBy/addTime/key) no doc do registro.

    Idempotente: se a chave (email|telefone) não mudou e já há classificação,
    não refaz (nem consulta o BQ). Re-lê o doc antes de escrever pra não pisar
    no que a validação acabou de gravar (update parcial só toca os campos
    pipedrive*).
    """
    fs = get_fs()
    bq = get_bq()
    doc_ref = fs.collection(TRANSACTIONS_COLLECTION).document(transaction_id)
    snap = doc_ref.get()
    if not snap.exists:
        return
    data = snap.to_dict() or {}
    email = data.get("clientEmail")
    phone = data.get("clientPhone")
    key = pipedrive_key(email, phone)
    if data.get("pipedriveKey") == key and data.get("pipedriveTribe"):
        return  # já classificado pra essa mesma chave

    result = classify_pipedrive_membership(bq, email, phone)
    payload = {
        "pipedriveTribe": result["tribe"],
        "pipedriveKey": key,
        "pipedriveMatchedBy": result["matched_by"] or firestore.DELETE_FIELD,
        "pipedriveDealAddTime": result["add_time"] or firestore.DELETE_FIELD,
        "pipedriveStage": result.get("stage") or firestore.DELETE_FIELD,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    doc_ref.update(payload)
    log.info(
        f"{transaction_id}: pipedrive={result['tribe']} (by={result['matched_by']}, "
        f"add_time={result['add_time']}, stage={result.get('stage')!r})"
    )
