import { FundingAgreementPreview } from '@/components/site/previews/funding-agreement-preview'
import { Container, Section, SectionIntro } from '@/components/site/chrome/section'
import { fundingAgreements } from '@/components/site/content/landing-content'

export function FundingAgreementSection() {
  return (
    <Section id="for-investors" aria-labelledby="agreements-heading" className="theme-light">
      <Container className="grid gap-12 lg:grid-cols-12 lg:items-start lg:gap-16">
        <div className="flex flex-col gap-10 lg:sticky lg:top-28 lg:col-span-5">
          <SectionIntro
            eyebrow={fundingAgreements.eyebrow}
            heading={<span id="agreements-heading">{fundingAgreements.heading}</span>}
            body={fundingAgreements.body}
          />
          <PointList points={fundingAgreements.points} />
        </div>
        <div className="lg:col-span-7">
          <FundingAgreementPreview />
        </div>
      </Container>
    </Section>
  )
}

export function PointList({ points, className }: { points: string[]; className?: string }) {
  return (
    <ul className={className ?? 'flex flex-col border-t border-border'}>
      {points.map((point) => (
        <li
          key={point}
          className="flex items-start gap-3 border-b border-border py-3.5 text-base text-foreground"
        >
          <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 bg-violet" />
          <span className="text-pretty">{point}</span>
        </li>
      ))}
    </ul>
  )
}
