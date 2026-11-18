import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateContentMock = vi.fn()
const getGenerativeModelMock = vi.fn(() => ({ generateContent: generateContentMock }))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return getGenerativeModelMock()
    }
  },
}))

const { suggestStageForValue } = await import('@/lib/stageSuggest')

const availableStages = [
  { key: 'new', label: 'New' },
  { key: 'pending', label: 'Pending' },
  { key: 'proposal', label: 'Proposal' },
]

const savedEnv: { GEMINI_API_KEY?: string } = {}

beforeEach(() => {
  savedEnv.GEMINI_API_KEY = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'test-key'
  generateContentMock.mockReset()
  getGenerativeModelMock.mockClear()
})

afterEach(() => {
  if (savedEnv.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = savedEnv.GEMINI_API_KEY
})

describe('suggestStageForValue', () => {
  it('returns ok:true with the parsed stage and note on a well-formed response', async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => '{"stage": "proposal", "note": "Proposal sent reads as Proposal stage"}' },
    })
    const result = await suggestStageForValue('Proposal Sent', availableStages)
    expect(result).toEqual({ ok: true, stage: 'proposal', note: 'Proposal sent reads as Proposal stage' })
  })

  it('tolerates a markdown code fence around the JSON', async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => '```json\n{"stage": "pending", "note": "Looks like pending"}\n```' },
    })
    const result = await suggestStageForValue('In progress', availableStages)
    expect(result).toEqual({ ok: true, stage: 'pending', note: 'Looks like pending' })
  })

  it('returns ok:false, never throws, when Gemini rejects the call', async () => {
    generateContentMock.mockRejectedValue(new Error('rate limited'))
    const result = await suggestStageForValue('Something', availableStages)
    expect(result).toEqual({ ok: false, error: 'rate limited' })
  })

  it('returns ok:false when the response is not valid JSON', async () => {
    generateContentMock.mockResolvedValue({ response: { text: () => 'not json at all' } })
    const result = await suggestStageForValue('Something', availableStages)
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when the model suggests a stage key outside the provided list', async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => '{"stage": "won", "note": "nope"}' },
    })
    const result = await suggestStageForValue('Something', availableStages)
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when the model finds no match (stage: null)', async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => '{"stage": null, "note": "no good match"}' },
    })
    const result = await suggestStageForValue('Gibberish', availableStages)
    expect(result.ok).toBe(false)
  })

  it('returns ok:false without calling Gemini when GEMINI_API_KEY is not configured', async () => {
    delete process.env.GEMINI_API_KEY
    const result = await suggestStageForValue('Something', availableStages)
    expect(result).toEqual({ ok: false, error: 'GEMINI_API_KEY is not configured' })
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('returns ok:false without calling Gemini for an empty raw value', async () => {
    const result = await suggestStageForValue('   ', availableStages)
    expect(result.ok).toBe(false)
    expect(generateContentMock).not.toHaveBeenCalled()
  })
})
