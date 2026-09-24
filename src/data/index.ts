import type { DataSource } from './data-source'
import { MockDataSource } from './mock-data-source'

export * from './data-source'

let instance: DataSource | null = null

/**
 * The data source for this page load. The API data source arrives with the
 * backend phase; until then `NEXT_PUBLIC_DATA_SOURCE=api` still uses the demo.
 */
export function getDataSource(): DataSource {
  instance ??= new MockDataSource()
  return instance
}
