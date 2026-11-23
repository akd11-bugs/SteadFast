import { prisma } from '@/lib/db'
import { isAdmin, isOperations, type SessionUser } from '@/lib/session'
import { readConfig, type FieldDef, type Value } from './fieldTypes'

// The record engine's tenant boundary — its leadScope(). Every ObjectRecord
// query spreads this (docs/specs/record-engine.md, security invariant 1).
// orgId always comes from the session; restrictToOwner mirrors today's rule
// that sales see only their own leads, while admin/operations see all.
export function recordScope(user: SessionUser, objectType: { id: string; restrictToOwner: boolean }) {
  const ownerOnly = objectType.restrictToOwner && !isAdmin(user) && !isOperations(user)
  return {
    orgId: { in: user.visibleOrgIds },
    objectTypeId: objectType.id,
    ...(ownerOnly ? { ownerId: user.id } : {}),
  }
}

// Schema edits (objects, fields) are admin-only until teams land (build step 3).
export function canEditSchema(user: SessionUser): boolean {
  return isAdmin(user)
}

export async function engineEnabled(user: SessionUser): Promise<boolean> {
  const org = await prisma.organization.findFirst({
    where: { id: user.orgId },
    select: { recordEngineEnabled: true },
  })
  return !!org?.recordEngineEnabled
}

// Resolves a client-supplied object id or key inside the user's org.
// findFirst + orgId, never findUnique by id (CLAUDE.md, multi-tenancy).
export function findObjectType(user: SessionUser, idOrKey: string) {
  return prisma.objectType.findFirst({
    where: { orgId: { in: user.visibleOrgIds }, OR: [{ id: idOrKey }, { key: idOrKey }] },
  })
}

export function listFields(objectTypeId: string, orgId: string) {
  return prisma.objectField.findMany({ where: { objectTypeId, orgId }, orderBy: { position: 'asc' } })
}

// person and link values are ids the client chose; each must point inside
// the same org (invariant 5). A link target must also be visible to this
// user, so a link can't be used to probe which record ids exist.
export async function checkReferences(
  user: SessionUser,
  fields: FieldDef[],
  values: { [key: string]: Value },
): Promise<string[]> {
  const errors: string[] = []
  for (const f of fields) {
    const v = values[f.key]
    if (v === undefined || v === null) continue
    if (f.type === 'person') {
      const n = await prisma.user.count({ where: { id: String(v), orgId: user.orgId, isActive: true } })
      if (n === 0) errors.push(`${f.label}: no such person`)
    } else if (f.type === 'link') {
      const ids = v as string[]
      const target = await prisma.objectType.findFirst({
        where: { id: readConfig(f.config).targetObjectTypeId ?? '', orgId: user.orgId },
      })
      if (!target) {
        errors.push(`${f.label}: linked object no longer exists`)
        continue
      }
      const n = await prisma.objectRecord.count({ where: { id: { in: ids }, ...recordScope(user, target) } })
      if (n !== ids.length) errors.push(`${f.label}: a linked record was not found`)
    }
  }
  return errors
}
