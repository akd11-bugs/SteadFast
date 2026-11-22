'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Loader2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Task } from '@/lib/types'

export function LeadTasksTab({ leadId }: { leadId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [adding, setAdding] = useState(false)

  function load() {
    fetch(`/api/tasks?leadId=${leadId}`)
      .then((r) => r.json())
      .then((data) => setTasks(data.tasks ?? []))
      .finally(() => setLoading(false))
  }

  useEffect(load, [leadId])

  async function addTask() {
    if (!title.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), dueDate: dueDate || null, leadId }),
      })
      if (res.ok) {
        setTitle('')
        setDueDate('')
        load()
      }
    } finally {
      setAdding(false)
    }
  }

  async function toggleDone(task: Task) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)))
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: !task.done }),
    }).catch(() => null)
    // Roll back the optimistic tick if the save didn't land.
    if (!res?.ok) setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="New task for this lead…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTask()}
        />
        <Input type="date" className="w-40" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <Button size="sm" onClick={addTask} disabled={!title.trim() || adding}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks for this lead yet.</p>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={t.done}
                onChange={() => toggleDone(t)}
              />
              <p className={`flex-1 ${t.done ? 'line-through text-muted-foreground' : ''}`}>{t.title}</p>
              {t.dueDate && <span className="text-xs text-muted-foreground shrink-0">{formatDate(t.dueDate)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
