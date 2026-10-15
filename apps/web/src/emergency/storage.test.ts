import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createEmergencyStorage } from './storage'
import type { TrustedContact } from './types'

const firstContact: TrustedContact = {
  id: 'contact-1',
  name: 'Asha',
  relationship: 'Sister',
  phone: '+9779812345678',
  note: 'Call after 6 pm',
}

describe('local emergency settings storage', () => {
  it('saves contacts, retrieves them after reopening, edits and deletes them', async () => {
    const factory = new IDBFactory()
    const storage = createEmergencyStorage(factory)

    await storage.updateSettings(settings => ({
      ...settings,
      trustedContacts: [...settings.trustedContacts, firstContact],
    }))
    expect(await createEmergencyStorage(factory).getSettings()).toMatchObject({
      trustedContacts: [firstContact],
    })

    await storage.updateSettings(settings => ({
      ...settings,
      trustedContacts: settings.trustedContacts.map(contact =>
        contact.id === firstContact.id ? { ...contact, name: 'Asha Rai' } : contact,
      ),
    }))
    expect((await storage.getSettings()).trustedContacts[0].name).toBe('Asha Rai')

    await storage.updateSettings(settings => ({
      ...settings,
      trustedContacts: settings.trustedContacts.filter(contact => contact.id !== firstContact.id),
    }))
    expect((await storage.getSettings()).trustedContacts).toEqual([])
  })

  it('preserves existing settings and reports when upgrading the current database', async () => {
    const factory = new IDBFactory()
    const request = factory.open('arkgrid-emergency', 1)
    const legacyContact = '+9779812345678'
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('reports', { keyPath: 'id' })
        request.result.createObjectStore('settings', { keyPath: 'id' })
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction(['reports', 'settings'], 'readwrite')
        transaction.objectStore('reports').put({ id: 'existing-report' })
        transaction.objectStore('settings').put({
          id: 'settings',
          emergencyRegion: 'Nepal',
          trustedContacts: [legacyContact],
          lastSyncAt: null,
          recentLocation: null,
        })
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })

    const storage = createEmergencyStorage(factory)
    expect(await storage.getSettings()).toMatchObject({
      emergencyRegion: 'Nepal',
      trustedContacts: [{
        id: 'legacy-0',
        phone: legacyContact,
      }],
    })
    expect(await storage.getReport('existing-report')).toMatchObject({ id: 'existing-report' })
  })

  it('serializes concurrent setting updates without losing a contact or region', async () => {
    const storage = createEmergencyStorage(new IDBFactory())
    await Promise.all([
      storage.updateSettings(settings => ({ ...settings, trustedContacts: [firstContact] })),
      storage.updateSettings(settings => ({ ...settings, emergencyRegion: 'Nepal' })),
    ])

    expect(await storage.getSettings()).toMatchObject({
      emergencyRegion: 'Nepal',
      trustedContacts: [firstContact],
    })
  })
})
