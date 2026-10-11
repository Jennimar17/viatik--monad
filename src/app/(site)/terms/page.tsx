import type { Metadata } from 'next'

import { LegalPage } from '@/components/site/chrome/legal-page'

export const metadata: Metadata = {
  title: 'Terms',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      updated="October 8, 2026"
      intro="Viatik is an early product. By using the site, the demo or your account you accept these terms."
      sections={[
        {
          heading: 'An early product',
          body: (
            <p>
              Viatik is provided as is. Features, availability and these terms may change as the product
              develops, including when it moves from testnet to mainnet.
            </p>
          ),
        },
        {
          heading: 'Demo and test funds',
          body: (
            <p>
              The demo uses fictional data and, where it touches the network, test funds on the Monad testnet.
              Nothing shown in the demo or on testnet represents real money or a real organization.
            </p>
          ),
        },
        {
          heading: 'Not financial advice',
          body: (
            <p>
              Viatik is software for coordinating funding, budgets and payments. It is not a bank, does not
              give financial advice and does not promise any return on funds.
            </p>
          ),
        },
        {
          heading: 'Your responsibilities',
          body: (
            <p>
              Keep your sign-in methods secure and only use Viatik for lawful purposes. You are responsible
              for the agreements, budgets and payments you create.
            </p>
          ),
        },
      ]}
    />
  )
}
