import type { EmergencyReport, EmergencySettings, TrustedContact } from './types'

const DATABASE_NAME = 'arkgrid-emergency'
const DATABASE_VERSION = 2
const REPORTS_STORE = 'reports'
const SETTINGS_STORE = 'settings'

export interface EmergencyStorage {
  listReports(): Promise<EmergencyReport[]>
  getReport(id: string): Promise<EmergencyReport | undefined>
  saveReport(report: EmergencyReport): Promise<void>
  deleteReport(id: string): Promise<void>
  getSettings(): Promise<EmergencySettings>
  saveSettings(settings: EmergencySettings): Promise<void>
}

function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(REPORTS_STORE)) {
        database.createObjectStore(REPORTS_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local emergency storage.'))
    request.onblocked = () => reject(new Error('Local emergency storage is blocked by another ArkGrid tab.'))
  })
}

function normalizeSettings(value: Record<string, unknown> | undefined): EmergencySettings {
  const rawContacts: unknown[] = Array.isArray(value?.trustedContacts) ? value.trustedContacts : []
  const trustedContacts: TrustedContact[] = rawContacts.flatMap((contact, index) => {
    if (typeof contact === 'string') {
      return [{
        id: `legacy-${index}`,
        name: 'Saved phone contact',
        relationship: 'Not specified',
        phone: contact,
        note: '',
      }]
    }
    if (typeof contact === 'object' && contact !== null) {
      const record = contact as Partial<TrustedContact>
      if (typeof record.id === 'string' && typeof record.name === 'string' &&
        typeof record.relationship === 'string' && typeof record.phone === 'string' &&
        typeof record.note === 'string') return [record as TrustedContact]
    }
    return []
  })
  const recent = value?.recentLocation
  const recentLocation =
    typeof recent === 'object' && recent !== null &&
    'latitude' in recent && typeof recent.latitude === 'number' &&
    'longitude' in recent && typeof recent.longitude === 'number' &&
    'accuracyMeters' in recent && typeof recent.accuracyMeters === 'number' &&
    'capturedAt' in recent && typeof recent.capturedAt === 'string'
      ? { latitude: recent.latitude, longitude: recent.longitude, accuracyMeters: recent.accuracyMeters, capturedAt: recent.capturedAt }
      : null

  return {
    id: 'settings',
    emergencyRegion: typeof value?.emergencyRegion === 'string'
      ? value.emergencyRegion.trim().slice(0, 80)
      : '',
    trustedContacts,
    lastSyncAt: typeof value?.lastSyncAt === 'string' ? value.lastSyncAt : null,
    recentLocation,
  }
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
  factory?: IDBFactory,
): Promise<T> {
  const database = await openDatabase(factory)
  try {
    const transaction = database.transaction(storeName, mode)
    return await new Promise<T>((resolve, reject) => {
      const request = operation(transaction.objectStore(storeName))
      let result: T
      let requestSucceeded = false
      request.onsuccess = () => {
        result = request.result
        requestSucceeded = true
      }
      request.onerror = () => reject(request.error ?? new Error('Local emergency storage request failed.'))
      transaction.oncomplete = () => {
        if (requestSucceeded) resolve(result)
        else reject(new Error('Local emergency storage transaction completed without a result.'))
      }
      transaction.onabort = () => reject(transaction.error ?? new Error('Local emergency storage transaction was aborted.'))
    })
  } finally {
    database.close()
  }
}

export function createEmergencyStorage(factory?: IDBFactory): EmergencyStorage {
  return {
    async listReports() {
      const reports = await withStore(REPORTS_STORE, 'readonly', store => store.getAll(), factory)
      return reports.map(report => ({
        ...report,
        serverIncidentId: report.serverIncidentId ?? null,
        syncAttempts: report.syncAttempts ?? 0,
        locationSource: report.locationSource ?? 'unknown',
        locationAccuracyMeters: report.locationAccuracyMeters ?? null,
        locationCapturedAt: report.locationCapturedAt ?? null,
      })).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },
    async getReport(id) {
      const report = await withStore(REPORTS_STORE, 'readonly', store => store.get(id), factory)
      return report ? {
        ...report,
        serverIncidentId: report.serverIncidentId ?? null,
        syncAttempts: report.syncAttempts ?? 0,
        locationSource: report.locationSource ?? 'unknown',
        locationAccuracyMeters: report.locationAccuracyMeters ?? null,
        locationCapturedAt: report.locationCapturedAt ?? null,
      } : undefined
    },
    async saveReport(report) {
      await withStore(REPORTS_STORE, 'readwrite', store => store.put(report), factory)
    },
    async deleteReport(id) {
      await withStore(REPORTS_STORE, 'readwrite', store => store.delete(id), factory)
    },
    async getSettings() {
      const settings = await withStore<Record<string, unknown> | undefined>(
        SETTINGS_STORE,
        'readonly',
        store => store.get('settings'),
        factory,
      )
      return normalizeSettings(settings)
    },
    async saveSettings(settings) {
      await withStore(SETTINGS_STORE, 'readwrite', store => store.put(settings), factory)
    },
  }
}

export const emergencyStorage = createEmergencyStorage()
