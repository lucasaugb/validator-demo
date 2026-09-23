import type { Transaction } from '../types'
import { finalStatus } from '../types'

/**
 * Gera um CSV plano com as principais colunas de cada transação e dispara
 * download no browser. Usa "," como separador e escapa aspas duplas. Datas
 * permanecem ISO (yyyy-mm-dd): Excel/Sheets interpreta automaticamente.
 */
export function exportTransactionsCsv(transactions: Transaction[], filename = 'transactions.csv') {
  const headers = [
    'transactionNumber',
    'transactionDate',
    'createdAt',
    'updatedAt',
    'agenteName',
    'agenteSetor',
    'clientId',
    'clientName',
    'clientEmail',
    'clientPhone',
    'currency',
    'amount',
    'systemValidation',
    'conversationValidation',
    'isActivation',
    'finalStatus',
    'lastOperationDate',
  ]

  const lines: string[] = [headers.join(',')]
  for (const d of transactions) {
    lines.push(
      [
        d.transactionNumber ?? '',
        d.transactionDate,
        toIso(d.createdAt?.toMillis?.()),
        toIso(d.updatedAt?.toMillis?.()),
        d.agenteName,
        d.agenteSetor ?? '',
        d.clientId,
        d.clientName,
        d.clientEmail,
        d.clientPhone,
        d.currency,
        d.amount,
        d.systemValidation,
        d.conversationValidation,
        d.isActivation ? 'true' : 'false',
        finalStatus(d),
        d.lastOperationDate ?? '',
      ]
        .map(csvEscape)
        .join(','),
    )
  }

  const blob = new Blob(['﻿' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toIso(ms: number | undefined): string {
  if (!ms) return ''
  return new Date(ms).toISOString()
}
