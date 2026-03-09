import {
  handleDiagnose,
  handleRecommend,
  handleAssessRisk,
  handleEnforce,
  handleSetup,
  type McpToolResult,
} from './mcp/tools.js'
import { parseJsonRpcMessage, createJsonRpcFrame, MAX_MESSAGE_SIZE, type JsonRpcRequest } from './core/mcp-protocol.js'
import { VERSION } from './version.js'

type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResult>

const TOOL_HANDLERS: Readonly<Record<string, ToolHandler>> = {
  csg_diagnose: (args) => handleDiagnose(args),
  csg_recommend: (args) => handleRecommend(args),
  csg_assess_risk: (args) => handleAssessRisk(args),
  csg_enforce: (args) => handleEnforce(args as { dryRun?: boolean }),
  csg_setup: (args) => handleSetup(args as { profile?: string }),
}

interface McpToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: {
    readonly type: 'object'
    readonly properties: Record<string, unknown>
    readonly required?: readonly string[]
  }
}

const TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'csg_diagnose',
    description: '現在の Claude Code settings.json を診断し、問題を検出して返す',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'csg_recommend',
    description: 'Analyze telemetry and current settings, returning structured data with pattern grouping, project context, and recommendations for Claude to interpret.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Project directory path for project type detection',
        },
      },
    },
  },
  {
    name: 'csg_assess_risk',
    description: 'Analyze deny rule bypass risks including pipe chains, subshells, and command substitution. Returns structured risk assessment with mitigation status.',
    inputSchema: {
      type: 'object',
      properties: {
        denyRules: {
          type: 'array',
          items: { type: 'string' },
          description: 'Deny rules to analyze (reads from settings.json if omitted)',
        },
      },
    },
  },
  {
    name: 'csg_enforce',
    description: 'Layer 2 強制フックを生成・プレビュー (dry-run対応)',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'true の場合は生成内容のみ表示し、ファイルは作成しない',
        },
      },
    },
  },
  {
    name: 'csg_setup',
    description: 'プロファイルの適用案内を返す (セキュリティ上、直接適用は無効)',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          description: 'プロファイル名 (minimal, balanced, strict)',
          enum: ['minimal', 'balanced', 'strict'],
        },
      },
    },
  },
]

function sendResponse(id: number | string, result: unknown): void {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result })
  process.stdout.write(createJsonRpcFrame(body))
}

function sendError(id: number | string, code: number, message: string): void {
  const body = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
  process.stdout.write(createJsonRpcFrame(body))
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const { id, method, params } = request

  // Notifications (no id) should not receive responses per JSON-RPC 2.0
  const isNotification = id === undefined

  switch (method) {
    case 'initialize':
      if (!isNotification) {
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'claude-settings-guard',
            version: VERSION,
          },
        })
      }
      break

    case 'tools/list':
      if (!isNotification) {
        sendResponse(id, { tools: TOOLS })
      }
      break

    case 'tools/call': {
      if (isNotification) break

      const rawToolName = (params as Record<string, unknown>)?.name
      if (typeof rawToolName !== 'string') {
        sendError(id!, -32602, 'Missing or invalid tool name in params')
        return
      }
      const toolName = rawToolName
      const args = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>

      try {
        const handler = TOOL_HANDLERS[toolName]
        if (!handler) {
          sendError(id, -32601, `Unknown tool: ${toolName}`)
          return
        }
        const result = await handler(args)
        sendResponse(id, result)
      } catch (err) {
        sendError(id, -32603, err instanceof Error ? err.message : String(err))
      }
      break
    }

    case 'notifications/initialized':
      break

    default:
      if (!isNotification) {
        sendError(id, -32601, `Method not found: ${method}`)
      }
  }
}

export async function startMcpServer(): Promise<void> {
  let buffer = ''
  const pendingRequests = new Set<Promise<void>>()

  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk

    if (buffer.length > MAX_MESSAGE_SIZE) {
      process.stderr.write('MCP: Message too large, dropping buffer\n')
      buffer = ''
      return
    }

    const result = parseJsonRpcMessage(buffer)
    buffer = result.remaining

    for (const error of result.errors) {
      process.stderr.write(`MCP: ${error}\n`)
    }

    for (const message of result.messages) {
      const p = handleRequest(message).catch(err => {
        process.stderr.write(`MCP handler error: ${err}\n`)
      }).finally(() => { pendingRequests.delete(p) })
      pendingRequests.add(p)
    }
  })

  process.stdin.on('end', async () => {
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000))
    await Promise.race([Promise.allSettled([...pendingRequests]), timeout])
    process.exit(0)
  })
}
