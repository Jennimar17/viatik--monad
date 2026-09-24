import { RoleGate } from '@/components/app/shell/role-gate'

export default function InvestorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RoleGate role="investor">{children}</RoleGate>
}
