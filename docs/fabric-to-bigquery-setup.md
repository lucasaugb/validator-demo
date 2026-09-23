# Setup: Fabric → BigQuery (passo a passo do zero)

Pipeline pra trazer a tabela de transações do sistema de origem do **modelo semântico do Fabric** para o **BigQuery**, onde a Cloud Function de validação vai cruzar com os transactions do Validator.

**Arquitetura final:**

```
Modelo semântico (Fabric)
        │
        │  Power BI REST API · executeQueries (DAX)
        ▼
Cloud Run Job em Python (a cada 2-4h)
        │
        ▼
BigQuery · dataset `origem` · tabela `transactions`
        │  (particionada por transactionDate, clusterizada por clientId)
        ▼
Cloud Function de validação (cruza com transactions do Firestore)
```

**Credenciais que você vai juntar ao longo do caminho** (anota num lugar seguro, Bitwarden, 1Password etc., NÃO no repo):

| Nome | Onde sai | Quando |
|------|----------|--------|
| `AZURE_TENANT_ID` | Azure App Registration → Overview | Fase 1 |
| `AZURE_CLIENT_ID` | Azure App Registration → Overview | Fase 1 |
| `AZURE_CLIENT_SECRET` | Azure App Registration → Certificates & secrets | Fase 1 |
| `FABRIC_WORKSPACE_ID` | URL do workspace no Fabric | Fase 2 |
| `FABRIC_DATASET_ID` | URL do modelo semântico no Fabric | Fase 2 |
| `GCP_PROJECT_ID` | já é `validator-demo-project` |, |
| Service account JSON GCP | GCP IAM → Service accounts | Fase 3 |

---

## Fase 1: Criar Service Principal no Azure (auth para Fabric)

Um **Service Principal** é uma "identidade de aplicação" no Azure AD. Ele que vai autenticar no Fabric em nome do script (sem usar sua conta pessoal).

### 1.1 Criar a App Registration

1. Abra https://portal.azure.com e faça login com sua conta Demo Source (a mesma do Fabric).
2. Na barra de pesquisa do topo, digite **"App registrations"** → clique no resultado.
3. Botão **"+ New registration"** no topo.
4. Preencha:
   - **Name:** `validator-fabric-reader`
   - **Supported account types:** "Accounts in this organizational directory only (Single tenant)"
   - **Redirect URI:** deixar em branco
5. Clique **"Register"**.

### 1.2 Anotar Tenant ID e Client ID

Você vai cair na tela de overview do app. Na parte de cima, copie:

- **Application (client) ID** → guarde como `AZURE_CLIENT_ID`
- **Directory (tenant) ID** → guarde como `AZURE_TENANT_ID`

### 1.3 Criar o Client Secret

1. Menu lateral esquerdo → **"Certificates & secrets"**.
2. Aba **"Client secrets"** → **"+ New client secret"**.
3. Preencha:
   - **Description:** `validator-bq-pipeline`
   - **Expires:** `24 months` (renova daqui 2 anos, anote no calendário pra não vencer sem aviso).
4. Clique **"Add"**.
5. **IMPORTANTE:** copie agora o valor da coluna **"Value"** (não a "Secret ID"). Esse valor **só aparece uma vez**, se fechar a página sem copiar, tem que apagar e criar outro.
6. Guarde como `AZURE_CLIENT_SECRET`.

✅ **Fim da Fase 1.** Você tem 3 valores: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.

---

## Fase 2: Habilitar SP no Fabric e dar acesso ao workspace

### 2.1 Habilitar Service Principals nas APIs do Fabric

✅ **Já confirmado em 2026-05-10:** na tenant da Demo Source, a opção **"Os principais serviços podem chamar as APIs públicas do Fabric"** (em `Configurações de locatário → Configurações de desenvolvedor`) está **Habilitado para toda a organização**. Este passo está concluído.

Se algum dia precisar reverificar:

1. https://app.fabric.microsoft.com → engrenagem → **"Portal de administração"**.
2. **"Configurações de locatário"** → seção **"Configurações de desenvolvedor"**.
3. Procurar a linha "Os principais serviços podem chamar as APIs públicas do Fabric", deve estar com toggle azul "Habilitado".

A tenant já está no modelo Fabric unificado (sem toggle separado pra "Power BI APIs"). As outras opções de SP nessa seção (criar workspaces, criar perfis, identidades máximas) podem ficar desabilitadas, não impactam o pipeline.

### 2.2 Dar acesso da SP ao workspace

1. No Fabric, abra o **workspace** onde está o modelo semântico das transações.
2. Botão **"Manage access"** no canto superior direito (ou "Access" dependendo da versão).
3. **"+ Add people or groups"**.
4. Comece a digitar `validator-fabric-reader` (o nome da App Registration). Deve aparecer no autocomplete.
5. Role: selecione **"Member"** (suficiente pra ler o modelo via API).
6. **"Add"**.

### 2.3 Pegar Workspace ID e Dataset ID

1. Clique no workspace pra abrir. Olhe a URL:
   ```
   https://app.fabric.microsoft.com/groups/{WORKSPACE_ID}/list
   ```
   Copie o UUID → guarde como `FABRIC_WORKSPACE_ID`.

