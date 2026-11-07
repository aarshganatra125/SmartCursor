export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 400)
  return 'Something went wrong.'
}
