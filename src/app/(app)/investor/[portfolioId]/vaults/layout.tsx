import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Vaults' }

export default function SectionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
