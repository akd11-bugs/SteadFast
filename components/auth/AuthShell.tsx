import Link from 'next/link'
import { HeroCanvas } from '@/components/marketing/HeroCanvas'
import { OrgLogo } from '@/components/branding/OrgLogo'
import { BRAND_NAME } from '@/lib/branding'

// Split-screen shell for /login and /signup: form on the left, animated brand
// panel on the right. The panel reuses the landing page's WebGL backdrop
// rather than pulling in a shader library — it already handles reduced
// motion, offscreen pausing, and falling back to the CSS gradient beneath it
// when WebGL is unavailable.
//
// The panel is decorative and hidden below lg, so a phone gets the form at
// full width instead of a cropped gradient above it.
//
// Both pages build their form only from the pieces in ./AuthControls (button,
// field, notice, disclosure), so they can't drift apart in shape, color or
// spacing again.
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  quote,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  footer?: React.ReactNode
  quote?: { line: string; attribution: string }
}) {
  // grid-cols-1 at the base breakpoint: without an explicit column definition
  // the implicit column is content-sized, so a wide child can overflow the
  // viewport on phones. min-w-0 on the column stops the same thing happening
  // from the flex side.
  return (
    <div className="grid min-h-screen grid-cols-1 bg-[#07080c] text-white lg:grid-cols-2">
      <div className="flex min-w-0 flex-col px-6 py-8 sm:px-10">
        <Link href="/" className="inline-flex w-fit items-center gap-2.5 font-semibold tracking-tight">
          <OrgLogo org={{ name: BRAND_NAME }} size={24} vendorFallback />
          {BRAND_NAME}
        </Link>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-white/55">{subtitle}</p>
            <div className="mt-7 space-y-4">{children}</div>
            {footer && (
              <div className="mt-8 border-t border-white/[0.07] pt-6 text-center text-sm text-white/55">{footer}</div>
            )}
          </div>
        </div>
      </div>

      <div className="relative isolate hidden overflow-hidden border-l border-white/[0.07] lg:block">
        <HeroCanvas />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(80%_80%_at_70%_20%,#16224d_0%,#0a0c14_55%,#07080c_100%)]"
        />
        {quote && (
          <div className="absolute inset-x-0 bottom-0 p-10 pb-16">
            <blockquote className="max-w-md text-lg leading-relaxed text-white/85">“{quote.line}”</blockquote>
            <div className="mt-3 text-sm text-white/45">{quote.attribution}</div>
          </div>
        )}
      </div>
    </div>
  )
}
