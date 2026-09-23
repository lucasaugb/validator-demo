"""
Cloud Functions de administração de Auth.

Três funções publicadas neste pacote:

1. `purge_auth_by_email` (HTTP / callable manual)
   - POST com header `Authorization: Bearer <idToken>` do super_admin
   - Body JSON: `{ "email": "user@example.com" }`
   - Comportamento: se NÃO existe doc em `agentes/` com aquele email, apaga a
     conta Auth correspondente. Usado pelo frontend quando `createAgente`
     captura `auth/email-already-in-use` (limpa órfão antes de retry).

2. `on_agente_doc_delete` (Firestore trigger)
   - Trigger: `agentes/{uid}` document.deleted
   - Comportamento: apaga a conta Auth do mesmo `uid`. Garante que delete
     futuro do gestor não deixe órfão no Auth.

3. `reset_gestor_passwords` (HTTP / callable manual)
   - POST com header `Authorization: Bearer <idToken>` do super_admin
   - Body JSON: `{ "uid": "<opcional>" }`, se vazio, reseta TODOS os gestores
     (role='agente'). Se preenchido, reseta apenas aquele uid (gestor).
   - Define a senha como `validator2026` e seta `mustChangePassword=true` em
     `agentes/{uid}` pra obrigar troca no primeiro login.

Todas usam o Admin SDK (firebase-admin), só fazem sentido como Cloud
Function porque o client SDK não consegue apagar nem modificar senha de
outra conta sem reauth do dono.
"""
from __future__ import annotations

import logging
import os

import firebase_admin
import functions_framework
from cloudevents.http import CloudEvent
from firebase_admin import auth as fb_auth
from firebase_admin import firestore as fb_firestore

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

PROJECT = os.environ.get("GCP_PROJECT_ID", "validator-demo-project")

# Origens permitidas pela política de CORS. Sem isso, qualquer página em
# qualquer origem (incluindo phishing) pode chamar estes endpoints com tokens
# vazados; restringir bloqueia esse vetor no browser. Override via env
# `ALLOWED_ORIGINS` (CSV) pra suportar previews.
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

if not firebase_admin._apps:
    firebase_admin.initialize_app()


def _cors_headers(request_obj=None) -> dict:
    origin = ""
    if request_obj is not None:
        origin = (request_obj.headers.get("Origin") or "").strip()
    allow = origin if origin in _ALLOWED_ORIGINS else next(iter(_ALLOWED_ORIGINS))
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "3600",
        "Vary": "Origin",
    }


@functions_framework.http
def purge_auth_by_email(request):
    """Apaga conta Auth órfã pelo email, só se nenhum doc agente usa o email.

    Verificação de auth: header `Authorization: Bearer <Firebase idToken>`.
    Caller precisa ser super_admin ativo.
    """
    if request.method == "OPTIONS":
        return ("", 204, _cors_headers(request))
    if request.method != "POST":
        return ({"error": "Use POST"}, 405, _cors_headers(request))

    try:
        # 1. Auth do caller via idToken
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return ({"error": "Missing Authorization header"}, 401, _cors_headers(request))
        id_token = auth_header[len("Bearer ") :].strip()
        decoded = fb_auth.verify_id_token(id_token, check_revoked=True)
        caller_uid = decoded.get("uid")
        if not caller_uid:
            return ({"error": "Invalid token"}, 401, _cors_headers(request))

        # 2. Verifica role super_admin via Firestore
        fs = fb_firestore.client()
        caller_doc = fs.collection("agentes").document(caller_uid).get()
        if not caller_doc.exists:
            return ({"error": "Caller has no agente doc"}, 403, _cors_headers(request))
        caller_data = caller_doc.to_dict() or {}
        if caller_data.get("role") != "super_admin" or not caller_data.get("active"):
            return (
                {"error": "Only active super_admin can purge"},
                403,
                _cors_headers(request),
            )

        # 3. Body
        body = request.get_json(silent=True) or {}
        email = (body.get("email") or "").strip().lower()
        if not email:
            return ({"error": "email required in body"}, 400, _cors_headers(request))

        # 4. Garante que não tem doc agente vinculado
        existing = list(
            fs.collection("agentes")
            .where("email", "==", email)
            .limit(1)
            .stream()
        )
        if existing:
            return (
                {
                    "error": "Existe um agente ativo com este email, não purgue.",
                    "agenteId": existing[0].id,
                },
                409,
                _cors_headers(request),
            )

        # 5. Apaga Auth user
        try:
            user_record = fb_auth.get_user_by_email(email)
            fb_auth.delete_user(user_record.uid)
            log.info(
                f"super_admin {caller_uid} purgou Auth órfão {email} (uid={user_record.uid})"
            )
            return (
                {"ok": True, "purgedUid": user_record.uid},
                200,
                _cors_headers(request),
            )
        except fb_auth.UserNotFoundError:
            return (
                {"ok": True, "message": "no auth user found for email"},
                200,
                _cors_headers(request),
            )

    except fb_auth.RevokedIdTokenError:
        return ({"error": "Token revogado: refaça login"}, 401, _cors_headers(request))
    except fb_auth.InvalidIdTokenError:
        return ({"error": "Invalid idToken"}, 401, _cors_headers(request))
    except Exception as e:
        log.exception("purge_auth_by_email falhou")
        return ({"error": str(e)}, 500, _cors_headers(request))


