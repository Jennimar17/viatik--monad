import { redirect } from 'next/navigation'

export default async function MemberIndex({ params }: { params: Promise<{ agencyId: string }> }) {
  const { agencyId } = await params
  redirect(`/member/${agencyId}/overview`)
}
