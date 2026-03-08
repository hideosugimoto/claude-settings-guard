import { z } from 'zod'

export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024 // 10MB

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
})

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>

export function createJsonRpcFrame(body: string): string {
  const length = Buffer.byteLength(body)
  return `Content-Length: ${length}\r\n\r\n${body}`
}

export interface ParseResult {
  readonly messages: readonly JsonRpcRequest[]
  readonly remaining: string
  readonly errors: readonly string[]
}

export function parseJsonRpcMessage(buffer: string): ParseResult {
  const messages: JsonRpcRequest[] = []
  const errors: string[] = []
  let remaining = buffer

  while (true) {
    const headerEnd = remaining.indexOf('\r\n\r\n')
    if (headerEnd === -1) break

    const header = remaining.slice(0, headerEnd)
    const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i)

    if (!contentLengthMatch) {
      remaining = remaining.slice(headerEnd + 4)
      continue
    }

    const contentLength = parseInt(contentLengthMatch[1], 10)

    if (contentLength > MAX_MESSAGE_SIZE) {
      errors.push(`Content-Length ${contentLength} exceeds limit ${MAX_MESSAGE_SIZE}`)
      remaining = remaining.slice(headerEnd + 4)
      continue
    }

    // Use Buffer for byte-accurate body extraction (handles multibyte chars)
    const afterHeader = remaining.slice(headerEnd + 4)
    const afterHeaderBuf = Buffer.from(afterHeader, 'utf-8')

    if (afterHeaderBuf.length < contentLength) break

    const body = afterHeaderBuf.subarray(0, contentLength).toString('utf-8')
    remaining = afterHeaderBuf.subarray(contentLength).toString('utf-8')

    try {
      const parsed = jsonRpcRequestSchema.safeParse(JSON.parse(body))
      if (parsed.success) {
        messages.push(parsed.data)
      } else {
        errors.push(`Schema validation failed: ${parsed.error.message}`)
      }
    } catch {
      errors.push('Failed to parse JSON body')
    }
  }

  return { messages, remaining, errors }
}
