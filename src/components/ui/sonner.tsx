'use client'

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// Viatik is always dark, so the toaster uses a fixed theme (no next-themes) and the glass overlay surface.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-danger" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'color-mix(in srgb, var(--brand-plum) 82%, transparent)',
          '--normal-text': 'var(--v-text)',
          '--normal-border': 'color-mix(in srgb, var(--brand-mist) 16%, transparent)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'glass-overlay',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
