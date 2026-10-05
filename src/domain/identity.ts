import type { Id, ISODate, Invitation, Role, ViatikState } from './types'

/** What the sign-in provider verified about a person. */
export type VerifiedProfile = { name: string | null; email: string | null }

/**
 * The state with a signed-in person present and their verified details
 * applied, or null when nothing changes. Someone new (anyone but the seeded
 * demo people) starts with no memberships: they create a portfolio or accept
 * an invitation. The verified email always wins, so invitations check the
 * address the person proved; a verified name only fills an empty one, so a
 * name typed in Settings or onboarding is kept.
 */
export function withVerifiedPerson(
  state: ViatikState,
  userId: Id,
  profile: VerifiedProfile,
  options: { now: ISODate; timeZone?: string },
): ViatikState | null {
  const known = state.users.find((u) => u.id === userId)
  if (!known) {
    return {
      ...state,
      users: [
        ...state.users,
        {
          id: userId,
          name: profile.name ?? '',
          email: profile.email ?? '',
          title: '',
          timeZone: options.timeZone ?? 'UTC',
          locale: 'en-US',
          createdAt: options.now,
        },
      ],
    }
  }
  const email = profile.email && known.email !== profile.email ? profile.email : known.email
  const name = !known.name.trim() && profile.name ? profile.name : known.name
  if (email === known.email && name === known.name) return null
  return { ...state, users: state.users.map((u) => (u.id === userId ? { ...u, email, name } : u)) }
}

/** What an invitation link may show before anyone signs in. */
export type InvitationPreview = {
  code: string
  name: string
  email: string
  role: Role
  status: Invitation['status']
  workspace: string
  invitedBy: string
}

export function invitationPreview(state: ViatikState, code: string): InvitationPreview | null {
  const invitation = state.invitations.find((i) => i.code === code)
  if (!invitation) return null
  const scope = invitation.scope
  const workspace =
    scope.kind === 'agency'
      ? state.agencies.find((a) => a.id === scope.agencyId)?.name
      : state.portfolios.find((p) => p.id === scope.portfolioId)?.name
  const inviter = state.users.find((u) => u.id === invitation.invitedBy)
  return {
    code: invitation.code,
    name: invitation.name,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    workspace: workspace ?? 'Viatik',
    invitedBy: inviter?.name.trim() || 'Your team',
  }
}
