import { Container, Section } from '@/components/site/chrome/section'
import { principles } from '@/components/site/content/landing-content'

export function ProductPrinciples() {
  return (
    <Section
      id="principles"
      aria-labelledby="principles-heading"
      className="grain bg-background text-foreground"
    >
      <Container className="flex flex-col gap-14 lg:gap-20">
        <div className="grid gap-8 border-t border-border pt-8 lg:grid-cols-12 lg:gap-10">
          <h2
            id="principles-heading"
            className="font-display text-xl font-medium text-muted-foreground lg:col-span-3"
          >
            {principles.title}
          </h2>
          <p className="font-display text-3xl font-medium text-balance text-foreground wide-set md:text-4xl lg:col-span-9 lg:text-5xl">
            <span className="block">{principles.statement[0]}</span>
            <span className="block">{principles.statement[1]}</span>
          </p>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground lg:col-span-6 lg:col-start-4">
            {principles.body}
          </p>
        </div>

        <ol className="grid gap-4 md:grid-cols-3" aria-label="Product principles">
          {principles.items.map((item, index) => (
            <li key={item.title} className="glass-panel hover-lift flex flex-col gap-5 rounded-2xl p-6">
              <span className="font-sans text-sm text-subtle num">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="font-display text-xl font-medium tracking-tight text-foreground">
                {item.title}
              </h3>
              <p className="text-base leading-relaxed text-pretty text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  )
}
