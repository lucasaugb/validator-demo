"""
Cloud Run Service: fechamento-pdf

Dois endpoints HTTP autenticados via Firebase ID Token (Bearer):
  POST /preview  → roda a apuração e devolve o resumo do que SERIA enviado
                   (sem renderizar PDF nem mandar pra Slack). Alimenta o
                   modal de confirmação na UI.
  POST /close    → renderiza UM PDF por agente, abre DM no Slack e faz
                   upload do arquivo. Retorna o relatório de envio.
                   IMPORTANTE: ainda não grava o doc de `closings/`,
                   isso é Fase 5.

Body em ambos: { "month": "2026-05", "setor": "premium" | "all" }

Auth: Header `Authorization: Bearer <Firebase ID Token>`. Token deve ser
de um usuário com role `admin` ou `super_admin` em `agentes/{uid}`.
"""

from __future__ import annotations

import io
import json
import logging
import os
import urllib.request
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

BRT = ZoneInfo("America/Sao_Paulo")

import firebase_admin
from firebase_admin import auth as fb_auth, credentials, firestore
from flask import Flask, jsonify, request
from google.cloud import secretmanager
from jinja2 import Environment, FileSystemLoader, select_autoescape
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from weasyprint import HTML

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "validator-demo-project")
# Setores reais que um GESTOR pode ter.
SETORES = ("premium", "starter", "eventos", "online")
# Setores virtuais exclusivos de SUPERVISOR: cada um cobre dois setores reais.
SETOR_PREMIUM_STARTER = "premium_starter"
SETOR_ONLINE_EVENTOS = "online_eventos"
# Setores aceitos no body de /preview e /close (inclui virtuais).
SETORES_ACCEPTED = SETORES + (SETOR_PREMIUM_STARTER, SETOR_ONLINE_EVENTOS)
SETOR_LABEL = {
    "premium": "Premium",
    "starter": "Starter",
    "eventos": "Eventos",
    "online": "Online",
    SETOR_PREMIUM_STARTER: "Premium/Starter",
    SETOR_ONLINE_EVENTOS: "Online/Eventos",
}


def setores_in_scope(setor: str) -> tuple[str, ...]:
    """Expande setor virtual em lista de setores reais cobertos.

    'premium_starter' → ('premium', 'starter')
    'online_eventos' → ('online', 'eventos')
    'premium' → ('premium',)
    'all' → todos os reais
    """
    if setor == "all":
        return SETORES
    if setor == SETOR_PREMIUM_STARTER:
        return ("premium", "starter")
    if setor == SETOR_ONLINE_EVENTOS:
        return ("online", "eventos")
    return (setor,)
MONTH_LABELS = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

ACTIVATION_FIXED_USD = 5.0  # base / fallback do bônus de ativação
TRANSACTION_PCT = 0.01
# Regra escalonada só vale a partir deste transactionDate; antes, fixo $5 (não
# reescreve competências anteriores). Espelha ACTIVATION_TIERS_FROM do TS.
ACTIVATION_TIERS_FROM = "2026-07-01"


def days_in_tribe_at_transaction(d: dict):
    """Dias que o cliente já estava na Premium/Starter (CRM) quando transacionou:
    transactionDate − pipedriveDealAddTime (data-a-data). None se não dá pra
    calcular. Espelha daysInTribeAtTransaction do TS."""
    add = d.get("pipedriveDealAddTime")
    dep = d.get("transactionDate")
    if not isinstance(add, str) or not add or not isinstance(dep, str) or not dep:
        return None
    try:
        a = date.fromisoformat(add[:10])
        p = date.fromisoformat(dep[:10])
    except ValueError:
        return None
    return (p - a).days


def activation_bonus_for_transaction(d: dict) -> float:
    """Bônus de ativação escalonado por dias na Premium/Starter (decisão 2026-07-21):
    ≤7d→$10, 8-15→$7,50, 16-30→$6, >30→$5. Sem add_time OU dias negativos → $5
    (base, conservador). Transação anterior a ACTIVATION_TIERS_FROM → fixo $5
    (não reescreve competências anteriores). Espelha activationBonusForTransaction do TS."""
    if (d.get("transactionDate") or "")[:10] < ACTIVATION_TIERS_FROM:
        return ACTIVATION_FIXED_USD
    days = days_in_tribe_at_transaction(d)
    if days is None or days < 0:
        return ACTIVATION_FIXED_USD
    if days <= 7:
        return 10.0
    if days <= 15:
        return 7.5
    if days <= 30:
        return 6.0
    return 5.0

# ------------------------------------------------------------------ singletons
firebase_admin.initialize_app(credentials.ApplicationDefault())
_fs_client: firestore.Client | None = None
_slack_client: WebClient | None = None


def fs() -> firestore.Client:
    global _fs_client
    if _fs_client is None:
        _fs_client = firestore.client()
    return _fs_client


def slack() -> WebClient:
    global _slack_client
    if _slack_client is None:
        sm = secretmanager.SecretManagerServiceClient()
        name = f"projects/{PROJECT_ID}/secrets/slack-bot-token/versions/latest"
        token = sm.access_secret_version(name=name).payload.data.decode()
        _slack_client = WebClient(token=token)
    return _slack_client


