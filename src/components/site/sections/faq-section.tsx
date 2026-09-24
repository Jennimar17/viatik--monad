import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Container, Eyebrow, Section, SectionHeading } from '@/components/site/chrome/section'
import { faq } from '@/components/site/content/landing-content'

export function FaqSection() {
  return (
    <Section id="faq" aria-labelledby="faq-heading" className="theme-light">
      <Container className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="flex flex-col gap-5 lg:sticky lg:top-28 lg:col-span-4 lg:self-start">
          <Eyebrow>FAQ</Eyebrow>
          <SectionHeading id="faq-heading">{faq.heading}</SectionHeading>
        </div>

        <Accordion className="border-t border-border lg:col-span-8">
          {faq.items.map((item, index) => (
            <AccordionItem key={item.question} value={`faq-${index}`} className="border-b border-border">
              <AccordionTrigger className="min-h-14 items-center gap-6 rounded-none py-4 font-sans text-base font-medium text-foreground hover:text-violet hover:no-underline **:data-[slot=accordion-trigger-icon]:size-5 md:text-lg">
                <span className="text-pretty">{item.question}</span>
              </AccordionTrigger>
              <AccordionContent className="max-w-2xl pb-6 text-base leading-relaxed text-pretty text-muted-foreground">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Container>
    </Section>
  )
}
