import type { EmergencyReport } from './types'

export interface CommunicationProvider {
  readonly id: string
  readonly label: string
}

export interface BackendSyncProvider extends CommunicationProvider {
  sync(report: EmergencyReport): Promise<{ serverId: string; synchronizedAt: string }>
}

export interface SmsHandoffProvider extends CommunicationProvider {
  createHref(recipient: string, message: string): string
  createMessage(report: EmergencyReport): string
}

export interface FutureBluetoothProvider extends CommunicationProvider {
  readonly supported: false
}

export const backendSyncProvider: BackendSyncProvider = {
  id: 'backend-sync',
  label: 'ArkGrid backend synchronization',
  async sync() {
    throw new Error('Backend synchronization is not configured in this project.')
  },
}

export function createBackendSyncProvider(
  baseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): BackendSyncProvider {
  return {
    ...backendSyncProvider,
    async sync(report) {
      if (!baseUrl) throw new Error('Backend synchronization is not configured in this project.')
      const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/incidents`
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': report.id,
        },
        body: JSON.stringify(report),
      })
      if (!response.ok) throw new Error(`Backend rejected the report (HTTP ${response.status}).`)
      const result: unknown = await response.json()
      if (
        typeof result !== 'object' ||
        result === null ||
        !('id' in result) ||
        typeof result.id !== 'string'
      ) {
        throw new Error('Backend returned an invalid acknowledgement.')
      }
      return { serverId: result.id, synchronizedAt: new Date().toISOString() }
    },
  }
}

export const bluetoothRelayProvider: FutureBluetoothProvider = {
  id: 'bluetooth-relay',
  label: 'Bluetooth relay (not yet supported)',
  supported: false,
}

export function normalizePhoneNumber(value: string): string | null {
  const normalized = value.trim().replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null
}

export function formatSmsMessage(report: EmergencyReport): string {
  const coordinates = report.latitude !== null && report.longitude !== null
    ? `${report.latitude.toFixed(5)},${report.longitude.toFixed(5)}`
    : ''
  const location = [coordinates, report.manualLocation.trim()].filter(Boolean).join(' / ')
  const parts = [
    `ARKGRID SOS ${report.id}`,
    `${report.severity} ${report.incidentType}; ${report.peopleAffected} affected`,
    `Location: ${location}`,
    `Time: ${new Date(report.createdAt).toISOString()}`,
    `Need: ${report.category}`,
    report.message.trim() ? `Details: ${report.message.trim()}` : '',
    report.assistanceNote.trim() ? `Assistance: ${report.assistanceNote.trim()}` : '',
  ]
  return parts.filter(Boolean).join('\n')
}

export const smsHandoffProvider: SmsHandoffProvider = {
  id: 'sms-handoff',
  label: 'User-confirmed SMS handoff',
  createHref(recipient, message) {
    return `sms:${recipient}?body=${encodeURIComponent(message)}`
  },
  createMessage: formatSmsMessage,
}

export function isLikelyMultipartSms(message: string): boolean {
  return message.length > 160
}

export function mapSyncError(error: unknown): string {
  if (error instanceof Error && error.message === 'Backend synchronization is not configured in this project.') {
    return 'Backend synchronization is not configured.'
  }
  if (error instanceof Error && error.message.startsWith('Backend rejected the report')) {
    return error.message
  }
  if (error instanceof Error && error.message === 'Backend returned an invalid acknowledgement.') {
    return error.message
  }
  return 'Synchronization failed. Your report remains saved on this device.'
}
