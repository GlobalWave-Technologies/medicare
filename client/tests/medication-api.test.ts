import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { medicationsApi } from '../src/api/medications'
import { resetApiSession } from '../src/api/client'

// The catalog client: names only, reads without CSRF, and changes through the shared CSRF transport.
const fetcher = vi.fn<typeof fetch>(), ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const medication = { id: 'catalog-paracetamol', name: 'Paracetamol', active: true, createdAt: '2026-11-11T09:00:00.000Z', updatedAt: '2026-11-11T09:00:00.000Z' }
beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals(); resetApiSession() })

it('lists the catalog with status, trimmed search and paging, without CSRF', async () => {
  fetcher.mockImplementation(async () => ok({ items: [medication], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }))
  const signal = new AbortController().signal
  await medicationsApi.list({}, signal)
  await medicationsApi.list({ page: 2, limit: 10, status: 'inactive', search: '  para % ' })
  await medicationsApi.list({ status: 'all', search: '   ' })
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['/api/v1/medications?page=1&limit=20&status=active',
    '/api/v1/medications?page=2&limit=10&status=inactive&search=para+%25', '/api/v1/medications?page=1&limit=20&status=all'])
  expect(fetcher.mock.calls[0]![1]?.signal).toBe(signal)
  expect(fetcher.mock.calls.every(([, init]) => !new Headers(init?.headers).has('X-CSRF-Token') && init?.credentials === 'include')).toBe(true)
})
it('loads every active medicine for the prescribing dropdown in one request', async () => {
  fetcher.mockResolvedValueOnce(ok({ items: [{ id: medication.id, name: medication.name }] }))
  expect(await medicationsApi.options()).toEqual({ items: [{ id: medication.id, name: medication.name }] })
  expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/medications/options'); expect(fetcher).toHaveBeenCalledOnce()
})
it.each(['create', 'deactivate', 'reactivate'] as const)('%s sends only the documented body with the shared CSRF token', async (action) => {
  fetcher.mockResolvedValueOnce(ok({ csrfToken: 'b'.repeat(64) })).mockResolvedValueOnce(ok({ medication }))
  const result = action === 'create' ? await medicationsApi.create('Paracetamol') : await medicationsApi[action]('id/with space')
  expect(result).toEqual({ medication })
  const [url, init] = fetcher.mock.calls[1]!
  expect(url).toBe(action === 'create' ? '/api/v1/medications' : `/api/v1/medications/id%2Fwith%20space/${action}`)
  expect(init?.method).toBe('POST'); expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('b'.repeat(64))
  expect(JSON.parse(String(init?.body))).toEqual(action === 'create' ? { name: 'Paracetamol' } : {})
  expect(new Headers(init?.headers).has('Idempotency-Key')).toBe(false)
})