# Cache de DM channels (user_id → channel_id) dentro de uma execução. Evita
# chamar conversations.open repetidamente. Não persiste entre instâncias do
# Cloud Run: ok porque a chamada é leve.
_im_cache: dict[str, str] = {}


def open_im(user_id: str) -> str:
    """Abre (ou recupera) o canal DM pro user_id. Retorna channel_id (começa
    com 'D'). `files.completeUploadExternal` exige channel_id de DM/canal,
    não aceita user_id direto.
    """
    if user_id in _im_cache:
        return _im_cache[user_id]
    res = slack().conversations_open(users=user_id)
    channel = (res.get("channel") or {}).get("id")
    if not channel:
        raise RuntimeError(f"conversations.open não retornou channel pra {user_id}")
    _im_cache[user_id] = channel
    return channel


# ------------------------------------------------------------------ Jinja env
_jinja = Environment(
    loader=FileSystemLoader("templates"),
    autoescape=select_autoescape(["html"]),
)


def format_money(v: float) -> str:
    """Formata em USD com vírgula como separador de milhar, mesmo padrão do app."""
    return f"${v:,.2f}"


def format_date_br(iso: str | None) -> str:
    if not iso:
        return "-"
    parts = iso[:10].split("-")
    if len(parts) != 3:
        return iso
    y, m, d = parts
    return f"{d}/{m}/{y[2:]}"


_jinja.filters["money"] = format_money
_jinja.filters["dateBR"] = format_date_br


# ------------------------------------------------------------------ Flask app
app = Flask(__name__)


