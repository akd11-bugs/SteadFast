import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { engineEnabled, findObjectType, listFields } from '@/lib/records/scope'
import { toFieldDTO } from '@/lib/records/client'
import { RecordsTable } from '@/components/records/RecordsTable'

export const dynamic = 'force-dynamic'

export default async function ObjectRecordsPage({ params }: { params: Promise<{ objectKey: string }> }) {
  const user = await requireUser()
  if (!(await engineEnabled(user))) notFound()
  const { objectKey } = await params
  const object = await findObjectType(user, objectKey)
  if (!object) notFound()

  const [fields, people] = await Promise.all([
    listFields(object.id, object.orgId),
    // All org users, deactivated too, so stored people still show by name; inputs offer only active ones.
    prisma.user.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
  ])

  return (
    <div className="space-y-4">
      <div>
        <Link href="/records" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Records
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{object.name}</h1>
      </div>
      <RecordsTable
        object={{ id: object.id, key: object.key, name: object.name, icon: object.icon, position: object.position, restrictToOwner: object.restrictToOwner }}
        fields={fields.map(toFieldDTO)}
        people={people}
      />
    </div>
  )
}
