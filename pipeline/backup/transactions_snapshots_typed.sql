-- View que tipa as colunas mais usadas do raw JSON de `transactions_snapshots`.
--
-- Usa SAFE.STRING / SAFE.* pra tolerar docs antigos com tipo errado em algum
-- campo (a view canônica `validator.transactions_view` quebra nesses casos; aqui
-- a coluna sai NULL e o resto da linha sobrevive).
--
-- Use SEMPRE com filtro de partição em `snapshot_at` (ex.: WHERE DATE(snapshot_at) >= ...)
-- pra economizar scan. Storage cresce ~24MB/dia, então sem filtro a query lê
-- até 90 dias × 24 snapshots × N transações.
CREATE OR REPLACE VIEW `validator-demo-project.validator_backup.transactions_snapshots_typed` AS
SELECT
  snapshot_at,
  document_id,
  document_name,
  last_modified,
  operation,
  event_id,
  SAFE.STRING(data.transactionNumber) AS transaction_number_str,
  SAFE_CAST(SAFE.INT64(data.transactionNumber) AS INT64) AS transaction_number,
  SAFE.STRING(data.agenteId) AS agente_id,
  SAFE.STRING(data.agenteName) AS agente_name,
  SAFE.STRING(data.agenteSetor) AS agente_setor,
  SAFE.STRING(data.clientId) AS client_id,
  SAFE.STRING(data.clientName) AS client_name,
  SAFE.STRING(data.clientEmail) AS client_email,
  SAFE.STRING(data.clientPhone) AS client_phone,
  SAFE.STRING(data.currency) AS currency,
  SAFE_CAST(SAFE.FLOAT64(data.amount) AS NUMERIC) AS amount,
  SAFE_CAST(SAFE.FLOAT64(data.usdAmount) AS NUMERIC) AS usd_amount,
  SAFE.STRING(data.transactionDate) AS transaction_date,
  SAFE.STRING(data.systemValidation) AS system_validation,
  SAFE.STRING(data.conversationValidation) AS conversation_validation,
  SAFE.BOOL(data.isActivation) AS is_activation,
  SAFE.STRING(data.conversationNote) AS conversation_note,
  SAFE.STRING(data.matchedTransactionId) AS matched_transaction_id,
  data AS raw_data
FROM `validator-demo-project.validator_backup.transactions_snapshots`;
