'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { CONNECTION_FAILED, type EvidenceReadAnswer, type EvidenceReadRequest } from './api-contract'
import { ApiDataSource } from './api-data-source'
import { DataSourceError, getDataSource, type UploadedFile } from './index'
import { KIMI_RECORDINGS } from './kimi-recordings'
import {
  recordedReading,
  recordingBySha256,
  recordingOf,
  type DemoSampleId,
  type KimiRecording,
  type RecordedAnswer,
} from './kimi-samples'
import { useEvidenceFiles, useViatik } from './react'

/** Prefix of the "does this deployment read files with Kimi" query. */
export const EVIDENCE_READER_KEY = ['evidence-reader'] as const

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Kimi's reader for the signed-in person. For a real account, `enabled` only
 * on a deployment with a Kimi key, and `read` has Kimi read a file the person
 * already uploaded. In the demo (`recorded`), nothing is sent to Kimi: `read`
 * replays Kimi's recorded reading of a sample file (kimi-samples.ts), and
 * `attachSample` adds that sample the way an upload would. Either way the
 * answer is a proposal to check; nothing is saved and no command runs.
 */
export function useEvidenceReader() {
  const { userId, mode, credentials, state } = useViatik()
  const { upload } = useEvidenceFiles()
  const queryClient = useQueryClient()
  const demo = mode === 'demo'
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
  const enabled = demo
    ? Boolean(userId && state && KIMI_RECORDINGS.length > 0)
    : Boolean(api && userId && status.data?.enabled)

  const read = React.useCallback(
    async (request: EvidenceReadRequest): Promise<EvidenceReadAnswer | RecordedAnswer> => {
      if (demo) {
        if (!userId || !state) {
          throw new DataSourceError('Reading files with Kimi is not available.', 'feature_disabled')
        }
        await wait(800 + Math.random() * 700)
        return recordedReading({ state, userId, now: new Date().toISOString(), request })
      }
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
    [demo, state, api, userId, credentials, queryClient],
  )

  // The demo's sample, fetched from public/ and stored like any upload; refused unless it is the
  // exact file Kimi read.
  const attachSample = React.useCallback(
    async (id: DemoSampleId): Promise<UploadedFile> => {
      const unavailable = new DataSourceError(
        'The sample could not be loaded. Try again.',
        'sample_unavailable',
      )
      const rec = recordingOf(id)
      if (!rec) throw unavailable
      const blob = await fetch(rec.file.path)
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => null)
      if (!blob) throw unavailable
      const stored = await upload(new File([blob], rec.file.name, { type: rec.file.mimeType }))
      if (stored.sha256 !== rec.file.sha256) {
        throw new DataSourceError(
          'This sample is not the file Kimi read. Fill in the details yourself.',
          'sample_changed',
        )
      }
      return stored
    },
    [upload],
  )

  const recordingFor = React.useCallback(
    (sha256: string): KimiRecording | undefined => (demo ? recordingBySha256(sha256) : undefined),
    [demo],
  )

  return {
    enabled,
    read,
    /** The demo: readings are Kimi's recorded ones, of the sample files only. */
    recorded: demo,
    /** The recording of a file with this sha256 (the demo only). */
    recordingOf: recordingFor,
    /** Adds a sample file as an upload (the demo only). */
    attachSample: demo ? attachSample : undefined,
  }
}
