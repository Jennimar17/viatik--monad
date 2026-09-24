import type { Metadata } from 'next'

import { LegalPage } from '@/components/site/chrome/legal-page'

export const metadata: Metadata = {
  title: 'Privacy',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="September 23, 2026"
      intro="Viatik is an early product built for the Monad Metropolis hackathon. This page explains what we collect and why, in plain language."
      sections={[
        {
          heading: 'What we collect',
          body: (
            <>
              <p>
                When you join the early-access list we collect your work email, your organization and the role
                that describes you. We do not ask for anything else.
              </p>
              <p>
                The product demo uses fictional people, organizations and amounts. Its state is kept in your
                browser and can be reset at any time.
              </p>
            </>
          ),
        },
        {
          heading: 'How we use it',
          body: (
            <p>
              We use early-access details only to contact you about Viatik. We do not sell them or share them
              for advertising.
            </p>
          ),
        },
        {
          heading: 'Records on Monad',
          body: (
            <p>
              Operations settled through Viatik are recorded on the Monad network, where transactions are
              public by design. Documents such as invoices and milestone evidence stay private: only their
              fingerprints are recorded.
            </p>
          ),
        },
        {
          heading: 'Your choices',
          body: (
            <p>
              You can ask us to remove your early-access details at any time through the early-access form on
              viatik.xyz.
            </p>
          ),
        },
      ]}
    />
  )
}
