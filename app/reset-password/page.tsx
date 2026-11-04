import { AuthShell } from '@/components/auth/AuthShell'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import { BRAND_NAME } from '@/lib/branding'

// Public (see lib/publicRoutes.ts) — the emailed link from
// app/api/settings/set-password lands here, and the visitor isn't
// necessarily mid-session when they click it (e.g. a different browser/
// device than the one they're signed in on).
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  return (
    <AuthShell title="Set your password" subtitle={`Choose a password for your ${BRAND_NAME} account.`}>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-sm text-rose-300">
          This link is missing its token — open the password-reset email again, or request a new one from Settings.
        </p>
      )}
    </AuthShell>
  )
}