2. Clique no **modelo semântico** (semantic model) das transações pra abri-lo. URL muda pra:
   ```
   https://app.fabric.microsoft.com/groups/{WORKSPACE_ID}/datasets/{DATASET_ID}/details
   ```
   Copie o UUID do dataset → guarde como `FABRIC_DATASET_ID`.

3. Anote o **nome exato da tabela** dentro do modelo (ex.: `transactions`, `Transações`, `fact_transactions`...). Você vai usar literalmente no DAX.

✅ **Fim da Fase 2.**

---

## Fase 3: Preparar destino no BigQuery

> ✅ **Decisão final (2026-05-10):** A tabela `transactions` fica em **`validator-demo-project`** (mesmo projeto do Firebase). Razão: vai ser usada **exclusivamente pelo Validator**, não por outros dashboards de BI. Manter tudo do Validator num projeto só simplifica IAM e billing.

### 3.1 Garantir que está no projeto certo

1. Abra https://console.cloud.google.com
2. Topo da página, dropdown de projeto → selecione **`validator-demo-project`**.

### 3.2 Habilitar APIs

Se ainda não estiverem habilitadas:

1. Search bar do GCP → "APIs & Services" → "Enable APIs and services"
2. Habilite:
   - **BigQuery API**
   - **Cloud Run Admin API** (pra rodar o job depois)
   - **Cloud Scheduler API** (pra agendar)
   - **Secret Manager API** (pra guardar os segredos do Azure)
   - **Artifact Registry API** (pra build do container)

### 3.3 Criar dataset no BigQuery (no `validator-demo-project`)

1. Search bar do GCP → "BigQuery" → abra o BigQuery Studio.
2. Painel à esquerda, três pontinhos ao lado do projeto **`validator-demo-project`** → **"Create dataset"**.
3. Preencha:
   - **Dataset ID:** `origem`
   - **Location type:** Multi-region → **`US`** (mais barata, free tier mais generoso). Como a tabela é usada só pelo Validator e não tem JOIN com outros datasets, região não importa pra nada além de custo.
   - **Default table expiration:** deixe vazio.
4. **"Create dataset"**.

### 3.4 Criar service account GCP pro pipeline (no `validator-demo-project`)

1. Confirme que o projeto selecionado no topo é **`validator-demo-project`**.
2. Search bar → "IAM & Admin" → "Service Accounts".
3. **"+ Create Service Account"**.
4. Name: `validator-bq-pipeline`. **"Create and continue"**.
5. Roles a conceder:
   - `BigQuery Data Editor` (escrever na tabela)
   - `BigQuery Job User` (executar load jobs)
6. **"Done"**.
7. Para rodar **localmente em testes**, gere uma key:
   - Clique na SA criada → aba "Keys" → "Add key" → "Create new key" → JSON.
   - Salva o JSON num lugar seguro **fora do repo** (ex.: `C:\Users\lucas\.gcp\validator-bq-pipeline.json`). Anote o caminho.
   - Em produção (Cloud Run Job), **não vai precisar** dessa key, vamos usar a SA atrelada ao Job.

✅ **Fim da Fase 3.** Estrutura de cloud está pronta.

---

## Fase 4: Script Python local (smoke test)

Antes de empacotar e schedular, vamos provar que conseguimos ler do Fabric e escrever no BQ a partir da sua máquina.

### 4.1 Estrutura do projeto

Na raiz do `validator-turbo/`, crie a pasta `pipeline/`:

```
validator-turbo/
├── pipeline/
│   ├── extract.py
│   ├── requirements.txt
│   ├── .env.local        # ⚠️ não commitar
│   └── .gitignore        # ignora .env.local
└── ...
```

### 4.2 `requirements.txt`

```
requests
msal
google-cloud-bigquery
pandas
pyarrow
python-dotenv
```

### 4.3 `.env.local` (preencher com os valores das fases 1-3)

```
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
FABRIC_WORKSPACE_ID=...
FABRIC_DATASET_ID=...
FABRIC_TABLE_NAME=transactions
GCP_PROJECT_ID=validator-demo-project
GCP_BQ_DATASET=origem
GCP_BQ_TABLE=transactions
GOOGLE_APPLICATION_CREDENTIALS=C:\Users\lucas\.gcp\validator-bq-pipeline.json
```

### 4.4 `extract.py`: versão "smoke test"

Pega 10 linhas pra confirmar que a pipeline funciona ponta-a-ponta.

