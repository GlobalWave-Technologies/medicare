import { z } from 'zod'

export const paginationFields = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}

export function paginationWindow(query: { page: number; limit: number }) {
  return { skip: (query.page - 1) * query.limit, take: query.limit }
}
