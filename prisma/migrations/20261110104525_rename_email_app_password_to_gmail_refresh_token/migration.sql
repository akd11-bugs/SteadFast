-- Replaces SMTP-app-password-based personal email sending with Gmail API
-- (OAuth) sending — Render's free tier blocks outbound SMTP entirely.
-- Guarded with a column-existence check rather than a bare RENAME COLUMN:
-- this local dev database's User table does not currently have
-- emailAppPasswordEnc (confirmed absent, despite the column being added by
-- an earlier migration in history — likely dropped by a prior session's
-- experimentation outside the normal migration flow), while production's
-- does. This migration is correct against either starting state: rename
-- the real column if present, otherwise just add the new one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'emailAppPasswordEnc'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "emailAppPasswordEnc" TO "gmailRefreshTokenEnc";
    -- The renamed column still holds old SMTP app passwords, which are not
    -- Gmail refresh tokens. Clear them (and the same "configured" markers
    -- DELETE /api/settings/email clears) so those users see "not connected"
    -- and reconnect, instead of looking connected while every send fails.
    UPDATE "User"
    SET "gmailRefreshTokenEnc" = NULL, "emailFromAddress" = NULL, "emailConfiguredAt" = NULL
    WHERE "gmailRefreshTokenEnc" IS NOT NULL;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'gmailRefreshTokenEnc'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "gmailRefreshTokenEnc" TEXT;
  END IF;
END $$;