```python
import os
import requests
import msal
from dotenv import load_dotenv

load_dotenv(".env.local")

TENANT = os.environ["AZURE_TENANT_ID"]
CLIENT_ID = os.environ["AZURE_CLIENT_ID"]
CLIENT_SECRET = os.environ["AZURE_CLIENT_SECRET"]
WORKSPACE = os.environ["FABRIC_WORKSPACE_ID"]
DATASET = os.environ["FABRIC_DATASET_ID"]
TABLE = os.environ["FABRIC_TABLE_NAME"]

def get_token():
    app = msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{TENANT}",
        client_credential=CLIENT_SECRET,
    )
    result = app.acquire_token_for_client(
        scopes=["https://analysis.windows.net/powerbi/api/.default"]
    )
    if "access_token" not in result:
        raise RuntimeError(f"Falha no token: {result}")
    return result["access_token"]

def query_dax(token, dax):
    url = f"https://api.powerbi.com/v1.0/myorg/groups/{WORKSPACE}/datasets/{DATASET}/executeQueries"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"queries": [{"query": dax}], "serializerSettings": {"includeNulls": True}},
    )
    r.raise_for_status()
    return r.json()["results"][0]["tables"][0]["rows"]

if __name__ == "__main__":
    token = get_token()
    rows = query_dax(token, f"EVALUATE TOPN(10, '{TABLE}')")
    print(f"Recebi {len(rows)} linhas. Exemplo:")
    for row in rows[:3]:
        print(row)
```

### 4.5 Rodar

```powershell
cd pipeline
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python extract.py
```

**Sucesso esperado:** imprime 10 linhas com as colunas exatamente como aparecem no modelo semântico.

**Erros comuns:**
- `401 Unauthorized` → SP sem permissão no workspace (Fase 2.2) ou tenant settings desabilitado (Fase 2.1).
- `404 Not Found` → workspace ID ou dataset ID errado.
- `400 Query error` → nome da tabela errado no DAX (Fase 2.3).

✅ **Fim da Fase 4** quando o smoke test imprimir linhas reais.

---

## Fase 5: Carga incremental no BigQuery

Depois que o smoke test funcionar, evoluímos o script pra:

1. Paginação por janela de data (`transactionDate >= today - 7`).
2. Conversão pra DataFrame → load no BQ.
3. `MERGE` por `transactionId` pra fazer upsert (insere novas, atualiza modificadas).
4. Criação da tabela no BQ na primeira execução (com partition por `transactionDate` e cluster por `clientId, currency`).

Esta fase eu te entrego o código completo depois que a Fase 4 estiver verde, assim a gente já sabe os nomes reais das colunas que o modelo retorna.

---

## Fase 6: Deploy: Cloud Run Job + Cloud Scheduler

✅ **Concluído em 2026-05-10.**

### Recursos criados no GCP (projeto `validator-demo-project`)

| Recurso | Tipo | Localização |
|---------|------|-------------|
| `azure-tenant-id`, `azure-client-id`, `azure-client-secret` | Secret Manager | global |
| `validator-pipeline` | Artifact Registry repo (Docker) | us-central1 |
| `incremental:latest` | Imagem Docker | us-central1-docker.pkg.dev/.../validator-pipeline/ |
| `incremental-fabric-bq` | Cloud Run Job | us-central1 |
| `run-incremental-fabric-bq` | Cloud Scheduler | us-central1 |

### Schedule

Cron `0 */2 * * *` em `America/Sao_Paulo`, roda às 00, 02, 04, 06, ... 22h BRT.

### IAM

A SA `validator-bq-pipeline@validator-demo-project.iam.gserviceaccount.com` tem:
- `roles/bigquery.dataEditor` (no projeto)
- `roles/bigquery.jobUser` (no projeto)
- `roles/secretmanager.secretAccessor` (em cada um dos 3 secrets)
- `roles/run.invoker` (no Job: pra Scheduler invocar via OAuth)

### Como rebuildar

Quando mudar `incremental.py` ou `requirements.txt`:

```powershell
cd pipeline
gcloud builds submit --tag us-central1-docker.pkg.dev/validator-demo-project/validator-pipeline/incremental:latest
```

Job pega a nova imagem na próxima execução automaticamente.

### Como rodar manualmente

```powershell
gcloud run jobs execute incremental-fabric-bq --region=us-central1 --wait
```

### Como ver logs

```powershell
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=incremental-fabric-bq" --limit=20 --order=desc --freshness=1h --format="value(textPayload)"
```

Ou pelo console: https://console.cloud.google.com/run/jobs/details/us-central1/incremental-fabric-bq

---

## Checklist de progresso

- [x] **Fase 1:** App Registration criada, 3 credenciais Azure guardadas. _(2026-05-10)_
- [x] **Fase 2.1:** SP habilitada nas tenant settings do Fabric. _(confirmado 2026-05-10)_
- [x] **Fase 2.2:** SP adicionada ao workspace como Member. _(2026-05-10)_
- [x] **Fase 2.3:** Workspace ID, Dataset ID e nome da tabela anotados. _(2026-05-10)_
- [x] **Fase 3:** Dataset `origem` criado no BQ + service account GCP com key local. _(2026-05-10)_
- [x] **Fase 4:** Smoke test do `extract.py` rodando e imprimindo linhas reais. _(2026-05-10, tabela real se chama `transactions`)_
- [x] **Fase 5a:** Backfill completo carregado (298,931 linhas em `validator-demo-project.origem.source_transactions`). _(2026-05-10)_
- [x] **Fase 5b:** Carga incremental funcionando (MERGE por id, janela 7d). _(2026-05-10)_
- [x] **Fase 6:** Cloud Run Job + Scheduler em produção (cron `0 */2 * * *` BRT). _(2026-05-10)_
