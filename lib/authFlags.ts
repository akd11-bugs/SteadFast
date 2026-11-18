// Email sign-up is switched off for now. It works by mailing a magic link,
// and that can't be delivered yet: the global mailbox sends over raw SMTP,
// which the Render host blocks. Turning it off hides the "Use email instead"
// link on /signup and refuses POST /api/signup/request, so no signup token
// is ever created for a link that can't be sent.
//
// Password *sign-in* is deliberately not covered: it sends no email, and
// invite redeemers and admin-created users have only a password.
//
// Flip this back to true once outbound email works.
export const EMAIL_AUTH_ENABLED = false
