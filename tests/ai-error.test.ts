import { describe, expect, it } from 'vitest'
import { GeminiError, explainAiError, parsePayload } from '../src/main/services/AIService'

describe('Gemini error messages', () => {
  it('identifies Google Search quota failures instead of calling them busy', () => {
    expect(explainAiError(new GeminiError(429, 'RESOURCE_EXHAUSTED'), { usesGoogleSearch: true }))
      .toContain('Google Search grounding reached its Gemini rate limit or quota')
  })

  it('reserves the transient retry message for service unavailability', () => {
    expect(explainAiError(new GeminiError(503, 'unavailable')))
      .toBe('Gemini is temporarily unavailable. Wait a moment and retry.')
  })

  it('reads Gemini dedicated-transcription parts', () => {
    const payload = { candidates: [{ content: { parts: [{ audioTranscription: { text: 'Open SmartCursor.' } }] } }] }
    expect(parsePayload(payload).text).toBe('Open SmartCursor.')
  })
})
