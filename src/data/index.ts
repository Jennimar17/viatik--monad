import { publicEnv } from '@/lib/env'

import { ApiDataSource } from './api-data-source'
import type { DataSource, SessionMode } from './data-source'
import { MockDataSource } from './mock-data-source'

export * from './data-source'

let demo: MockDataSource | null = null
const demoSource = () => (demo ??= new MockDataSource())

let api: ApiDataSource | null = null
const apiSource = () => (api ??= new ApiDataSource())

/**
 * Which data each kind of session reads and changes. The demo people always
 * use this device's demo data; real accounts use the shared server state
 * once the API is enabled (`NEXT_PUBLIC_DATA_SOURCE=api`), and until then the
 * device's demo data under their verified identity.
 */
const SOURCES: Record<SessionMode, () => DataSource> = {
  demo: demoSource,
  account: publicEnv.NEXT_PUBLIC_DATA_SOURCE === 'api' ? apiSource : demoSource,
}

export function getDataSource(mode: SessionMode): DataSource {
  return SOURCES[mode]()
}
