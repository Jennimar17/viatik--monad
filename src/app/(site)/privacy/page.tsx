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
      updated="October 8, 2026"
      intro="Viatik is programmable funding software. This page explains what we collect and why, in plain language."
      sections={[
        {
          heading: 'What we collect',
          body: (
            <>
              <p>
                When you sign in we receive the email or Google account you use, and we create your Viatik
                account. Inside the product you may add your name, your organization or portfolio name, the
                details of agreements, budgets and payments you create, and the wallet addresses you save to
                withdraw to.
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
              We use your details to run your account and your workspace, and to contact you about Viatik. We
              do not sell them or share them for advertising.
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
              You can ask us to remove your account details and saved addresses at any time. Records already
              written to Monad cannot be erased, but they do not contain your private documents.
            </p>
          ),
        },
      ]}
    />
  )
}
