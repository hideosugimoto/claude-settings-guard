import { describe, it, expect } from 'vitest'
import { parseJsonRpcMessage, createJsonRpcFrame, MAX_MESSAGE_SIZE } from '../src/core/mcp-protocol.js'

describe('mcp-protocol', () => {
  describe('createJsonRpcFrame', () => {
    it('creates a valid Content-Length framed message', () => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test' })
      const frame = createJsonRpcFrame(body)

      expect(frame).toContain('Content-Length:')
      expect(frame).toContain('\r\n\r\n')
      expect(frame).toContain(body)
    })

    it('calculates correct byte length for ASCII', () => {
      const body = '{"test":"hello"}'
      const frame = createJsonRpcFrame(body)
      const expectedLength = Buffer.byteLength(body)

      expect(frame).toContain(`Content-Length: ${expectedLength}`)
    })

    it('calculates correct byte length for multibyte characters', () => {
      const body = '{"test":"日本語"}'
      const frame = createJsonRpcFrame(body)
      const expectedLength = Buffer.byteLength(body)

      expect(frame).toContain(`Content-Length: ${expectedLength}`)
    })
  })

  describe('parseJsonRpcMessage', () => {
    function frame(body: string): string {
      return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
    }

    it('parses a valid JSON-RPC request', () => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      const result = parseJsonRpcMessage(frame(body))

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].method).toBe('initialize')
      expect(result.messages[0].id).toBe(1)
      expect(result.remaining).toBe('')
    })

    it('parses multiple messages in one buffer', () => {
      const body1 = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      const body2 = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call' })
      const buffer = frame(body1) + frame(body2)

      const result = parseJsonRpcMessage(buffer)
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].method).toBe('tools/list')
      expect(result.messages[1].method).toBe('tools/call')
    })

    it('returns remaining buffer for incomplete messages', () => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test' })
      const fullFrame = frame(body)
      const partial = fullFrame.slice(0, fullFrame.length - 5)

      const result = parseJsonRpcMessage(partial)
      expect(result.messages).toHaveLength(0)
      expect(result.remaining).toBe(partial)
    })

    it('skips invalid JSON bodies', () => {
      const buffer = `Content-Length: 3\r\n\r\n{x}`
      const result = parseJsonRpcMessage(buffer)

      expect(result.messages).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
    })

    it('skips bodies that fail schema validation', () => {
      const body = JSON.stringify({ not_jsonrpc: true })
      const result = parseJsonRpcMessage(frame(body))

      expect(result.messages).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
    })

    it('handles notification (no id)', () => {
      const body = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
      const result = parseJsonRpcMessage(frame(body))

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].id).toBeUndefined()
    })

    it('rejects oversized Content-Length', () => {
      const buffer = `Content-Length: ${MAX_MESSAGE_SIZE + 1}\r\n\r\n`
      const result = parseJsonRpcMessage(buffer)

      expect(result.messages).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('exceeds')
    })

    it('handles headers without Content-Length', () => {
      const buffer = `X-Custom: value\r\n\r\n{}`
      const result = parseJsonRpcMessage(buffer)

      // Without Content-Length, the body portion becomes remaining
      // since we can't determine where the message ends
      expect(result.messages).toHaveLength(0)
    })
  })

  describe('MAX_MESSAGE_SIZE', () => {
    it('is 10MB', () => {
      expect(MAX_MESSAGE_SIZE).toBe(10 * 1024 * 1024)
    })
  })
})
