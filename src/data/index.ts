import type { DataSource, SessionMode } from './data-source'
import { MockDataSource } from './mock-data-source'

export * from './data-source'

let demo: MockDataSource | null = null
const demoSource = () => (demo ??= new MockDataSource())

/** Which data each kind of session reads and changes. */
const SOURCES: Record<SessionMode, () => DataSource> = {
  demo: demoSource,
  // Until the API data source lands (phase 7), real accounts share this
  // device's demo data under their verified identity.
  account: demoSource,
}

export function getDataSource(mode: SessionMode): DataSource {
  return SOURCES[mode]()
}
