import { RoleGate } from '@/components/app/shell/role-gate'

export default function MemberLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RoleGate role="member">{children}</RoleGate>
}
