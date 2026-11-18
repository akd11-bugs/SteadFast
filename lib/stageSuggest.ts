import { GoogleGenerativeAI } from '@google/generative-ai'

// Standalone, deliberately NOT built on lib/skills/runner.ts's runSkill —
// that function is tightly coupled to the skill-catalog/SkillRun output
// shape (markdown report, SkillRun row, etc.), which doesn't fit a single
// small "map this raw value to one of these stage keys" call. Follows the
// same defensive never-throw/always-return-a-tagged-result pattern used
// elsewhere in this codebase (see lib/jobRun.ts, lib/leadImport.ts's
// per-row try/catch for custom fields) so a flaky or unconfigured Gemini
// call can never take down the review screen that calls this.

export interface StageSuggestSuccess {
  ok: true
  stage: string
  note: string
}

export interface StageSuggestFailure {
  ok: false
  error: string
}

export type StageSuggestResult = StageSuggestSuccess | StageSuggestFailure

export interface AvailableStage {
  key: string
  label: string
}

function buildPrompt(rawValue: string, availableStages: AvailableStage[]): string {
  const stageList = availableStages.map((s) => `- ${s.key} ("${s.label}")`).join('\n')
  return [
    'A CRM import found a lead status/stage value from a spreadsheet that did not exactly match any of this organization\'s pipeline stages.',
    `Raw value from the sheet: "${rawValue}"`,
    'Available pipeline stages (key and display label):',
    stageList,
    '',
    'Pick the single best-matching stage key from the list above, or say none fit.',
    'Respond with EXACTLY one line of JSON and nothing else, in this shape:',
    '{"stage": "<one of the keys above, or null if none fit>", "note": "<one short sentence explaining the match>"}',
  ].join('\n')
}

// Strips a ```json ... ``` fence if the model wraps its answer in one,
// despite being asked for bare JSON — cheap and tolerant rather than
// failing the whole suggestion over formatting.
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced ? fenced[1] : text).trim()
}

export async function suggestStageForValue(
  rawValue: string,
  availableStages: AvailableStage[],
): Promise<StageSuggestResult> {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return { ok: false, error: 'GEMINI_API_KEY is not configured' }
    }
    if (!rawValue.trim()) {
      return { ok: false, error: 'No raw value to suggest a stage for' }
    }
    if (availableStages.length === 0) {
      return { ok: false, error: 'No pipeline stages available to match against' }
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const result = await model.generateContent(buildPrompt(rawValue, availableStages))
    const text = result.response.text()
    if (!text) {
      return { ok: false, error: 'Gemini returned an empty response' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(extractJson(text))
    } catch {
      return { ok: false, error: 'Could not parse Gemini response as JSON' }
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, error: 'Gemini response was not a JSON object' }
    }
    const { stage, note } = parsed as { stage?: unknown; note?: unknown }

    if (stage === null || stage === undefined) {
      return { ok: false, error: 'Gemini found no matching stage' }
    }
    if (typeof stage !== 'string' || !availableStages.some((s) => s.key === stage)) {
      return { ok: false, error: 'Gemini suggested a stage key that is not in the available list' }
    }

    return { ok: true, stage, note: typeof note === 'string' ? note : '' }
  } catch (err) {
    // Network failure, rate limit, malformed SDK response, anything else —
    // never throw. The caller (the review-screen GET route) must be able to
    // keep showing every other row's suggestion even if this one call fails.
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