def require_admin() -> dict[str, Any] | None:
    """Verifica Firebase ID Token + role admin/super_admin + active=True.
    Retorna claims ou None se qualquer check falhar.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.removeprefix("Bearer ").strip()
    try:
        decoded = fb_auth.verify_id_token(token, check_revoked=True)
    except Exception as e:
        log.warning(f"token inválido: {e}")
        return None

    uid = decoded.get("uid")
    if not uid:
        return None

    snap = fs().collection("agentes").document(uid).get()
    if not snap.exists:
        log.warning(f"uid {uid} não tem doc em agentes/")
        return None
    data = snap.to_dict() or {}
    role = data.get("role")
    if role not in ("admin", "super_admin"):
        log.warning(f"uid {uid} não é admin (role={role})")
        return None
    if data.get("active") is False:
        log.warning(f"uid {uid} está inativo, recusando acesso")
        return None
    return {"uid": uid, "role": role, "name": data.get("name", "")}


def log_audit(actor: dict, action: str, payload: dict) -> None:
    """Registra ação sensível em activityLog pra auditoria.

    Mesmo nome de coleção que o front-end (`web/src/lib/activityLog.ts`) e que
    as Firestore Rules. Antes esta função escrevia em `activity_log` (snake)
    e os entries não apareciam na tela /admin/log, gap real de auditoria.
    """
    try:
        fs().collection("activityLog").add({
            "action": action,
            "actorUid": actor.get("uid"),
            "actorName": actor.get("name"),
            "actorRole": actor.get("role"),
            "payload": payload,
            "ip": request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
                  or request.remote_addr,
            "userAgent": request.headers.get("User-Agent", "")[:300],
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
    except Exception as e:
        log.exception(f"falha ao gravar audit log: {e}")


# ------------------------------------------------------------------ comissão
def effective_usd_amount(d: dict) -> float:
    """Replica `effectiveUsdAmount` do web/src/lib/commission.ts."""
    if d.get("currency") == "USD":
        return float(d.get("amount") or 0)
    usd = d.get("usdAmount")
    if isinstance(usd, (int, float)):
        return float(usd)
    return float(d.get("amount") or 0)


def final_status(d: dict) -> str:
    sv = d.get("systemValidation")
    cv = d.get("conversationValidation")
    if sv in ("invalid", "duplicate") or cv == "rejected":
        return "rejected"
    if sv == "verified" and cv == "approved":
        return "validated"
    return "pending"


def commission_for_transaction(d: dict) -> dict:
    """Replica commissionForTransaction do TS. Retorna dict com fixedUsd, percentage, status."""
    if final_status(d) != "validated":
        return {"fixedUsd": 0.0, "percentage": 0.0, "status": "not_validated"}

    fixed = activation_bonus_for_transaction(d) if d.get("isActivation") else 0.0
    full_pct = effective_usd_amount(d) * TRANSACTION_PCT

    if not d.get("isActivation"):
        return {"fixedUsd": 0.0, "percentage": full_pct, "status": "eligible"}

    lod = d.get("lastOperationDate")
    transaction_date = (d.get("transactionDate") or "")[:10]
    if lod is None and "lastOperationDate" not in d:
        # tecnicamente não dá pra distinguir undefined vs None no dict aqui,
        # mas pra fim de cálculo: ausência total = pending
        pass
    if lod is None:
        # Sem confirmação ou explicitamente nunca operou
        # Como o Firestore retorna o campo como ausente OU None, não dá pra
        # diferenciar 100%. Usamos lastOperationDate is not None como sinal
        # de "consultado".
        if "lastOperationDate" in d and d["lastOperationDate"] is None:
            return {"fixedUsd": fixed, "percentage": 0.0, "status": "not_eligible"}
        return {"fixedUsd": fixed, "percentage": 0.0, "status": "pending_operation"}

    op_date = str(lod)[:10]
    if op_date > transaction_date:
        return {"fixedUsd": fixed, "percentage": full_pct, "status": "eligible"}
    return {"fixedUsd": fixed, "percentage": 0.0, "status": "not_eligible"}


def commission_by_agent(transactions: list[dict]) -> list[dict]:
    """Agrega comissão por agente: fonte canônica espelha lib/commission.ts."""
    by_agent: dict[str, dict] = {}
    for d in transactions:
        c = commission_for_transaction(d)
        if c["status"] == "not_validated":
            continue
        agente_id = d.get("agenteId")
        if not agente_id:
            continue
        cur = by_agent.setdefault(
            agente_id,
            {
                "agenteId": agente_id,
                "agenteName": d.get("agenteName") or "",
                "setor": d.get("agenteSetor"),
                "validatedTransactions": 0,
                "activations": 0,
                "activationsPendingOperation": 0,
                "activationsNotEligible": 0,
                "fixedUsd": 0.0,
                "percentageUsd": 0.0,
                "pendingUsd": 0.0,
                "lostUsd": 0.0,
                "payableRawTotal": 0.0,
                "rows": [],
            },
        )
        cur["validatedTransactions"] += 1
        if d.get("isActivation"):
            cur["activations"] += 1
        cur["fixedUsd"] += c["fixedUsd"]
        if c["status"] == "eligible":
            cur["percentageUsd"] += c["percentage"]
        elif c["status"] == "pending_operation":
            cur["activationsPendingOperation"] += 1
            cur["pendingUsd"] += effective_usd_amount(d) * TRANSACTION_PCT
        elif c["status"] == "not_eligible":
            cur["activationsNotEligible"] += 1
            cur["lostUsd"] += effective_usd_amount(d) * TRANSACTION_PCT
        cur["rows"].append({"transaction": d, "commission": c})

    # Ordena rows por transactionDate desc + computa total
    for a in by_agent.values():
        a["rows"].sort(
            key=lambda x: x["transaction"].get("transactionDate") or "", reverse=True,
        )
        a["payableRawTotal"] = a["fixedUsd"] + a["percentageUsd"]

    return sorted(
        by_agent.values(), key=lambda a: a["payableRawTotal"], reverse=True,
    )


# ------------------------------------------------------------------ data load
def load_transactions_in_scope(month: str, setor: str) -> list[dict]:
    """Lê transactions do Firestore filtrados por mês (transactionDate) + setor."""
    # Não filtra no Firestore por intervalo de transactionDate (string) pra evitar
    # index custom: filtra em memória, são poucos docs por mês.
    # Setor expandido (cobre virtual 'premium_starter' → premium+starter).
    scope = setores_in_scope(setor)
    docs = fs().collection("transactions").stream()
    out: list[dict] = []
    for snap in docs:
        d = snap.to_dict() or {}
        d["id"] = snap.id
        dep_date = d.get("transactionDate")
        if not isinstance(dep_date, str) or not dep_date.startswith(month):
            continue
        if setor != "all" and d.get("agenteSetor") not in scope:
            continue
        out.append(d)
    return out


def lookup_slack_ids(agente_ids: list[str]) -> dict[str, str]:
    """Map agenteId → slackUserId (vazio quando ausente)."""
    out: dict[str, str] = {}
    for uid in agente_ids:
        snap = fs().collection("agentes").document(uid).get()
        if not snap.exists:
            continue
        data = snap.to_dict() or {}
        sid = data.get("slackUserId")
        if sid:
            out[uid] = sid
    return out


def lookup_admins() -> list[dict]:
    """Retorna lista de admins e super_admins ativos. Cada entry tem
    {uid, name, role, slackUserId or None}. Quem não tem slackUserId entra
    como informação pro audit, mas não recebe DM.
    """
    out: list[dict] = []
    for snap in fs().collection("agentes").where(
        filter=firestore.FieldFilter("role", "in", ["admin", "super_admin"]),
    ).stream():
        data = snap.to_dict() or {}
        if data.get("active") is False:
            continue
        out.append({
            "uid": snap.id,
            "name": data.get("name", ""),
            "role": data.get("role", ""),
            "slackUserId": data.get("slackUserId"),
        })
    return out


def _closing_key(month: str, setor: str) -> str:
    """Doc ID determinístico pro snapshot do fechamento."""
    return f"{month}__{setor}"


def lookup_existing_closing(month: str, setor: str) -> dict | None:
    """Retorna o snapshot de fechamento se já existir, senão None."""
    snap = fs().collection("closings").document(_closing_key(month, setor)).get()
    if not snap.exists:
        return None
    return snap.to_dict() or {}


def save_closing_snapshot(
    month: str,
    setor: str,
    actor: dict,
    by_agent: list[dict],
    sent: list[dict],
    admin_sent: list[dict],
    supervisor_sent: list[dict],
    reopened: bool,
) -> None:
    """Grava snapshot do fechamento: fonte da verdade do "que foi pago".

    Sem isso, fechar a mesma competência duas vezes pagaria DUPLICADO; ou se
    um transaction antigo virar `validated` depois do fechamento, comissão
    retroativa é perdida ou re-paga sem registro.

    Schema (collection `closings`):
        {month, setor, closedAt, closedBy:{uid,name,role}, totals:{...},
         agents:[{agenteId, agenteName, payableTotal, validatedTransactions,
                  activations, slackUserId, fileId}],
         adminRecipients:[{uid,name,role}], supervisorRecipients:[{uid,name,setor}],
         reopened:bool, version:int}
    """
    doc_ref = fs().collection("closings").document(_closing_key(month, setor))
    existing = doc_ref.get()
    version = 1
    if existing.exists:
        data = existing.to_dict() or {}
        version = int(data.get("version") or 1) + 1

    totals = {
        "payableTotal": sum(a["payableRawTotal"] for a in by_agent),
        "fixedUsd": sum(a["fixedUsd"] for a in by_agent),
        "percentageUsd": sum(a["percentageUsd"] for a in by_agent),
        "validatedTransactions": sum(a["validatedTransactions"] for a in by_agent),
        "activations": sum(a["activations"] for a in by_agent),
        "agentCount": len(by_agent),
    }
    agents_snapshot = [
        {
            "agenteId": a["agenteId"],
            "agenteName": a["agenteName"],
            "setor": a.get("setor"),
            "payableTotal": a["payableRawTotal"],
            "validatedTransactions": a["validatedTransactions"],
            "activations": a["activations"],
            "fixedUsd": a["fixedUsd"],
            "percentageUsd": a["percentageUsd"],
        }
        for a in by_agent
    ]
    # Cruza com `sent` pra anexar fileId/slackUserId de quem recebeu DM
    sent_by_uid = {s["agenteId"]: s for s in sent}
    for a in agents_snapshot:
        s = sent_by_uid.get(a["agenteId"])
        if s:
            a["slackUserId"] = s.get("slackUserId")
            a["fileId"] = s.get("fileId")

    doc_ref.set({
        "month": month,
        "setor": setor,
        "closedAt": firestore.SERVER_TIMESTAMP,
        "closedBy": {
            "uid": actor.get("uid"),
            "name": actor.get("name"),
            "role": actor.get("role"),
        },
        "totals": totals,
        "agents": agents_snapshot,
        "adminRecipients": [
            {"uid": a["uid"], "name": a["name"], "role": a["role"]}
            for a in admin_sent
        ],
        "supervisorRecipients": [
            {"uid": s["uid"], "name": s["name"], "setor": s["setor"]}
            for s in supervisor_sent
        ],
        "reopened": reopened,
        "version": version,
    })


def lookup_supervisors() -> list[dict]:
    """Retorna supervisores ativos com setor definido. Cada um vai receber
    o MESMO PDF de resumo administrativo, porém filtrado pelo setor dele.
    """
    out: list[dict] = []
    for snap in fs().collection("agentes").where(
        filter=firestore.FieldFilter("role", "==", "supervisor"),
    ).stream():
        data = snap.to_dict() or {}
        if data.get("active") is False:
            continue
        setor = data.get("setor")
        if not setor:
            # Supervisor sem setor não deveria existir; defensivo.
            log.warning(f"supervisor {snap.id} sem setor, ignorado no envio")
            continue
        out.append({
            "uid": snap.id,
            "name": data.get("name", ""),
            "setor": setor,
            "slackUserId": data.get("slackUserId"),
        })
    return out


def supervisors_in_scope(
    supervisors: list[dict], closing_setor: str,
) -> list[dict]:
    """Filtra supervisores cujo escopo INTERSECTA com o escopo do fechamento.

    Suporte ao setor virtual 'premium_starter':
      - Supervisor com setor='premium_starter' cobre {premium, starter}.
      - Admin fecha 'premium' → supervisor de 'premium_starter' também entra
        (recebe resumo, mas filtrado só pelos agentes de 'premium', único setor
        no escopo do fechamento).
    """
    if closing_setor == "all":
        return supervisors
    closing_scope = set(setores_in_scope(closing_setor))
    out: list[dict] = []
    for s in supervisors:
        sup_setor = s.get("setor")
        if not sup_setor:
            continue
        sup_scope = set(setores_in_scope(sup_setor))
        if closing_scope & sup_scope:
            out.append(s)
    return out


# ------------------------------------------------------------------ FX USD→EUR
# Cache de cotações por data dentro de uma execução. Frankfurter.app (BCE) é a
# mesma fonte usada no pipeline pra EUR/GBP→USD; aqui pegamos o sentido inverso
# pra mostrar agentes/admins quanto cada transação USD equivale em EUR no dia.
_fx_eur_cache: dict[str, float | None] = {}


def usd_to_eur_rate(date_str: str) -> float | None:
    """Retorna cotação USD→EUR pro dia ISO yyyy-mm-dd. None em caso de falha."""
    if not date_str:
        return None
    key = date_str[:10]
    if key in _fx_eur_cache:
        return _fx_eur_cache[key]
    try:
        url = f"https://api.frankfurter.app/{key}?from=USD&to=EUR"
        req = urllib.request.Request(url, headers={"User-Agent": "validator-fechamento/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
        rate = data.get("rates", {}).get("EUR")
        if isinstance(rate, (int, float)):
            _fx_eur_cache[key] = float(rate)
            return float(rate)
    except Exception as e:
        log.warning(f"falha cotação USD→EUR pra {key}: {e}")
    _fx_eur_cache[key] = None
    return None


def enrich_with_eur(agent: dict) -> None:
    """Adiciona campos `eurAmount` e `eurRate` em cada row USD (in-place).
    Também adiciona `totalEur` no agent baseado na cotação de hoje. EUR/GBP
    permanecem inalterados: já estão em moeda não-USD."""
    today = datetime.now(BRT).strftime("%Y-%m-%d")
    today_rate = usd_to_eur_rate(today)
    agent["totalEur"] = (
        agent["payableRawTotal"] * today_rate if today_rate else None
    )
    agent["totalEurRate"] = today_rate
    agent["totalEurDate"] = today
    for row in agent.get("rows", []):
        d = row["transaction"]
        if d.get("currency") != "USD":
            continue
        rate = usd_to_eur_rate(d.get("transactionDate") or "")
        if rate is not None:
            row["eurAmount"] = float(d.get("amount") or 0) * rate
            row["eurRate"] = rate
            row["eurDate"] = (d.get("transactionDate") or "")[:10]


# ------------------------------------------------------------------ render PDF
def render_pdf(agent: dict, month_label: str, setor_label: str) -> bytes:
    """Renderiza HTML do extrato e converte pra PDF via WeasyPrint."""
    enrich_with_eur(agent)
    template = _jinja.get_template("extrato.html")
    html_str = template.render(
        agent=agent,
        month_label=month_label,
        setor_label=setor_label,
        activation_fixed_usd=ACTIVATION_FIXED_USD,
        transaction_pct_percent=int(TRANSACTION_PCT * 100),
        generated_at=datetime.now(BRT).strftime("%d/%m/%Y %H:%M (BRT)"),
    )
    buf = io.BytesIO()
    HTML(string=html_str).write_pdf(buf)
    return buf.getvalue()


def render_admin_summary_pdf(
    by_agent: list[dict],
    month_label: str,
    setor_label: str,
    actor_name: str,
) -> bytes:
    """Renderiza resumo administrativo: visão consolidada da equipe."""
    summary = {
        "totalPayable": sum(a["payableRawTotal"] for a in by_agent),
        "totalFixed": sum(a["fixedUsd"] for a in by_agent),
        "totalPct": sum(a["percentageUsd"] for a in by_agent),
        "totalPending": sum(a["pendingUsd"] for a in by_agent),
        "totalLost": sum(a["lostUsd"] for a in by_agent),
        "totalValidated": sum(a["validatedTransactions"] for a in by_agent),
        "totalActivations": sum(a["activations"] for a in by_agent),
        "agentCount": len(by_agent),
    }
    # Cotação USD→EUR de hoje aplicada no total geral
    today = datetime.now(BRT).strftime("%Y-%m-%d")
    eur_rate = usd_to_eur_rate(today)
    summary["totalEur"] = summary["totalPayable"] * eur_rate if eur_rate else None
    summary["eurRate"] = eur_rate
    summary["eurDate"] = today

    template = _jinja.get_template("resumo_admin.html")
    html_str = template.render(
        agents=by_agent,
        summary=summary,
        month_label=month_label,
        setor_label=setor_label,
        actor_name=actor_name,
        activation_fixed_usd=ACTIVATION_FIXED_USD,
        transaction_pct_percent=int(TRANSACTION_PCT * 100),
        generated_at=datetime.now(BRT).strftime("%d/%m/%Y %H:%M (BRT)"),
    )
    buf = io.BytesIO()
    HTML(string=html_str).write_pdf(buf)
    return buf.getvalue()


# ------------------------------------------------------------------ endpoints
@app.route("/preview", methods=["POST", "OPTIONS"])
def preview():
    if request.method == "OPTIONS":
        return _cors_preflight()
    actor = require_admin()
    if actor is None:
        return _cors(jsonify({"error": "unauthorized"}), 401)

    body = request.get_json(silent=True) or {}
    month, setor, err = _parse_scope(body)
    if err:
        return _cors(jsonify({"error": err}), 400)

    transactions = load_transactions_in_scope(month, setor)
    by_agent = commission_by_agent(transactions)
    agente_ids = [a["agenteId"] for a in by_agent]
    slack_map = lookup_slack_ids(agente_ids)

    # Snapshot prévio? Frontend usa pra avisar "Já foi fechado em X" antes do
    # admin clicar Enviar.
    existing_closing = lookup_existing_closing(month, setor)

    pending_op_total = sum(a["activationsPendingOperation"] for a in by_agent)
    # Transactions validados com FX pendente bloqueiam encerramento, sem usdAmount
    # confirmado, comissão sairia em fallback face-value (1€=1$), pagando menos
    # que o devido.
    fx_pending_total = sum(
        1
        for d in transactions
        if d.get("usdConversionPending") is True and final_status(d) == "validated"
    )
    can_close = pending_op_total == 0 and fx_pending_total == 0

    items = []
    for a in by_agent:
        items.append({
            "agenteId": a["agenteId"],
            "agenteName": a["agenteName"],
            "setor": a["setor"],
            "validatedTransactions": a["validatedTransactions"],
            "activations": a["activations"],
            "activationsPendingOperation": a["activationsPendingOperation"],
            "payableRawTotal": a["payableRawTotal"],
            "hasSlackId": a["agenteId"] in slack_map,
        })

    total = sum(a["payableRawTotal"] for a in by_agent)

    # Admins/super_admins que receberão cópia do resumo administrativo.
    admins = lookup_admins()
    admins_payload = [{
        "uid": a["uid"],
        "name": a["name"],
        "role": a["role"],
        "hasSlackId": bool(a["slackUserId"]),
    } for a in admins]

    # Supervisores elegíveis (recebem o resumo do PRÓPRIO setor). Quando o
    # encerramento é setor='all', todos os supervisores entram. Quando é setor
    # específico, só o supervisor daquele setor.
    supervisors = supervisors_in_scope(lookup_supervisors(), setor)
    supervisors_payload = [{
        "uid": s["uid"],
        "name": s["name"],
        "setor": s["setor"],
        "hasSlackId": bool(s["slackUserId"]),
    } for s in supervisors]

    log_audit(actor, "fechamento.preview", {
        "month": month,
        "setor": setor,
        "agentCount": len(items),
        "totalPayable": total,
    })

    return _cors(jsonify({
        "month": month,
        "setor": setor,
        "agents": items,
        "totalPayable": total,
        "agentsWithSlack": sum(1 for a in items if a["hasSlackId"]),
        "agentsWithoutSlack": sum(1 for a in items if not a["hasSlackId"]),
        "pendingOperationCount": pending_op_total,
        "fxPendingCount": fx_pending_total,
        "canClose": can_close,
        "existingClosing": (
            {
                "month": existing_closing.get("month"),
                "setor": existing_closing.get("setor"),
                "closedBy": existing_closing.get("closedBy"),
                "totals": existing_closing.get("totals"),
                "version": existing_closing.get("version"),
            } if existing_closing else None
        ),
        "admins": admins_payload,
        "adminsWithSlack": sum(1 for a in admins if a["slackUserId"]),
        "adminsWithoutSlack": sum(1 for a in admins if not a["slackUserId"]),
        "supervisors": supervisors_payload,
        "supervisorsWithSlack": sum(1 for s in supervisors if s["slackUserId"]),
        "supervisorsWithoutSlack": sum(1 for s in supervisors if not s["slackUserId"]),
    }))


@app.route("/close", methods=["POST", "OPTIONS"])
def close():
    if request.method == "OPTIONS":
        return _cors_preflight()
    actor = require_admin()
    if actor is None:
        return _cors(jsonify({"error": "unauthorized"}), 401)

    body = request.get_json(silent=True) or {}
    month, setor, err = _parse_scope(body)
    if err:
        return _cors(jsonify({"error": err}), 400)
    force = bool(body.get("force"))

    # Bloqueio de duplicidade: se já existe `closings/{month}__{setor}`, recusa
    # a menos que `force=true` (admin explícito que está reabrindo). Sem isso,
    # rodar /close 2× pra mesma competência pagaria 2× as comissões e mandaria
    # PDF duplicado pelos agentes.
    existing_closing = lookup_existing_closing(month, setor)
    if existing_closing and not force:
        return _cors(jsonify({
            "error": "already_closed",
            "closing": {
                "month": existing_closing.get("month"),
                "setor": existing_closing.get("setor"),
                "closedBy": existing_closing.get("closedBy"),
                "totals": existing_closing.get("totals"),
                "version": existing_closing.get("version"),
            },
        }), 409)

    transactions = load_transactions_in_scope(month, setor)
    by_agent = commission_by_agent(transactions)

    # Bloqueio servidor-side: se há pending_operation, recusa
    pending_op_total = sum(a["activationsPendingOperation"] for a in by_agent)
    if pending_op_total > 0:
        return _cors(jsonify({
            "error": "blocked_by_pending_operation",
            "pendingOperationCount": pending_op_total,
        }), 409)

    # Bloqueio FX: transações validadas sem conversão pra USD bloqueiam o
    # encerramento: sem usdAmount, comissão calcularia em fallback face-value.
    fx_pending_total = sum(
        1
        for d in transactions
        if d.get("usdConversionPending") is True and final_status(d) == "validated"
    )
    if fx_pending_total > 0:
        return _cors(jsonify({
            "error": "blocked_by_fx_pending",
            "fxPendingCount": fx_pending_total,
        }), 409)

    agente_ids = [a["agenteId"] for a in by_agent]
    slack_map = lookup_slack_ids(agente_ids)

    month_label = _month_label(month)
    setor_label = "Todos os setores" if setor == "all" else SETOR_LABEL.get(setor, setor)

    sent: list[dict] = []
    skipped_no_slack: list[dict] = []
    errors: list[dict] = []

    # Timestamp único pra todas as DMs desta execução (BRT, formato brasileiro)
    sent_at = datetime.now(BRT).strftime("%d/%m/%Y %H:%M")

    for a in by_agent:
        agente_id = a["agenteId"]
        sid = slack_map.get(agente_id)
        if not sid:
            skipped_no_slack.append({
                "agenteId": agente_id,
                "agenteName": a["agenteName"],
                "reason": "sem slackUserId",
            })
            continue
        try:
            pdf_bytes = render_pdf(a, month_label, setor_label)
            filename = f"fechamento_{month}_{_slug(a['agenteName'])}.pdf"
            initial_comment = (
                f"Extrato {a['agenteName']} · {month_label} · {sent_at}"
            )
            dm_channel = open_im(sid)
            res = slack().files_upload_v2(
                channel=dm_channel,
                content=pdf_bytes,
                filename=filename,
                title=f"Extrato {month_label}",
                initial_comment=initial_comment,
            )
            sent.append({
                "agenteId": agente_id,
                "agenteName": a["agenteName"],
                "slackUserId": sid,
                "fileId": (res.get("file") or {}).get("id"),
                "payableTotal": a["payableRawTotal"],
            })
            log.info(f"enviado {agente_id} ({a['agenteName']}) → {sid}")
        except SlackApiError as e:
            log.exception(f"falha Slack {agente_id}: {e.response['error']}")
            errors.append({
                "agenteId": agente_id,
                "agenteName": a["agenteName"],
                "error": e.response.get("error", "unknown"),
            })
        except Exception as e:
            log.exception(f"falha geral {agente_id}: {e}")
            errors.append({
                "agenteId": agente_id,
                "agenteName": a["agenteName"],
                "error": str(e),
            })

    # Envia o resumo administrativo. Destinatários:
    #   - admins/super_admins → recebem resumo do escopo solicitado (igual hoje)
    #   - supervisores elegíveis → recebem resumo FILTRADO pelo setor deles
    # PDFs do escopo global são renderizados uma única vez e reusados; o de
    # cada supervisor é renderizado individualmente com o subset do setor.
    admin_sent: list[dict] = []
    admin_skipped: list[dict] = []
    admin_errors: list[dict] = []
    supervisor_sent: list[dict] = []
    supervisor_skipped: list[dict] = []
    supervisor_errors: list[dict] = []

    try:
        admin_pdf = render_admin_summary_pdf(
            by_agent, month_label, setor_label, actor.get("name", ""),
        )
    except Exception as e:
        log.exception(f"falha gerando resumo admin: {e}")
        admin_pdf = None

    summary_filename = f"fechamento_resumo_{month}.pdf"

    # ---------- envio pra admins/super_admins ----------
    if admin_pdf is not None:
        admins = lookup_admins()
        admin_comment = (
            f"Resumo · {month_label} · {setor_label} · {sent_at}"
        )
        for admin in admins:
            sid = admin.get("slackUserId")
            if not sid:
                admin_skipped.append({
                    "uid": admin["uid"],
                    "name": admin["name"],
                    "role": admin["role"],
                    "reason": "sem slackUserId",
                })
                continue
            try:
                dm_channel = open_im(sid)
                res = slack().files_upload_v2(
                    channel=dm_channel,
                    content=admin_pdf,
                    filename=summary_filename,
                    title=f"Resumo {month_label}",
                    initial_comment=admin_comment,
                )
                admin_sent.append({
                    "uid": admin["uid"],
                    "name": admin["name"],
                    "role": admin["role"],
                    "slackUserId": sid,
                    "fileId": (res.get("file") or {}).get("id"),
                })
                log.info(f"resumo admin → {admin['uid']} ({admin['name']}) {sid}")
            except SlackApiError as e:
                log.exception(f"falha Slack admin {admin['uid']}: {e.response['error']}")
                admin_errors.append({
                    "uid": admin["uid"],
                    "name": admin["name"],
                    "role": admin["role"],
                    "error": e.response.get("error", "unknown"),
                })
            except Exception as e:
                log.exception(f"falha geral admin {admin['uid']}: {e}")
                admin_errors.append({
                    "uid": admin["uid"],
                    "name": admin["name"],
                    "role": admin["role"],
                    "error": str(e),
                })

    # ---------- envio pra supervisores ----------
    # Cada supervisor recebe um PDF renderizado com o subset do PRÓPRIO setor.
    supervisors_pool = supervisors_in_scope(lookup_supervisors(), setor)
    for sup in supervisors_pool:
        sup_setor = sup["setor"]
        sup_label = SETOR_LABEL.get(sup_setor, sup_setor)
        sid = sup.get("slackUserId")
        if not sid:
            supervisor_skipped.append({
                "uid": sup["uid"],
                "name": sup["name"],
                "setor": sup_setor,
                "reason": "sem slackUserId",
            })
            continue
        # Subset by_agent só do setor do supervisor. Quando setor==all isso
        # filtra; quando o admin escolheu o setor==sup_setor, é no-op.
        # Escopo do supervisor (cobre virtual 'premium_starter' → premium+starter).
        sup_scope = setores_in_scope(sup_setor)
        by_agent_sup = [a for a in by_agent if a.get("setor") in sup_scope]
        try:
            sup_pdf = render_admin_summary_pdf(
                by_agent_sup, month_label, sup_label, actor.get("name", ""),
            )
            dm_channel = open_im(sid)
            res = slack().files_upload_v2(
                channel=dm_channel,
                content=sup_pdf,
                filename=summary_filename,
                title=f"Resumo {month_label} · {sup_label}",
                initial_comment=(
                    f"Resumo · {month_label} · {sup_label} · {sent_at}"
                ),
            )
            supervisor_sent.append({
                "uid": sup["uid"],
                "name": sup["name"],
                "setor": sup_setor,
                "slackUserId": sid,
                "fileId": (res.get("file") or {}).get("id"),
                "agentCount": len(by_agent_sup),
            })
            log.info(f"resumo supervisor → {sup['uid']} ({sup['name']}, {sup_setor}) {sid}")
        except SlackApiError as e:
            log.exception(f"falha Slack supervisor {sup['uid']}: {e.response['error']}")
            supervisor_errors.append({
                "uid": sup["uid"],
                "name": sup["name"],
                "setor": sup_setor,
                "error": e.response.get("error", "unknown"),
            })
        except Exception as e:
            log.exception(f"falha geral supervisor {sup['uid']}: {e}")
            supervisor_errors.append({
                "uid": sup["uid"],
                "name": sup["name"],
                "setor": sup_setor,
                "error": str(e),
            })

    # Grava o snapshot do fechamento: fonte da verdade pra não pagar duplicado
    # e pra histórico. Falha aqui é grave: chegou-se a enviar PDFs mas o
    # registro sumiu. Em produção, alertar/retentar.
    try:
        save_closing_snapshot(
            month=month,
            setor=setor,
            actor=actor,
            by_agent=by_agent,
            sent=sent,
            admin_sent=admin_sent,
            supervisor_sent=supervisor_sent,
            reopened=bool(existing_closing),
        )
    except Exception as e:
        log.exception(f"falha gravando closing snapshot: {e}")

    log_audit(actor, "fechamento.close", {
        "month": month,
        "setor": setor,
        "force": force,
        "reopened": bool(existing_closing),
        "sentCount": len(sent),
        "skippedCount": len(skipped_no_slack),
        "errorCount": len(errors),
        "adminSentCount": len(admin_sent),
        "adminSkippedCount": len(admin_skipped),
        "adminErrorCount": len(admin_errors),
        "supervisorSentCount": len(supervisor_sent),
        "supervisorSkippedCount": len(supervisor_skipped),
        "supervisorErrorCount": len(supervisor_errors),
        "totalPayable": sum(s["payableTotal"] for s in sent),
    })

    return _cors(jsonify({
        "month": month,
        "setor": setor,
        "sent": sent,
        "skipped_no_slack": skipped_no_slack,
        "errors": errors,
        "sentCount": len(sent),
        "skippedCount": len(skipped_no_slack),
        "errorCount": len(errors),
        "adminSent": admin_sent,
        "adminSkipped": admin_skipped,
        "adminErrors": admin_errors,
        "adminSentCount": len(admin_sent),
        "adminSkippedCount": len(admin_skipped),
        "adminErrorCount": len(admin_errors),
        "supervisorSent": supervisor_sent,
        "supervisorSkipped": supervisor_skipped,
        "supervisorErrors": supervisor_errors,
        "supervisorSentCount": len(supervisor_sent),
        "supervisorSkippedCount": len(supervisor_skipped),
        "supervisorErrorCount": len(supervisor_errors),
    }))


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


# ------------------------------------------------------------------ helpers
def _parse_scope(body: dict) -> tuple[str, str, str | None]:
    month = (body.get("month") or "").strip()
    setor = (body.get("setor") or "all").strip()
    if not month or len(month) != 7 or month[4] != "-":
        return "", "", "month deve ser YYYY-MM"
    if setor != "all" and setor not in SETORES_ACCEPTED:
        return "", "", f"setor inválido: {setor}"
    return month, setor, None


def _month_label(month: str) -> str:
    y, m = month.split("-")
    idx = int(m) - 1
    return f"{MONTH_LABELS[idx]} {y}"


def _slug(name: str) -> str:
    import re
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip().lower())
    return s.strip("_") or "agente"


_ALLOWED_ORIGINS = {
    o.strip()
    for o in (
        os.environ.get(
            "ALLOWED_ORIGINS",
            "https://validator-demo-project.web.app,https://validator-demo-project.firebaseapp.com",
        )
    ).split(",")
    if o.strip()
}


def _allowed_origin() -> str:
    """Devolve o valor do Access-Control-Allow-Origin pra esta requisição.

    Se a Origin do pedido for de uma das origens permitidas, ecoa ela. Caso
    contrário, devolve a origem canônica de produção (não vaza wildcard).
    """
    origin = (request.headers.get("Origin") or "").strip()
    return origin if origin in _ALLOWED_ORIGINS else next(iter(_ALLOWED_ORIGINS))


def _cors(resp, status: int = 200):
    resp.status_code = status
    resp.headers["Access-Control-Allow-Origin"] = _allowed_origin()
    resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    resp.headers["Vary"] = "Origin"
    return resp


def _cors_preflight():
    from flask import make_response
    resp = make_response("", 204)
    resp.headers["Access-Control-Allow-Origin"] = _allowed_origin()
    resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    resp.headers["Vary"] = "Origin"
    return resp


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
