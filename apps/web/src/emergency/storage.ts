import type { EmergencyReport, EmergencySettings } from './types'

const DATABASE_NAME = 'arkgrid-emergency'
const DATABASE_VERSION = 1
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
      return reports.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },
    getReport(id) {
      return withStore(REPORTS_STORE, 'readonly', store => store.get(id), factory)
    },
    async saveReport(report) {
      await withStore(REPORTS_STORE, 'readwrite', store => store.put(report), factory)
    },
    async deleteReport(id) {
      await withStore(REPORTS_STORE, 'readwrite', store => store.delete(id), factory)
    },
    async getSettings() {
      const settings = await withStore< EmergencySettings | undefined>(
        SETTINGS_STORE,
        'readonly',
        store => store.get('settings'),
        factory,
      )
      return settings ?? { id: 'settings', trustedContacts: [], lastSyncAt: null }
    },
    async saveSettings(settings) {
      await withStore(SETTINGS_STORE, 'readwrite', store => store.put(settings), factory)
    },
  }
}

export const emergencyStorage = createEmergencyStorage()
