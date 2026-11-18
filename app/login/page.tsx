import { redirect } from 'next/navigation'
import Link from 'next/link'
import { neonAuth } from '@/lib/auth'
import { signInWithLockout } from '@/lib/loginLockout'
import { resolveSession } from '@/lib/session'
import { AuthShell } from '@/components/auth/AuthShell'
import { AuthAlternative, AuthField, AuthGoogleButton, AuthNotice, AuthSecondaryButton } from '@/components/auth/AuthControls'
import { BRAND_NAME } from '@/lib/branding'
import { isSafeRedirectTarget } from '@/lib/publicRoutes'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string; reason?: string; redeemed?: string; reset?: string }>
}) {
  const { from, error, reason, redeemed, reset } = await searchParams
  const googleEnabled = !!process.env.GOOGLE_CLIENT_ID
  const redirectTo = isSafeRedirectTarget(from) ? from : '/'

  // Neon Auth middleware (proxy.ts) can't do this check itself — see its
  // comment — so it happens here instead, in a plain Server Component.
  // Uses the full resolution (not just "does a Neon Auth session exist")
  // so a deactivated or unregistered identity lands on its own page
  // instead of bouncing back here from requireUser() on the next request.
  const resolution = await resolveSession()
  if (resolution.kind === 'ok') redirect(redirectTo)
  if (resolution.kind === 'inactive') redirect('/account-disabled')
  if (resolution.kind === 'no-app-user') redirect('/account-not-found')

  async function login(formData: FormData) {
    'use server'
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')
    const result = await signInWithLockout(email, password)
    if (!result.ok) {
      const fromParam = from ? `&from=${encodeURIComponent(from)}` : ''
      const reasonParam = result.status === 423 ? '&reason=locked' : result.status === 429 ? '&reason=rate' : ''
      redirect(`/login?error=1${fromParam}${reasonParam}`)
    }
    redirect(redirectTo)
  }

  async function loginWithGoogle() {
    'use server'
    const { data, error: signInError } = await neonAuth.signIn.social({
      provider: 'google',
      callbackURL: redirectTo,
    })
    if (signInError || !data?.url) {
      console.error('[login] Google sign-in failed', signInError)
      redirect(`/login?error=google${from ? `&from=${encodeURIComponent(from)}` : ''}`)
    }
    redirect(data.url)
  }

  // Password sign-in is always reachable, collapsed under Google. It needs no
  // outbound email, and invite redeemers and admin-created users have only a
  // password: hiding it on a plain /login locked them out once their first
  // session ended. Only email *sign-up* is switched off (lib/authFlags.ts).
  const justSetPassword = !!redeemed || !!reset
  // Only this page's own codes count: 'error' can also arrive from other
  // flows (e.g. a cancelled Google consent forwarded here).
  const passwordFailed = error === '1'
  const googleFailed = error === 'google'
  const passwordForm = (
    <form action={login} className="space-y-3">
      <AuthField id="email" name="email" label="Email" type="email" autoComplete="email" required autoFocus={!googleEnabled} />
      <AuthField id="password" name="password" label="Password" type="password" autoComplete="current-password" required />
      <AuthSecondaryButton type="submit">Sign in</AuthSecondaryButton>
    </form>
  )

  return (
    <AuthShell
      title="Welcome back"
      subtitle={`Sign in to your ${BRAND_NAME} workspace.`}
      quote={{
        line: 'The step between a spreadsheet and a CRM.',
        attribution: BRAND_NAME,
      }}
      footer={
        <>
          New here?{' '}
          <Link href="/signup" className="text-white underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      {justSetPassword && !passwordFailed && (
        <AuthNotice tone="success">
          {reset ? 'Password updated' : 'Account created'} — log in with your new password.
        </AuthNotice>
      )}
      {googleFailed && <AuthNotice tone="error">Google sign-in didn’t go through — please try again.</AuthNotice>}
      {passwordFailed && (
        <AuthNotice tone="error">
          {reason === 'locked'
            ? 'Too many failed attempts — try again in 15 minutes.'
            : reason === 'rate'
              ? 'Too many attempts — try again later.'
              : 'Invalid email or password.'}
        </AuthNotice>
      )}

      {googleEnabled && <AuthGoogleButton action={loginWithGoogle} label="Sign in with Google" />}

      {googleEnabled ? (
        // Opens straight away after a failed attempt or a fresh password,
        // so the error or the form isn't hidden behind a collapsed link.
        <AuthAlternative summary="Use a password instead" open={justSetPassword || passwordFailed}>
          {passwordForm}
        </AuthAlternative>
      ) : (
        passwordForm
      )}
    </AuthShell>
  )
}
