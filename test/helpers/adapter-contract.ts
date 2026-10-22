import type { DesiredRecord, DnsAdapter } from '@flash-dns/types'
import { describe, expect, it } from 'vitest'

/** Reuse with a fresh, isolated offline provider fixture for each test. */
export function adapterContract<P extends object>(name: string, factory: () => DnsAdapter<P>): void {
  describe(`${name} v1 adapter contract`, () => {
    it('maintains ownership and record ID through create/read/update/delete', async () => {
      const adapter = factory()
      const zone = await adapter.resolveZone('example.com')
      const input: DesiredRecord<P> = {
        zone: zone.name,
        name: 'contract.example.com',
        type: 'TXT',
        content: 'Raw Case Sensitive TXT',
        owner: { application: 'contract-test', id: 'isolated-fixture' }
      }
      const created = await adapter.createRecord(zone.id, input)
      expect(created).toMatchObject({ name: input.name, content: input.content, ownership: input.owner, zoneId: zone.id })
      expect(await adapter.getRecord(zone.id, created.id)).toEqual(created)
      const updated = await adapter.updateRecord(zone.id, created.id, { ...input, content: 'Updated TXT' })
      expect(updated).toMatchObject({ id: created.id, content: 'Updated TXT', ownership: input.owner })
      expect((await adapter.listRecords(zone.id, input.name)).map(record => record.id)).toEqual([created.id])
      await adapter.deleteRecord(zone.id, created.id)
      expect(await adapter.getRecord(zone.id, created.id)).toBeUndefined()
      await adapter.deleteRecord(zone.id, created.id)
    })
    it('honors a pre-aborted operation without performing a mutation', async () => {
      const adapter = factory()
      await expect(adapter.listRecords('zone-1', undefined, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'OPERATION_ABORTED' })
    })
  })
}
