import { HeroSection } from '@/components/site/hero/hero-section'
import { AgencyOperationsSection } from '@/components/site/sections/agency-operations-section'
import { AutomationSection } from '@/components/site/sections/automation-section'
import { CapitalFlowSection } from '@/components/site/sections/capital-flow-section'
import { FaqSection } from '@/components/site/sections/faq-section'
import { FinalCta } from '@/components/site/sections/final-cta'
import { FundingAgreementSection } from '@/components/site/sections/funding-agreement-section'
import { MonadSection } from '@/components/site/sections/monad-section'
import { ProductPrinciples } from '@/components/site/sections/product-principles'
import { ReconciliationSection } from '@/components/site/sections/reconciliation-section'
import { RoleProductStory } from '@/components/site/sections/role-product-story'
import { SecuritySection } from '@/components/site/sections/security-section'
import { TrustStatement } from '@/components/site/sections/trust-statement'
import { AnnouncementBar } from '@/components/site/chrome/announcement-bar'
import { SiteFooter } from '@/components/site/chrome/site-footer'
import { SiteHeader } from '@/components/site/chrome/site-header'
import { MotionEnhancements } from '@/components/site/chrome/motion-enhancements'

export default function LandingPage() {
  return (
    <>
      <AnnouncementBar />
      <SiteHeader />
      <main id="main">
        <HeroSection />
        <TrustStatement />
        <CapitalFlowSection />
        <RoleProductStory />
        <FundingAgreementSection />
        <AgencyOperationsSection />
        <ReconciliationSection />
        <AutomationSection />
        <MonadSection />
        <SecuritySection />
        <ProductPrinciples />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
      <MotionEnhancements />
    </>
  )
}
