import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const MODEL = 'claude-sonnet-4-6'
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
