import { prisma } from '@/lib/db'
import { findOrCreateCompany, findOrCreatePerson } from '@/lib/company'
import { writeBackLeadToSheet } from '@/lib/googleSheetWriteback'
import { mergeCustomFields } from '@/lib/leadCustomFields'
import { resolveIntakeFormFields } from '@/lib/intakeFormFields'

export interface PublicIntakeSubmission {
  company?: unknown
  contactName?: unknown
  email?: unknown
  phone?: unknown
  industry?: unknown
  notes?: unknown
  // Every other field this form is configured to show (custom
  // LeadFieldDefinition keys, or a fixed key the admin added back with a
  // different required flag) — validated against the form's resolved field
  // list, same way the fixed fields above always have been.
  customFields?: unknown
  // Honeypot — a real visitor never sees or fills this field (hidden via
  // CSS on the public form). A non-empty value means a bot filled every
  // input it could find; treated as a silent success so the bot gets no
  // signal its submission was rejected.
  website_url?: unknown
}

export interface PublicIntakeResult {
  ok: true
  silent?: boolean
}

export class PublicIntakeValidationError extends Error {}

// Single-submission intake from an anonymous public form — deliberately NOT
// lib/leadImport.ts's importLeadRows, which is batch/CSV-shaped (silently
// skips bad rows, needs an ImportOwner drawn from a logged-in session).
// Here there is no session and no batch: a bad submission must come back as
// a specific, immediate validation error, and the owner comes from the
// OrgLeadIntakeForm's configured defaultOwnerUserId instead.
export async function submitPublicLeadIntake(
  formId: string,
  formName: string,
  orgId: string,
  defaultOwnerUserId: string,
  defaultSource: string,
  fieldConfigJson: string,
  input: PublicIntakeSubmission,
): Promise<PublicIntakeResult> {
  if (typeof input.website_url === 'string' && input.website_url.trim() !== '') {
    return { ok: true, silent: true }
  }

  const company = String(input.company ?? '').trim()
  const contactName = String(input.contactName ?? '').trim()
  const email = String(input.email ?? '').trim()
  const phone = input.phone ? String(input.phone).trim() : null
  const industry = input.industry ? String(input.industry).trim() : null
  const notes = input.notes ? String(input.notes).trim() : ''

  if (!company) throw new PublicIntakeValidationError('Company name is required.')
  if (!email) throw new PublicIntakeValidationError('Email is required.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicIntakeValidationError('Enter a valid email address.')

  // Validates every OTHER field this specific form is configured to show
  // (a required custom field, or a fixed field an admin marked required
  // beyond company/email) — company/email themselves are always validated
  // above regardless of config, per resolveIntakeFormFields' guarantee.
  const fields = await resolveIntakeFormFields(orgId, fieldConfigJson)
  const customFieldsInput =
    typeof input.customFields === 'object' && input.customFields !== null && !Array.isArray(input.customFields)
      ? (input.customFields as Record<string, unknown>)
      : {}
  const fixedValues: Record<string, unknown> = { company, contactName, email, phone, industry, notes }
  for (const field of fields) {
    if (!field.required) continue
    const value = field.kind === 'fixed' ? fixedValues[field.key] : customFieldsInput[field.key]
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new PublicIntakeValidationError(`"${field.label}" is required.`)
    }
  }

  const owner = await prisma.user.findUnique({ where: { id: defaultOwnerUserId }, select: { id: true, name: true, orgId: true, isActive: true } })
  if (!owner || owner.orgId !== orgId || !owner.isActive) {
    // The form's configured owner was removed/deactivated after the form was
    // set up — a config problem, not something the submitter caused.
    throw new PublicIntakeValidationError('This form is temporarily unavailable. Please try again later.')
  }

  const companyRow = await findOrCreateCompany(orgId, company)
  const person = contactName ? await findOrCreatePerson(orgId, companyRow.id, contactName, { email, phone }) : null

  let customFieldsJson = '{}'
  const customEntries = Object.fromEntries(fields.filter((f) => f.kind === 'custom').map((f) => [f.key, customFieldsInput[f.key]]))
  if (Object.keys(customEntries).length > 0) {
    try {
      customFieldsJson = await mergeCustomFields(orgId, '{}', customEntries)
    } catch (err) {
      throw new PublicIntakeValidationError(err instanceof Error ? err.message : 'Invalid field value.')
    }
  }

  await prisma.$transaction([
    prisma.lead.create({
      data: {
        orgId,
        companyId: companyRow.id,
        personId: person?.id ?? null,
        email,
        phone,
        website: null,
        industry,
        source: defaultSource,
        stage: 'new',
        ownerId: owner.id,
        ownerName: owner.name,
        notes,
        customFieldsJson,
        intakeFormId: formId,
        intakeFormName: formName,
      },
    }),
    prisma.orgLeadIntakeForm.update({ where: { id: formId }, data: { submissionCount: { increment: 1 } } }),
  ])

  await writeBackLeadToSheet(orgId, {
    company,
    contactName: contactName || null,
    email,
    phone,
    website: null,
    industry,
    businessType: null,
    source: defaultSource,
    type: 'merchant',
    estimatedVolume: 0,
    notes,
  })

  return { ok: true }
}
