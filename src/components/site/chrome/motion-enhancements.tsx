'use client'

import { useEffect } from 'react'

export function MotionEnhancements() {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (preference.matches || !('IntersectionObserver' in window)) return

    const elements = document.querySelectorAll<HTMLElement>('[data-reveal]')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(({ isIntersecting, target }) => {
          if (!isIntersecting) return
          target.classList.remove('reveal-pending')
          observer.unobserve(target)
        })
      },
      { threshold: 0.08, rootMargin: '0px 0px -24px 0px' },
    )

    elements.forEach((element) => {
      if (element.getBoundingClientRect().top < window.innerHeight) return
      element.classList.add('reveal-pending')
      observer.observe(element)
    })

    const stopMotion = () => {
      if (!preference.matches) return
      observer.disconnect()
      elements.forEach((element) => element.classList.remove('reveal-pending'))
    }
    preference.addEventListener('change', stopMotion)

    return () => {
      observer.disconnect()
      elements.forEach((element) => element.classList.remove('reveal-pending'))
      preference.removeEventListener('change', stopMotion)
    }
  }, [])

  return null
}
