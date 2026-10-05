import { HeroSection } from '@/components/site/hero/hero-section'
import { IsoDefs } from '@/components/site/illustrations/iso'
import { ControlsSection } from '@/components/site/sections/controls-section'
import { FaqSection } from '@/components/site/sections/faq-section'
import { HowItWorksSection } from '@/components/site/sections/how-it-works-section'
import { MonadSection } from '@/components/site/sections/monad-section'
import { RoleStackSection } from '@/components/site/sections/role-stack'
import { ShowcaseSection } from '@/components/site/sections/showcase-section'
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
        <ShowcaseSection />
        <HowItWorksSection />
        <RoleStackSection />
        <UseCasesSection />
        <ControlsSection />
        <MonadSection />
        <FaqSection />
      </main>
      <SiteFooter />
      <MotionEnhancements />
    </>
  )
}
