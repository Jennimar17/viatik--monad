'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { CONNECTION_FAILED, type EvidenceReadAnswer, type EvidenceReadRequest } from './api-contract'
import { ApiDataSource } from './api-data-source'
import { DataSourceError, getDataSource } from './index'
import { useViatik } from './react'

/** Prefix of the "does this deployment read files with Kimi" query. */
export const EVIDENCE_READER_KEY = ['evidence-reader'] as const

/**
 * Kimi's reader for the signed-in person: `enabled` only for a real account
 * on a deployment with a Kimi key (the demo people never see it), and `read`
 * has Kimi read a file the person already uploaded. The answer is a proposal
 * to check; nothing is saved and no command runs.
 */
export function useEvidenceReader() {
  const { userId, mode, credentials } = useViatik()
  const queryClient = useQueryClient()
  const source = mode ? getDataSource(mode) : null
  const api = source instanceof ApiDataSource ? source : null

  const status = useQuery({
    queryKey: [...EVIDENCE_READER_KEY, mode, userId],
    queryFn: () => api!.evidenceReaderStatus(userId as string, { credentials }),
    enabled: Boolean(api && userId),
    staleTime: 10 * 60_000,
    // A deployment without the route, or any failure: the reader just stays hidden.
    retry: false,
  })
  const enabled = Boolean(api && userId && status.data?.enabled)

  const read = React.useCallback(
    async (request: EvidenceReadRequest): Promise<EvidenceReadAnswer> => {
      if (!api || !userId) {
        throw new DataSourceError('Reading files with Kimi is not available.', 'feature_disabled')
      }
      try {
        return await api.readEvidence(userId, request, { credentials })
      } catch (error) {
        if (!(error instanceof DataSourceError)) {
          throw new DataSourceError('Kimi could not read this file. Fill in the details yourself.', 'unknown')
        }
        // Turned off meanwhile: ask again, so the button goes away.
        if (error.code === 'feature_disabled') {
          void queryClient.invalidateQueries({ queryKey: EVIDENCE_READER_KEY })
        }
        if (error.code === CONNECTION_FAILED) {
          throw new DataSourceError(
            'Kimi did not answer in time. Try again, or fill in the details yourself.',
            CONNECTION_FAILED,
          )
        }
        throw error
      }
    },
    [api, userId, credentials, queryClient],
  )

  return { enabled, read }
}
