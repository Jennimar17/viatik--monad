import { ExternalLinkIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DemoNote,
  KeyValueList,
  PreviewHeader,
  PreviewPanel,
  StatusChip,
} from '@/components/site/previews/primitives'
import { monad } from '@/components/site/content/landing-content'
import { verifiedDetailsDemo } from '@/components/site/content/demo-data'
import { siteConfig } from '@/components/site/content/site'

/**
 * The one place network terminology appears: a secondary drawer a user can
 * open on any important action. Identifiers are obviously fictional.
 */
export function VerifiedDetailsPreview() {
  const d = verifiedDetailsDemo
  const explorer = siteConfig.explorerUrl

  return (
    <div className="flex flex-col gap-3">
      <PreviewPanel className="p-4 sm:p-5">
        <PreviewHeader label="Verified details" title={d.operation} meta={<StatusChip status={d.status} />} />

        <KeyValueList
          className="mt-4"
          items={[
            { label: 'Status', value: d.status.label },
            { label: 'Network', value: d.network },
            { label: 'Operation', value: d.operation },
            {
              label: 'Amount',
              value: (
                <>
                  {d.amount} <span className="text-subtle">{d.asset}</span>
                </>
              ),
            },
            { label: 'Timestamp', value: d.timestamp },
            { label: 'Transaction', value: <code className="font-mono text-xs">{d.transaction}</code> },
            { label: 'Receipt hash', value: <code className="font-mono text-xs">{d.receiptHash}</code> },
          ]}
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p id="verified-demo-note" className="text-xs text-subtle">
            {monad.note}
          </p>
          {explorer ? (
            <Button
              variant="outline"
              size="pill-sm"
              nativeButton={false}
              render={<a href={explorer} target="_blank" rel="noopener noreferrer" />}
            >
              View in explorer
              <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
          ) : (
            <Button variant="outline" size="pill-sm" disabled aria-describedby="verified-demo-note">
              View in explorer
              <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
          )}
        </div>
      </PreviewPanel>
      <DemoNote />
    </div>
  )
}
