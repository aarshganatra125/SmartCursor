const SENSITIVE_KEY = /text|selection|prompt|image|token|key|ocr|content|instruction|clipboard|excerpt|surround|message|title|url/i

function clean(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {}
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) continue
    if (typeof value === 'string') output[key] = value.slice(0, 180)
    else if (typeof value === 'number' || typeof value === 'boolean' || value == null) output[key] = value
  }
  return output
}

function write(level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, message, ...clean(fields) }))
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields)
}
