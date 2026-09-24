import { redirect } from 'next/navigation'

export default async function AgencyAdminIndex({ params }: { params: Promise<{ agencyId: string }> }) {
  const { agencyId } = await params
  redirect(`/agency/${agencyId}/overview`)
}
