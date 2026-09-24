import { BudgetPolicyPreview } from '@/components/site/previews/budget-policy-preview'
import { Container, Section, SectionIntro } from '@/components/site/chrome/section'
import { agencyOperations } from '@/components/site/content/landing-content'

export function AgencyOperationsSection() {
  return (
    <Section
      id="for-agencies"
      aria-labelledby="operations-heading"
      className="theme-light border-t border-border"
    >
      <Container className="flex flex-col gap-12 lg:gap-16">
        <div className="grid gap-6 lg:grid-cols-12">
          <SectionIntro
            eyebrow={agencyOperations.eyebrow}
            heading={<span id="operations-heading">{agencyOperations.heading}</span>}
            className="lg:col-span-7 lg:max-w-none"
          />
          <p className="text-lg text-pretty text-muted-foreground lg:col-span-4 lg:col-start-9 lg:self-end">
            {agencyOperations.body}
          </p>
        </div>
        <BudgetPolicyPreview />
      </Container>
    </Section>
  )
}
