/** Stable ids for the fictional demo organizations and people. */
export const DEMO = {
  portfolio: 'pf_northstar',
  vaults: {
    portfolio: 'vault_portfolio',
    arcFunding: 'vault_fund_arc',
    lumenFunding: 'vault_fund_lumen',
    fieldworkFunding: 'vault_fund_fieldwork',
    yield: 'vault_yield',
  },
  agencies: {
    arc: 'ag_arc',
    lumen: 'ag_lumen',
    fieldwork: 'ag_fieldwork',
  },
  users: {
    elena: 'u_elena',
    marcus: 'u_marcus',
    maya: 'u_maya',
    jordan: 'u_jordan',
    alex: 'u_alex',
    priya: 'u_priya',
    daniel: 'u_daniel',
    sofia: 'u_sofia',
    ren: 'u_ren',
    noah: 'u_noah',
    lina: 'u_lina',
    ines: 'u_ines',
  },
  agreements: {
    arc: 'fa_arc',
    lumen: 'fa_lumen',
    fieldwork: 'fa_fieldwork',
  },
  tranches: {
    arc1: 'tr_arc_1',
    arc2: 'tr_arc_2',
    arc3: 'tr_arc_3',
    arc4: 'tr_arc_4',
    lumen1: 'tr_lumen_1',
    lumen2: 'tr_lumen_2',
    lumen3: 'tr_lumen_3',
    lumen4: 'tr_lumen_4',
    fieldwork1: 'tr_fieldwork_1',
    fieldwork2: 'tr_fieldwork_2',
  },
  milestones: {
    arc1: 'ms_arc_discovery',
    arc2: 'ms_arc_prototype',
    arc3: 'ms_arc_beta',
    arc4: 'ms_arc_launch',
    fieldwork1: 'ms_fieldwork_pilot',
    fieldwork2: 'ms_fieldwork_report',
  },
  accounts: {
    arcOperations: 'acct_arc_operations',
    arcPeople: 'acct_arc_people',
    arcVendors: 'acct_arc_vendors',
    arcTaxes: 'acct_arc_taxes',
    arcReserve: 'acct_arc_reserve',
    arcProject: 'acct_arc_project',
    lumenOperations: 'acct_lumen_operations',
    lumenPeople: 'acct_lumen_people',
    lumenVendors: 'acct_lumen_vendors',
  },
  budgets: {
    arcTeam: 'bud_arc_team',
    arcTools: 'bud_arc_tools',
    arcResearch: 'bud_arc_research',
    arcTravel: 'bud_arc_travel',
    lumenPayroll: 'bud_lumen_payroll',
    lumenInfra: 'bud_lumen_infra',
    lumenSecurity: 'bud_lumen_security',
  },
  destinations: {
    vertex: 'dest_vertex_cloud',
    canvasly: 'dest_canvasly',
    tasklane: 'dest_tasklane',
    pagecraft: 'dest_pagecraft',
    pulse: 'dest_pulse_data',
    northwind: 'dest_northwind_travel',
    atlas: 'dest_atlas_legal',
    harbor: 'dest_harbor_contractors',
    stratus: 'dest_stratus_hosting',
    codepath: 'dest_codepath',
    sentinel: 'dest_sentinel_audits',
  },
  agent: 'agent_research_assistant',
} as const

export type DemoPersonaKey = 'investor' | 'admin' | 'member'

/** The three people a judge can switch between in demo mode. */
export const DEMO_PERSONAS: {
  key: DemoPersonaKey
  userId: string
  name: string
  role: 'investor' | 'agency_admin' | 'member'
  organization: string
  href: string
}[] = [
  {
    key: 'investor',
    userId: DEMO.users.elena,
    name: 'Elena Duarte',
    role: 'investor',
    organization: 'Northstar Capital',
    href: `/investor/${DEMO.portfolio}/overview`,
  },
  {
    key: 'admin',
    userId: DEMO.users.maya,
    name: 'Maya Chen',
    role: 'agency_admin',
    organization: 'Arc Studio',
    href: `/agency/${DEMO.agencies.arc}/overview`,
  },
  {
    key: 'member',
    userId: DEMO.users.alex,
    name: 'Alex Morgan',
    role: 'member',
    organization: 'Arc Studio',
    href: `/member/${DEMO.agencies.arc}/home`,
  },
]
