-- Tabela de backup horário das transações do Validator.
--
-- Append-only: cada execução do Scheduled Query adiciona uma linha por transaction
-- ATIVO com `snapshot_at = CURRENT_TIMESTAMP()`.
--
-- POR QUE RAW JSON e não colunas tipadas: a view `validator.transactions_view` faz
-- `STRING(d.clientId)` etc, que falha se algum doc tiver campo com tipo
-- diferente (number em vez de string). Backup precisa ser resiliente a TODOS
-- os docs, inclusive os que quebrariam a view. Restore lê o JSON cru.
--
-- Particionada por DATE(snapshot_at) com expiração de 90 dias (custo de
-- storage controlado). Clustering por document_id permite recuperar histórico
-- de UM transaction específico sem fazer full scan.
--
-- Custo estimado (volume atual + crescimento 60 agentes):
--   - Storage: ~720MB ativos rotacionando = ~$0.015/mês
--   - Query (snapshot horário scan changelog): ~720MB/mês = ~$0.004/mês
--   - Total: <$0.05/mês
CREATE TABLE IF NOT EXISTS `validator-demo-project.validator_backup.transactions_snapshots` (
  snapshot_at TIMESTAMP NOT NULL,
  document_id STRING NOT NULL,
  document_name STRING,
  last_modified TIMESTAMP,
  operation STRING,
  data JSON,
  event_id STRING
)
PARTITION BY DATE(snapshot_at)
CLUSTER BY document_id
OPTIONS (
  description = "Snapshot horário do estado atual de cada transaction (lido de validator.transactions_raw_latest). Append-only; raw JSON.",
  partition_expiration_days = 90,
  require_partition_filter = FALSE
);
