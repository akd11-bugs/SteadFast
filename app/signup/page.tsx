import { redirect } from 'next/navigation'
import Link from 'next/link'
import { neonAuth } from '@/lib/auth'
import { resolveSession } from '@/lib/session'
import { SignupEmailForm } from '@/components/auth/SignupEmailForm'
import { AuthShell } from '@/components/auth/AuthShell'
import { AuthAlternative, AuthGoogleButton, AuthNotice } from '@/components/auth/AuthControls'
import { EMAIL_AUTH_ENABLED } from '@/lib/authFlags'
import { BRAND_NAME } from '@/lib/branding'

// Google-first, mirroring app/login/page.tsx — Google sign-in already proves
// email ownership, so a brand-new identity lands on /account-not-found which
// handles org creation / join-request directly. The email+password path
// below is the de-emphasized fallback (currently switched off, see
// lib/authFlags.ts), gated behind its own SignupToken link-verification
// step since typing an email proves nothing.
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  const googleEnabled = !!process.env.GOOGLE_CLIENT_ID

  const resolution = await resolveSession()
  if (resolution.kind === 'ok') redirect('/')
  if (resolution.kind === 'inactive') redirect('/account-disabled')
  if (resolution.kind === 'no-app-user') redirect('/account-not-found')

  async function signUpWithGoogle() {
    'use server'
    const { data, error: signInError } = await neonAuth.signIn.social({
      provider: 'google',
      callbackURL: '/',
    })
    if (signInError || !data?.url) {
      redirect('/signup?error=1')
    }
    redirect(data.url)
  }

  return (
    <AuthShell
      title={`Join ${BRAND_NAME}`}
      subtitle="Create your account to get started."
      quote={{
        line: 'No credit card. No new password — Google already proved it’s you.',
        attribution: 'Set up your workspace in under a minute',
      }}
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-white underline underline-offset-4">
            Log in
          </Link>
        </>
      }
    >
      {error && <AuthNotice tone="error">Google sign-up didn’t go through — please try again.</AuthNotice>}

      {googleEnabled && <AuthGoogleButton action={signUpWithGoogle} label="Sign up with Google" />}

      {/* Email sign-up mails a magic link, which can't be delivered yet —
          see lib/authFlags.ts. */}
      {EMAIL_AUTH_ENABLED ? (
        googleEnabled ? (
          <AuthAlternative summary="Use email instead">
            <SignupEmailForm />
          </AuthAlternative>
        ) : (
          <SignupEmailForm />
        )
      ) : (
        // Without email sign-up, someone with no Google account needs a next step.
        <AuthNotice tone="info">
          {googleEnabled ? 'No Google account? ' : 'Sign-up isn’t available right now. '}
          Ask your workspace admin for an invite link.
        </AuthNotice>
      )}
    </AuthShell>
  )
}
