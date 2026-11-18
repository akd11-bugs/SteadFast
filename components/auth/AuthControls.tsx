import { GoogleLogo } from '@/components/marketing/GoogleLogo'
import { cn } from '@/lib/utils'

// Shared form pieces for the dark auth pages (/login, /signup). Kept apart
// from AuthShell so the client-side SignupEmailForm can use them without
// importing the shell's canvas and branding modules.
const buttonBase =
  'inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-full px-5 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50'

// Same white pill + Google mark as the landing page's "Start free" button,
// so the hand-off from the home page into sign-in looks continuous.
export function AuthGoogleButton({ action, label }: { action: () => Promise<void>; label: string }) {
  return (
    <form action={action}>
      <button
        type="submit"
        className={cn(buttonBase, 'bg-white text-[#07080c] hover:scale-[1.01] active:scale-[0.99]')}
      >
        <GoogleLogo className="h-4 w-4" />
        {label}
      </button>
    </form>
  )
}

export function AuthSecondaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(buttonBase, 'border border-white/15 text-white/90 hover:bg-white/[0.06] hover:text-white', props.className)}
    >
      {children}
    </button>
  )
}

export function AuthField({
  id,
  label,
  ...inputProps
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-white/70">
        {label}
      </label>
      <input
        id={id}
        {...inputProps}
        className="flex h-11 w-full rounded-md border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/30 focus-visible:border-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
      />
    </div>
  )
}

export function AuthNotice({ tone, children }: { tone: 'success' | 'error' | 'info'; children: React.ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'success' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
        tone === 'error' && 'border-rose-500/25 bg-rose-500/10 text-rose-300',
        tone === 'info' && 'border-white/10 bg-white/[0.03] text-white/60',
      )}
    >
      {children}
    </p>
  )
}

// The "or use X instead" disclosure under the Google button. A native
// <details>, so it needs no client JS.
export function AuthAlternative({
  summary,
  open,
  children,
}: {
  summary: string
  open?: boolean
  children: React.ReactNode
}) {
  return (
    <details className="group" open={open}>
      <summary className="cursor-pointer list-none text-center text-sm text-white/45 underline underline-offset-4 hover:text-white/70 [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  )
}
