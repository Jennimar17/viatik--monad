'use client'

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from 'lucide-react'
import * as React from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type Facet<T> = {
  id: string
  label: string
  options: { value: string; label: string }[]
  accessor: (row: T) => string
}

export type DataTableProps<T> = {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  /** Card rendering used below the md breakpoint instead of the table. */
  renderMobile?: (row: T) => React.ReactNode
  searchPlaceholder?: string
  searchText?: (row: T) => string
  facets?: Facet<T>[]
  toolbar?: React.ReactNode
  onRowClick?: (row: T) => void
  empty?: React.ReactNode
  pageSize?: number
  initialSorting?: SortingState
  className?: string
  caption?: string
}

// Stable default: a fresh `[]` per render would change the `filtered` memo on
// every render, and TanStack's automatic page reset (a microtask that sets
// state) would then re-render the table forever — a synchronous loop when it
// starts inside a pointer event, which froze the whole tab.
const NO_FACETS: never[] = []

/**
 * Tables for money: search, facet chips, sorting, pagination, and a card
 * layout on phones. Numeric columns should right-align with `num` cells.
 */
export function DataTable<T>({
  data,
  columns,
  renderMobile,
  searchPlaceholder = 'Search',
  searchText,
  facets = NO_FACETS,
  toolbar,
  onRowClick,
  empty,
  pageSize = 10,
  initialSorting = [],
  className,
  caption,
}: DataTableProps<T>) {
  const [query, setQuery] = React.useState('')
  const [facetValues, setFacetValues] = React.useState<Record<string, string>>({})
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.filter((row) => {
      for (const facet of facets) {
        const selected = facetValues[facet.id]
        if (selected && facet.accessor(row) !== selected) return false
      }
      if (!needle || !searchText) return true
      return searchText(row).toLowerCase().includes(needle)
    })
  }, [data, query, facetValues, facets, searchText])

  // TanStack Table returns stable functions; the React Compiler lint rule does not apply here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    // The page index is reset below when the search or a facet changes; the
    // automatic reset would also fire on every parent re-render.
    autoResetPageIndex: false,
  })

  React.useEffect(() => {
    table.setPageIndex(0)
  }, [query, facetValues, table])

  const rows = table.getRowModel().rows
  const hasFilters = query !== '' || Object.values(facetValues).some(Boolean)
  const clearFilters = () => {
    setQuery('')
    setFacetValues({})
  }
  const activate = (row: Row<T>) => onRowClick?.(row.original)
  const interactive = Boolean(onRowClick)

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {(searchText || facets.length > 0 || toolbar) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {searchText ? (
              <label className="flex h-9 w-full items-center gap-2 rounded-full border border-input bg-input/30 px-3.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 sm:w-64">
                <Search className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle/80"
                />
              </label>
            ) : null}
            {facets.map((facet) => (
              <div
                key={facet.id}
                className="flex max-w-full scrollbar-none items-center gap-1 overflow-x-auto"
                role="group"
                aria-label={facet.label}
              >
                {facet.options.map((option) => {
                  const active = facetValues[facet.id] === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setFacetValues((prev) => ({ ...prev, [facet.id]: active ? '' : option.value }))
                      }
                      className={cn(
                        'h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active
                          ? 'border-mist bg-mist/10 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            ))}
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-subtle hover:text-foreground"
              >
                <X className="size-3.5" /> Clear
              </button>
            ) : null}
          </div>
          {toolbar ? <div className="flex shrink-0 items-center gap-2">{toolbar}</div> : null}
        </div>
      )}

      {rows.length === 0 ? (
        hasFilters ? (
          // Filtered out, not empty: the data exists, so offer a way back to it.
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            <span>No results for these filters.</span>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
            >
              <X className="size-3.5" aria-hidden="true" /> Clear filters
            </button>
          </div>
        ) : (
          (empty ?? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              Nothing here yet.
            </div>
          ))
        )
      ) : (
        <>
          {renderMobile ? (
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  {interactive ? (
                    <button
                      type="button"
                      onClick={() => activate(row)}
                      className="block w-full px-4 py-3.5 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                    >
                      {renderMobile(row.original)}
                    </button>
                  ) : (
                    <div className="px-4 py-3.5">{renderMobile(row.original)}</div>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <div
            className={cn(
              'overflow-hidden rounded-xl border border-border bg-card',
              renderMobile && 'hidden md:block',
            )}
          >
            <Table>
              {caption ? <caption className="sr-only">{caption}</caption> : null}
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id} className="hover:bg-transparent">
                    {group.headers.map((header) => {
                      const sortable = header.column.getCanSort()
                      const sorted = header.column.getIsSorted()
                      const align = (header.column.columnDef.meta as { align?: 'right' } | undefined)?.align
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                          }
                          className={cn(
                            'h-10 bg-muted/30 text-xs font-medium text-subtle',
                            align === 'right' && 'text-right',
                          )}
                        >
                          {header.isPlaceholder ? null : sortable ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={cn(
                                'inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                                align === 'right' && 'flex-row-reverse',
                              )}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === 'asc' ? (
                                <ArrowUp className="size-3" />
                              ) : sorted === 'desc' ? (
                                <ArrowDown className="size-3" />
                              ) : (
                                <ChevronsUpDown className="size-3 opacity-50" />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={interactive ? () => activate(row) : undefined}
                    onKeyDown={
                      interactive
                        ? (event) => {
                            if (event.key === 'Enter') activate(row)
                          }
                        : undefined
                    }
                    tabIndex={interactive ? 0 : undefined}
                    className={cn(interactive && 'cursor-pointer outline-none focus-visible:bg-muted/50')}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const align = (cell.column.columnDef.meta as { align?: 'right' } | undefined)?.align
                      return (
                        <TableCell key={cell.id} className={cn('py-3', align === 'right' && 'text-right')}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {table.getPageCount() > 1 ? (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–
                {Math.min(
                  (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                  filtered.length,
                )}{' '}
                of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => table.previousPage()}
                  className="inline-flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={!table.getCanNextPage()}
                  onClick={() => table.nextPage()}
                  className="inline-flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-40"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
