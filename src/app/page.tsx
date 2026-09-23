import { activeChain } from '@/web3/chains'

// Temporary page: proves the app boots. Replaced by the landing in phase 3.
export default function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-[#22092c] px-4 text-[#ededf3]">
      <img src="/brand/viatik-stacked-light.svg" alt="Viatik" className="h-24 w-auto" />
      <p className="font-[family-name:var(--font-inter)] text-sm text-[#aca1b3]">
        App scaffold running on {activeChain.name} ({activeChain.id}).
      </p>
    </main>
  )
}
