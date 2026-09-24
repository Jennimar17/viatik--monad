import { RoleGate } from '@/components/app/shell/role-gate'

export default function AgencyAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RoleGate role="agency_admin">{children}</RoleGate>
}
