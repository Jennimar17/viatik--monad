import { HeroSection } from '@/components/site/hero/hero-section'
import { IsoDefs } from '@/components/site/illustrations/iso'
import { ControlsSection } from '@/components/site/sections/controls-section'
import { FaqSection } from '@/components/site/sections/faq-section'
import { FinalCta } from '@/components/site/sections/final-cta'
import { HowItWorksSection } from '@/components/site/sections/how-it-works-section'
import { MonadSection } from '@/components/site/sections/monad-section'
import { RolePillarsSection } from '@/components/site/sections/role-pillars'
import { UseCasesSection } from '@/components/site/sections/use-cases-section'
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
        <IsoDefs />
        <HeroSection />
        <HowItWorksSection />
        <RolePillarsSection />
        <UseCasesSection />
        <ControlsSection />
        <MonadSection />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
      <MotionEnhancements />
    </>
  )
}
