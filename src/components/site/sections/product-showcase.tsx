import Image from 'next/image'
import { ArrowUpRightIcon, CheckIcon } from 'lucide-react'

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { SpendingChart } from '@/components/site/previews/capital-chart'
import { ViatikMark } from '@/components/viatik/viatik-logo'

export function ProductShowcase() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      <Card className="photo-card hover-lift h-full">
        <CardHeader>
          <CardTitle>
            <h3>Back the next big thing.</h3>
          </CardTitle>
          <CardDescription>Commit with purpose. Release with confidence.</CardDescription>
        </CardHeader>
        <CardContent className="flex-1">
          <div className="relative isolate flex h-60 items-end overflow-hidden rounded-xl">
            <Image
              src="/images/modern-architecture.jpg"
              alt="Sculptural white architecture opening toward the sky"
              fill
              sizes="(min-width: 1280px) 380px, (min-width: 768px) 30vw, 90vw"
              className="object-cover"
            />
            <div className="relative z-10 w-full p-3">
              <div className="glass-panel theme-light rounded-xl p-4">
                <div className="flex items-center gap-2 text-sm">
                  <ViatikMark tone="dark" className="size-5" />
                  <span>Funding agreement</span>
                </div>
                <p className="pt-2 font-display text-2xl font-medium tracking-tight num">$100,000.00</p>
                <p className="pt-1 text-sm text-muted-foreground">A commitment. A clear set of milestones.</p>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <a
            href="#for-investors"
            className="flex min-h-9 w-full items-center justify-between gap-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Built for investors <ArrowUpRightIcon className="size-4" aria-hidden="true" />
          </a>
        </CardFooter>
      </Card>

      <Card className="theme-dark grain hover-lift h-full">
        <CardHeader>
          <CardTitle>
            <h3>A little more room to build.</h3>
          </CardTitle>
          <CardDescription>One clear view of the work your capital powers.</CardDescription>
        </CardHeader>
        <CardContent className="flex-1">
          <div className="flex h-60 flex-col justify-between">
            <div>
              <p className="text-sm text-muted-foreground">September spending</p>
              <p className="pt-1 font-display text-3xl font-medium tracking-tight num">$11,170.00</p>
            </div>
            <SpendingChart />
          </div>
        </CardContent>
        <CardFooter>
          <a
            href="#for-agencies"
            className="flex min-h-9 w-full items-center justify-between gap-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Made for operators <ArrowUpRightIcon className="size-4" aria-hidden="true" />
          </a>
        </CardFooter>
      </Card>

      <Card className="photo-card hover-lift h-full">
        <CardHeader>
          <CardTitle>
            <h3>Good work, less friction.</h3>
          </CardTitle>
          <CardDescription>Clear budgets. More autonomy for your team.</CardDescription>
        </CardHeader>
        <CardContent className="flex-1">
          <div className="relative isolate flex h-60 items-end overflow-hidden rounded-xl">
            <Image
              src="/images/creative-team.jpg"
              alt="A creative team collaborating around a shared studio table"
              fill
              sizes="(min-width: 1280px) 380px, (min-width: 768px) 30vw, 90vw"
              className="object-cover object-[38%_center]"
            />
            <div className="relative z-10 w-full p-3">
              <div className="glass-panel theme-light flex items-center gap-3 rounded-xl p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sage/45 text-brand">
                  <CheckIcon className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium">You&apos;re good to go.</p>
                  <p className="text-sm text-muted-foreground">Tools &amp; services · Within budget</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <a
            href="#product"
            className="flex min-h-9 w-full items-center justify-between gap-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Designed for teams <ArrowUpRightIcon className="size-4" aria-hidden="true" />
          </a>
        </CardFooter>
      </Card>
    </div>
  )
}
