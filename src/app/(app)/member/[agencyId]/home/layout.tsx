import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Home' }

export default function SectionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
