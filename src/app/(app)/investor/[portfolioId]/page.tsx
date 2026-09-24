import { redirect } from 'next/navigation'

export default async function InvestorIndex({ params }: { params: Promise<{ portfolioId: string }> }) {
  const { portfolioId } = await params
  redirect(`/investor/${portfolioId}/overview`)
}
