import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Receipt',
}

export default function ReceiptsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
