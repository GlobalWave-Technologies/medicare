import { defineConfig } from 'prisma/config'
import { loadDatabaseUrl } from './src/config/env.js'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: loadDatabaseUrl() },
})
