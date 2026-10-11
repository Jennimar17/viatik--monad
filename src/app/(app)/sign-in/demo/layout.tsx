import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Explore the demo' }

export default function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
