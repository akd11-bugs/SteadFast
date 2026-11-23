import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { engineEnabled, findObjectType, listFields, recordScope } from '@/lib/records/scope'
import type { Value } from '@/lib/records/fieldTypes'
import { recordTitle, toFieldDTO } from '@/lib/records/client'
import { RecordDetail } from '@/components/records/RecordDetail'

export const dynamic = 'force-dynamic'

export default async function RecordDetailPage({ params }: { params: Promise<{ objectKey: string; recordId: string }> }) {
  const user = await requireUser()
  if (!(await engineEnabled(user))) notFound()
  const { objectKey, recordId } = await params
  const object = await findObjectType(user, objectKey)
  if (!object) notFound()
  // findFirst + recordScope: the id is global, only the scope keeps other orgs' (and others' owned) records out.
  const record = await prisma.objectRecord.findFirst({ where: { id: recordId, ...recordScope(user, object) } })
  if (!record) notFound()

  const [fields, people] = await Promise.all([
    listFields(object.id, object.orgId),
    // All org users, deactivated too, so stored people still show by name; inputs offer only active ones.
    prisma.user.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
  ])
  const raw = record.values
  const values = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as { [key: string]: Value }
  const listHref = `/records/${encodeURIComponent(object.key)}`

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href={listHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {object.name}
        </Link>
        <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight">{recordTitle(fields, values, record.id)}</h1>
        <p className="text-xs text-muted-foreground">
          Created {record.createdAt.toLocaleDateString('en-IN')} · Updated {record.updatedAt.toLocaleDateString('en-IN')}
        </p>
      </div>
      <RecordDetail recordId={record.id} listHref={listHref} fields={fields.map(toFieldDTO)} initialValues={values} people={people} />
    </div>
  )
}
