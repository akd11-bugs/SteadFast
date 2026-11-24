// Hybrid skill runner — dispatches between Python scripts and Claude.
// The catalog tells the runner which path to take.

import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import Anthropic from '@anthropic-ai/sdk'
import { getSkill, SKILLS } from './catalog'
import { buildSkillPrompt } from './prompts'
import type { Lead } from '@/lib/types'

// Bundled into the repo at skills-library/ so this works with zero config,
// including on Vercel. SKILL_LIBRARY_PATH can still override it if needed.
const SKILL_LIBRARY_PATH = process.env.SKILL_LIBRARY_PATH || path.join(process.cwd(), 'skills-library')
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

export interface RunSkillInput {
  skillId: string
  scope: 'portfolio' | 'lead' | 'email' | 'sequence' | 'account'
  leadId?: string
  leads: Lead[]
  userQuestion?: string
}

export interface RunSkillResult {
  ok: boolean
  skillId: string
  skillName: string
  runnerType: 'script' | 'llm'
  outputMarkdown: string
  outputStructured?: unknown
  error?: string
  durationMs: number
  cost?: { inputTokens: number; outputTokens: number; estimatedUsd: number }
}

export async function runSkill(input: RunSkillInput): Promise<RunSkillResult> {
  const start = Date.now()
  const skill = getSkill(input.skillId)
  if (!skill) {
    return {
      ok: false,
      skillId: input.skillId,
      skillName: input.skillId,
      runnerType: 'llm',
      outputMarkdown: '',
      error: `Unknown skill id: ${input.skillId}`,
      durationMs: Date.now() - start,
    }
  }

  try {
    if (skill.runnerType === 'script') {
      return await runScriptSkill(skill.id, skill.name, input, start)
    }
    return await runLlmSkill(skill, input, start)
  } catch (err) {
    return {
      ok: false,
      skillId: skill.id,
      skillName: skill.name,
      runnerType: skill.runnerType,
      outputMarkdown: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

async function loadSkillText(skillId: string): Promise<string> {
  const file = path.join(SKILL_LIBRARY_PATH, skillId, 'SKILL.md')
  try {
    return await fs.readFile(file, 'utf-8')
  } catch {
    throw new Error(
      `Could not read ${file}. Expected the skill library at ${SKILL_LIBRARY_PATH} — set SKILL_LIBRARY_PATH to override.`
    )
  }
}

// ============ Script-backed (Python) ============

async function runScriptSkill(
  skillId: string,
  skillName: string,
  input: RunSkillInput,
  start: number,
): Promise<RunSkillResult> {
  if (skillId === 'pipeline-hygiene-audit') {
    return await runPipelineHygiene(skillId, skillName, input, start)
  }

  if (skillId === 'spam-folder-check') {
    // spam-folder-check takes email auth records from the user, not CRM data.
    // For LMS purposes we run it on the lead's email domain as a heuristic —
    // and require the user to paste records in the skill UI for a full check.
    return await runSpamFolderCheck(skillId, skillName, input, start)
  }

  throw new Error(`No script mapping for ${skillId}`)
}

async function runPipelineHygiene(
  skillId: string,
  skillName: string,
  input: RunSkillInput,
  start: number,
): Promise<RunSkillResult> {
  // Export open leads to CSV and shell out to the Python script. Uses
  // fs.mkdtemp (unpredictable path, not a guessable Date.now() name) and a
  // try/finally so the directory is always removed, even if the first
  // runPython call below throws — previously that throw propagated past the
  // cleanup call, orphaning a cleartext copy of the org's pipeline data.
  const openLeads = input.leads.filter((l) => l.stage !== 'onboarding' && l.stage !== 'not_interested')
  const csv = leadsToCsv(openLeads)
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lrm_pipeline_'))
  const tmpCsv = path.join(tmpDir, 'pipeline.csv')
  await fs.writeFile(tmpCsv, csv, 'utf-8')

  try {
    const scriptPath = path.join(SKILL_LIBRARY_PATH, 'scripts', 'pipeline_hygiene.py')
    const args = [scriptPath, tmpCsv, '--json']

    const json = await runPython(args)

    // Try to also get the human-readable text version
    let text: string = ''
    try {
      const out = await runPython([scriptPath, tmpCsv])
      if (typeof out === 'string') text = out
    } catch {
      // ignore — we have JSON
    }

    // Convert JSON to a presentable markdown report
    const md = jsonToMarkdown(json, text)

    return {
      ok: true,
      skillId,
      skillName,
      runnerType: 'script',
      outputMarkdown: md,
      outputStructured: typeof json === 'object' ? json : undefined,
      durationMs: Date.now() - start,
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function runSpamFolderCheck(
  skillId: string,
  skillName: string,
  input: RunSkillInput,
  start: number,
): Promise<RunSkillResult> {
  // The spam-folder-check needs SPF/DKIM/DMARC strings — we cannot fetch DNS from the LMS
  // without complicating the architecture. So we render a guided checklist instead.
  const leadEmails = Array.from(new Set(input.leads.map((l) => l.email.split('@')[1]).filter(Boolean)))

  const md = `# Spam Folder Check — guided checklist

This skill needs your email-sending domain's DNS records. The LMS does not fetch DNS by itself, and a record that looks configured can protect nothing (see the script's README on the SPF lookup-limit permerror).

## Domains you're sending from

${
  leadEmails.length > 0
    ? leadEmails.map((d) => `- \`${d}\` (recipient domain — not necessarily your sending domain)`).join('\n')
    : '_No lead emails yet._'
}

## Steps

1. Identify your **sending domain** (the domain in \`From:\` addresses — often a subdomain like \`mail.yourcompany.com\`).
2. Run these three commands and paste the output back into the LMS:

   \`\`\`bash
   dig TXT <your-sending-domain>
   dig TXT <selector>._domainkey.<your-sending-domain>     # DKIM
   dig TXT _dmarc.<your-sending-domain>
   \`\`\`

3. Click "Run again" with the SPF and DMARC strings below, or paste them into a CLI run:

   \`\`\`bash
   python3 scripts/email_auth_check.py \\
     --spf "paste-here" \\
     --dmarc "paste-here"
   \`\`\`

4. Read the script's output and apply the recommendations.

> See \`scripts/README.md\` in the skill library for the SPF lookup-limit defect (11+ mechanisms → permerror) and the guarantee that this script **never measures inbox placement**. Only a seed test or the receiving provider can tell you where mail landed.

## What this script does NOT do

- Does not modify DNS
- Does not send email
- Does not check inbox placement
- Does not fetch DNS on its own

It parses the records you paste. Nothing else.`

  return {
    ok: true,
    skillId,
    skillName,
    runnerType: 'script',
    outputMarkdown: md,
    durationMs: Date.now() - start,
  }
}

function leadsToCsv(leads: Lead[]): string {
  const headers = [
    'deal',
    'stage',
    'value',
    'created_date',
    'last_activity_date',
    'close_date',
    'owner',
    'source',
  ]
  const rows = leads.map((l) => [
    escapeCsv(l.person?.name ? `${l.company.name} (${l.person.name})` : l.company.name),
    l.stage,
    String(l.estimatedVolume),
    formatDateForCsv(l.createdAt),
    l.lastActivityAt ? formatDateForCsv(l.lastActivityAt) : '',
    l.expectedCloseDate ? formatDateForCsv(l.expectedCloseDate) : '',
    escapeCsv(l.ownerName),
    l.source,
  ])
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
}

function escapeCsv(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function formatDateForCsv(d: Date | string): string {
  const date = new Date(d)
  return date.toISOString().slice(0, 10)
}

async function runPython(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // timeout: a hung script is killed (SIGTERM) instead of holding the request forever.
    const proc = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(code === null ? 'python timed out after 30s' : `python exited ${code}: ${stderr.trim() || stdout.trim()}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        // not JSON — return text
        resolve({ text: stdout })
      }
    })
    proc.on('error', reject)
  })
}

function jsonToMarkdown(json: unknown, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback || 'No output.'

  const data = json as Record<string, unknown>

  let md = `# Pipeline Hygiene Audit\n\n`

  if (typeof data.reference_date === 'string') {
    md += `_Reference date: **${data.reference_date}** (newest created or last-activity date in your data — never a close date)_\n\n`
  }

  if (data.summary && typeof data.summary === 'object') {
    const s = data.summary as Record<string, unknown>
    md += `## Summary\n\n`
    if (typeof s.deal_count === 'number') md += `- **Deals analysed:** ${s.deal_count}\n`
    if (typeof s.total_value === 'number') md += `- **Total reported value:** ₹${(s.total_value as number).toLocaleString('en-IN')}\n`
    if (typeof s.defensible_value === 'number') md += `- **Defensible value:** ₹${(s.defensible_value as number).toLocaleString('en-IN')}\n`
    if (typeof s.inactive_value === 'number') md += `- **Removed for inactivity:** ₹${(s.inactive_value as number).toLocaleString('en-IN')}\n`
    if (typeof s.overdue_value === 'number') md += `- **Removed for past close date:** ₹${(s.overdue_value as number).toLocaleString('en-IN')}\n`
    md += `\n`
  }

  if (Array.isArray(data.issues) && data.issues.length > 0) {
    md += `## Issues found\n\n`
    md += `| Issue | Deals | Value | What it means |\n|---|---|---|---|\n`
    for (const issue of data.issues as Array<Record<string, unknown>>) {
      md += `| ${issue.issue ?? '—'} | ${issue.count ?? '—'} | ₹${Number(issue.value ?? 0).toLocaleString('en-IN')} | ${issue.meaning ?? '—'} |\n`
    }
    md += `\n`
  }

  if (Array.isArray(data.review_list) && data.review_list.length > 0) {
    md += `## Review list (specific deals to look at)\n\n`
    md += `| Deal | Stage | Value | Recommended action | Why |\n|---|---|---|---|---|\n`
    for (const r of data.review_list as Array<Record<string, unknown>>) {
      md += `| ${r.deal ?? '—'} | ${r.stage ?? '—'} | ₹${Number(r.value ?? 0).toLocaleString('en-IN')} | ${r.action ?? '—'} | ${r.reason ?? '—'} |\n`
    }
    md += `\n`
  }

  if (Array.isArray(data.stage_health) && data.stage_health.length > 0) {
    md += `## Stage health\n\n`
    md += `| Stage | Deals | Median age | Cycle |\n|---|---|---|---|\n`
    for (const s of data.stage_health as Array<Record<string, unknown>>) {
      md += `| ${s.stage ?? '—'} | ${s.deals ?? '—'} | ${s.median_age_days ?? '—'}d | ${s.cycle_days ?? '—'}d |\n`
    }
    md += `\n`
  }

  if (typeof data.process_fix === 'string') {
    md += `## What to fix in the process\n\n${data.process_fix}\n\n`
  }

  md += `---\n\n_Run by the LMS at ${new Date().toISOString()}. Script: \`pipeline_hygiene.py\`._\n`

  // If the JSON didn't have the expected shape, append the raw text fallback
  if (md === `# Pipeline Hygiene Audit\n\n`) {
    md += '```\n' + (fallback || JSON.stringify(json, null, 2)) + '\n```'
  }

  return md
}

// ============ LLM-driven ============

async function runLlmSkill(
  skill: { id: string; name: string },
  input: RunSkillInput,
  start: number,
): Promise<RunSkillResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env to run LLM-driven skills. (Pipeline Hygiene Audit and Spam Folder Check work without it.)'
    )
  }

  const skillText = await loadSkillText(skill.id)
  const leadContext = input.leadId ? input.leads.find((l) => l.id === input.leadId) : undefined

  const prompt = buildSkillPrompt({
    skillText,
    skillId: skill.id,
    scope: input.scope,
    leads: input.leads,
    leadContext,
    userQuestion: input.userQuestion,
  })

  // SDK default is 10 min x 3 tries; one minute and one retry is plenty for a report.
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 })
  const msg = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = (msg.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')

  const inputTokens = msg.usage.input_tokens
  const outputTokens = msg.usage.output_tokens
  // Sonnet 4.5 pricing: $3/M input, $15/M output
  const estimatedUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000

  return {
    ok: true,
    skillId: skill.id,
    skillName: skill.name,
    runnerType: 'llm',
    outputMarkdown: text,
    durationMs: Date.now() - start,
    cost: { inputTokens, outputTokens, estimatedUsd },
  }
}

export function listSkills() {
  return SKILLS
}