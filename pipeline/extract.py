"""
Smoke test Fabric -> BigQuery.

Conecta no modelo semantico do Fabric via Power BI REST API,
roda EVALUATE TOPN(10, '{tabela}') e imprime as linhas.

Objetivo: provar que auth Azure e acesso ao workspace estao OK
antes de escrever a logica de carga incremental no BQ.
"""

from __future__ import annotations

import json
import os
import sys

import msal
import requests
from dotenv import load_dotenv


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"[ERRO] Variavel de ambiente {name} nao definida em .env.local")
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
        sys.exit(f"[ERRO] Falha ao obter token: {json.dumps(result, indent=2)}")
    return result["access_token"]


def execute_dax(token: str, workspace_id: str, dataset_id: str, dax: str) -> list[dict]:
    url = (
        f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}"
        f"/datasets/{dataset_id}/executeQueries"
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
        timeout=60,
    )
    if response.status_code != 200:
        sys.exit(
            f"[ERRO] HTTP {response.status_code} no executeQueries:\n"
            f"{response.text}"
        )
    payload = response.json()
    return payload["results"][0]["tables"][0]["rows"]


def main() -> None:
    load_dotenv(".env.local")

    tenant = required_env("AZURE_TENANT_ID")
    client_id = required_env("AZURE_CLIENT_ID")
    client_secret = required_env("AZURE_CLIENT_SECRET")
    workspace_id = required_env("FABRIC_WORKSPACE_ID")
    dataset_id = required_env("FABRIC_DATASET_ID")
    table = required_env("FABRIC_TABLE_NAME")

    print(f"[1/3] Pegando token Azure (tenant {tenant[:8]}...)")
    token = get_token(tenant, client_id, client_secret)

    dax = f"EVALUATE TOPN(10, '{table}')"
    print(f"[2/3] Executando DAX: {dax}")
    rows = execute_dax(token, workspace_id, dataset_id, dax)

    print(f"[3/3] Recebi {len(rows)} linhas. Colunas detectadas:")
    if rows:
        for column in rows[0].keys():
            print(f"  - {column}")
        print("\nPrimeiras 3 linhas:")
        for row in rows[:3]:
            print(json.dumps(row, indent=2, ensure_ascii=False, default=str))
    else:
        print("  (nenhuma linha retornada: tabela vazia?)")


if __name__ == "__main__":
    main()
