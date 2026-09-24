import { Container, Section } from '@/components/site/chrome/section'
import { trustStatement } from '@/components/site/content/landing-content'
import { ProductShowcase } from '@/components/site/sections/product-showcase'

export function TrustStatement() {
  return (
    <Section aria-labelledby="trust-heading" className="theme-light">
      <Container>
        <div className="grid items-start gap-8 lg:grid-cols-12">
          <h2
            id="trust-heading"
            className="font-display text-3xl leading-[1.14] font-medium tracking-[-0.035em] text-balance text-foreground md:text-4xl lg:col-span-7"
          >
            <span className="block">{trustStatement.headline[0]}</span>
            <span className="block text-muted-foreground">{trustStatement.headline[1]}</span>
          </h2>
          <p className="max-w-md text-lg text-pretty text-muted-foreground lg:col-span-4 lg:col-start-9 lg:self-end">
            {trustStatement.body}
          </p>
        </div>
        <div className="pt-12 md:pt-16">
          <ProductShowcase />
        </div>
      </Container>
    </Section>
  )
}
