CREATE OR REPLACE VIEW `validator-demo-project.validator.transactions_view` AS
WITH src AS (
  SELECT
    document_id,
    timestamp AS last_synced,
    SAFE.PARSE_JSON(data) AS d
  FROM `validator-demo-project.validator.transactions_raw_latest`
  WHERE operation != 'DELETE'
)
SELECT
  document_id,
  last_synced,

  -- Agente
  STRING(d.agenteId) AS agente_id,
  STRING(d.agenteName) AS agente_name,
  STRING(d.agenteSetor) AS agente_setor,

  -- Cliente
  STRING(d.clientId) AS client_id,
  STRING(d.clientName) AS client_name,
  STRING(d.clientEmail) AS client_email,
  STRING(d.clientPhone) AS client_phone,

  -- Valores
  STRING(d.currency) AS currency,
  CAST(FLOAT64(d.amount) AS NUMERIC) AS amount,
  CAST(FLOAT64(d.balance) AS NUMERIC) AS balance,
  CAST(FLOAT64(d.bonus) AS NUMERIC) AS bonus,
  CAST(FLOAT64(d.netCapital) AS NUMERIC) AS net_capital,

  -- Data do transacao (string YYYY-MM-DD do Validator)
  PARSE_DATE('%Y-%m-%d', STRING(d.transactionDate)) AS transaction_date,

  -- Validacoes (cruas, vem do Firestore)
  STRING(d.systemValidation) AS system_validation,
  STRING(d.conversationValidation) AS conversation_validation,
  BOOL(d.isActivation) AS is_activation,
  STRING(d.conversationNote) AS conversation_note,

  -- Checks granulares (preenchidos pela Cloud Function de validacao quando rodar)
  BOOL(d.validationChecks.id_check) AS id_check,
  BOOL(d.validationChecks.value_check) AS value_check,
  BOOL(d.validationChecks.currency_check) AS currency_check,
  BOOL(d.validationChecks.date_check) AS date_check,
  BOOL(d.validationChecks.duplicate_check) AS duplicate_check,
  STRING(d.matchedTransactionId) AS matched_transaction_id,

  -- Status final derivado
  CASE
    WHEN STRING(d.systemValidation) IN ('invalid', 'duplicate') THEN 'not_validated'
    WHEN STRING(d.conversationValidation) = 'rejected' THEN 'not_validated'
    WHEN STRING(d.systemValidation) = 'verified'
         AND STRING(d.conversationValidation) = 'approved' THEN 'validated'
    ELSE 'pending'
  END AS final_status

FROM src;
