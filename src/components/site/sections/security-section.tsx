import { Container, Section, SectionIntro } from '@/components/site/chrome/section'
import { security } from '@/components/site/content/landing-content'

export function SecuritySection() {
  const left = security.controls.filter((_, i) => i % 2 === 0)
  const right = security.controls.filter((_, i) => i % 2 === 1)

  return (
    <Section id="security" aria-labelledby="security-heading" className="theme-light">
      <Container className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <SectionIntro
          eyebrow={security.eyebrow}
          heading={<span id="security-heading">{security.heading}</span>}
          body={security.body}
          className="lg:sticky lg:top-28 lg:col-span-5 lg:self-start"
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
          <ControlColumn controls={left} />
          <ControlColumn controls={right} />
        </div>
      </Container>
    </Section>
  )
}

function ControlColumn({ controls }: { controls: { title: string; body: string }[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {controls.map((control) => (
        <li
          key={control.title}
          className="preview-panel hover-lift flex flex-1 flex-col gap-3 rounded-2xl border border-border p-6"
        >
          <h3 className="font-display text-xl font-medium text-foreground">{control.title}</h3>
          <p className="text-base text-pretty text-muted-foreground">{control.body}</p>
        </li>
      ))}
    </ul>
  )
}