# Senha padrão pra qualquer Gestor (role=agente). Mantém sincronizada com a
# constante `GESTOR_DEFAULT_PASSWORD` em web/src/pages/AgenteManagement.tsx.
GESTOR_DEFAULT_PASSWORD = "validator2026"


@functions_framework.http
def reset_gestor_passwords(request):
    """Reseta senha de gestores (role=agente) pra `validator2026`.

    Modo padrão (sem `uid` no body): reseta TODOS os gestores ativos+inativos.
    Modo individual (`uid` no body): reseta apenas aquele gestor.

    Em ambos os modos:
    - `fb_auth.update_user(uid, password=...)` troca a senha no Firebase Auth.
    - `agentes/{uid}.mustChangePassword = True` força troca no próximo login.

    Caller precisa ser super_admin ativo (verificado via idToken + Firestore).
    """
    if request.method == "OPTIONS":
        return ("", 204, _cors_headers(request))
    if request.method != "POST":
        return ({"error": "Use POST"}, 405, _cors_headers(request))

    try:
        # 1. Auth do caller via idToken
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return ({"error": "Missing Authorization header"}, 401, _cors_headers(request))
        id_token = auth_header[len("Bearer ") :].strip()
        decoded = fb_auth.verify_id_token(id_token, check_revoked=True)
        caller_uid = decoded.get("uid")
        if not caller_uid:
            return ({"error": "Invalid token"}, 401, _cors_headers(request))

        # 2. Verifica role super_admin via Firestore
        fs = fb_firestore.client()
        caller_doc = fs.collection("agentes").document(caller_uid).get()
        if not caller_doc.exists:
            return ({"error": "Caller has no agente doc"}, 403, _cors_headers(request))
        caller_data = caller_doc.to_dict() or {}
        if caller_data.get("role") != "super_admin" or not caller_data.get("active"):
            return (
                {"error": "Only active super_admin can reset gestor passwords"},
                403,
                _cors_headers(request),
            )

        # 3. Body
        body = request.get_json(silent=True) or {}
        target_uid = (body.get("uid") or "").strip() or None

        # 4. Seleciona alvos
        targets: list[tuple[str, str]] = []  # (uid, email)
        if target_uid:
            doc = fs.collection("agentes").document(target_uid).get()
            if not doc.exists:
                return (
                    {"error": "agente não encontrado", "uid": target_uid},
                    404,
                    _cors_headers(request),
                )
            d = doc.to_dict() or {}
            if d.get("role") != "agente":
                return (
                    {
                        "error": "alvo não é gestor (role != 'agente')",
                        "role": d.get("role"),
                    },
                    400,
                    _cors_headers(request),
                )
            targets.append((target_uid, d.get("email") or ""))
        else:
            # Reset em massa: TODOS os gestores (ativos e inativos, inativo
            # ainda pode ser reativado e a senha precisa estar padronizada).
            for doc in fs.collection("agentes").where("role", "==", "agente").stream():
                d = doc.to_dict() or {}
                targets.append((doc.id, d.get("email") or ""))

        log.info(
            f"super_admin {caller_uid} disparou reset de senha pra "
            f"{len(targets)} gestor(es)"
        )

        # 5. Aplica o reset
        ok: list[dict] = []
        errors: list[dict] = []
        for uid, email in targets:
            try:
                fb_auth.update_user(uid, password=GESTOR_DEFAULT_PASSWORD)
                fs.collection("agentes").document(uid).update(
                    {"mustChangePassword": True}
                )
                ok.append({"uid": uid, "email": email})
            except Exception as e:
                log.exception(f"falha resetando {uid} ({email}): {e}")
                errors.append({"uid": uid, "email": email, "error": str(e)})

        return (
            {
                "ok": True,
                "resetCount": len(ok),
                "errorCount": len(errors),
                "errors": errors,
            },
            200,
            _cors_headers(request),
        )

    except fb_auth.RevokedIdTokenError:
        return ({"error": "Token revogado: refaça login"}, 401, _cors_headers(request))
    except fb_auth.InvalidIdTokenError:
        return ({"error": "Invalid idToken"}, 401, _cors_headers(request))
    except Exception as e:
        log.exception("reset_gestor_passwords falhou")
        return ({"error": str(e)}, 500, _cors_headers(request))


@functions_framework.cloud_event
def on_agente_doc_delete(event: CloudEvent) -> None:
    """Apaga conta Auth quando o doc `agentes/{uid}` é deletado.

    Garantia future-proof: a partir do deploy, deletar gestor da UI também
    apaga a conta no Firebase Auth, evitando órfãos pra reutilização de email.
    """
    try:
        # CloudEvent payload de Firestore document.deleted tem o path em
        # `event.data["value"]["name"]` (formato:
        #  projects/<proj>/databases/(default)/documents/agentes/<uid>)
        data = event.data or {}
        old_value = data.get("oldValue") or data.get("value") or {}
        full_path = old_value.get("name") or ""
        uid = full_path.split("/")[-1] if full_path else None
        if not uid:
            log.warning("on_agente_doc_delete: sem uid no event")
            return
        try:
            fb_auth.delete_user(uid)
            log.info(f"Auth user {uid} apagado após delete do doc agentes")
        except fb_auth.UserNotFoundError:
            log.info(f"Auth user {uid} já estava ausente, nada a fazer")
    except Exception:
        log.exception("on_agente_doc_delete falhou")
