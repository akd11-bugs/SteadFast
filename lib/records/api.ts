import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { requireApiUser, isAdmin, isOperations, type SessionUser } from '@/lib/session'
import { engineEnabled } from './scope'

// Shared preamble for every /api/objects, /api/fields and /api/records route:
// signed in, and the org has the engine switched on. A disabled org gets 404
// so the routes don't advertise themselves before the org is migrated.
export async function engineUser(): Promise<SessionUser | NextResponse> {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!(await engineEnabled(user))) return notFound()
  return user
}

export const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
export const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })
export const badRequest = (error: string, details?: string[]) =>
  NextResponse.json(details ? { error, details } : { error }, { status: 400 })

export const isPrivileged = (user: SessionUser) => isAdmin(user) || isOperations(user)

// 4 chars for makeKey(); crypto, not Math.random, per the contract.
export const randomSuffix = () => crypto.randomBytes(4).toString('hex').slice(0, 4)

export function toRecord(r: {
  id: string
  values: unknown
  ownerId: string | null
  createdById: string
  createdAt: Date
  updatedAt: Date
}) {
  return { id: r.id, values: r.values, ownerId: r.ownerId, createdById: r.createdById, createdAt: r.createdAt, updatedAt: r.updatedAt }
}

export function fieldOut(f: { id: string; key: string; label: string; type: string; config: unknown; required: boolean; position: number }) {
  return { id: f.id, key: f.key, label: f.label, type: f.type, config: f.config, required: f.required, position: f.position }
}
