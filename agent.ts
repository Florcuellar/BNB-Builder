import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { getStockReport } from './stockwatch.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;
const MCP_PROTOCOL_VERSION = '2025-03-26';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error('Request body exceeds the 64 KiB limit.');
    }
  }
  return JSON.parse(body);
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (value === null || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return request.jsonrpc === '2.0' && typeof request.method === 'string';
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function handleMcp(request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: request.id ?? null,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'stockwatch', version: '0.1.0' },
        },
      };
    case 'notifications/initialized':
      return undefined;
    case 'ping':
      return { jsonrpc: '2.0', id: request.id ?? null, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: request.id ?? null,
        result: {
          tools: [{
            name: 'get_stock_report',
            description: 'Compare a tokenized stock pool price with a reference quote and report U.S. market status.',
            inputSchema: {
              type: 'object',
              properties: { ticker: { type: 'string', description: 'Tokenized stock ticker, such as AAPL.' } },
              required: ['ticker'],
              additionalProperties: false,
            },
          }],
        },
      };
    case 'tools/call': {
      const params = request.params ?? {};
      if (params.name !== 'get_stock_report') {
        return rpcError(request.id, -32602, 'Unknown tool.');
      }
      const args = params.arguments;
      if (args === null || typeof args !== 'object' || typeof (args as Record<string, unknown>).ticker !== 'string') {
        return rpcError(request.id, -32602, 'Provide a ticker string.');
      }
      try {
        const report = await getStockReport((args as { ticker: string }).ticker);
        return {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: { content: [{ type: 'text', text: report }], isError: false },
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: {
            content: [{ type: 'text', text: errorMessage(error) }],
            isError: true,
          },
        };
      }
    }
    default:
      return rpcError(request.id, -32601, 'Method not found.');
  }
}

function extractA2AText(params: Record<string, unknown>): string | undefined {
  const message = params.message;
  if (message === null || typeof message !== 'object') return undefined;
  const parts = (message as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return undefined;
  return parts.flatMap((part) => {
    if (part === null || typeof part !== 'object') return [];
    const item = part as Record<string, unknown>;
    return item.kind === 'text' && typeof item.text === 'string' ? [item.text] : [];
  }).join(' ').trim();
}

async function handleA2A(request: JsonRpcRequest): Promise<unknown> {
  if (request.method !== 'message/send') {
    return rpcError(request.id, -32601, 'Only message/send is supported.');
  }
  const ticker = extractA2AText(request.params ?? {});
  if (!ticker) return rpcError(request.id, -32602, 'Provide a text message containing a stock ticker.');
  try {
    const report = await getStockReport(ticker);
    return {
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: {
        kind: 'message',
        messageId: randomUUID(),
        role: 'agent',
        parts: [{ kind: 'text', text: report }],
      },
    };
  } catch (error) {
    return rpcError(request.id, -32000, errorMessage(error));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected stock report failure.';
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/health') {
    sendJson(response, 200, { status: 'ok', agent: 'stockwatch', network: 'bsc-testnet' });
    return;
  }
  if (request.method === 'GET' && path === '/.well-known/agent-card.json') {
    sendJson(response, 200, {
      protocolVersion: '0.3.0',
      name: 'stockwatch',
      description: 'Returns a short tokenized stock price comparison and U.S. market status report.',
      url: `${process.env.PUBLIC_AGENT_URL ?? `http://localhost:${PORT}`}/a2a`,
      version: '0.1.0',
      capabilities: { streaming: false },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [{
        id: 'stock-report',
        name: 'Tokenized stock report',
        description: 'Input a ticker; get its BSC testnet pool price, reference price, and U.S. market status.',
        tags: ['stocks', 'BNB Chain', 'market-data'],
        examples: ['AAPL'],
        inputModes: ['text'],
        outputModes: ['text'],
      }],
    });
    return;
  }
  if (request.method === 'POST' && (path === '/mcp' || path === '/a2a')) {
    let rpcRequest: unknown;
    try {
      rpcRequest = await readJsonBody(request);
    } catch (error) {
      const status = errorMessage(error).includes('64 KiB') ? 413 : 400;
      sendJson(response, status, { error: errorMessage(error) });
      return;
    }
    if (!isJsonRpcRequest(rpcRequest)) {
      sendJson(response, 400, rpcError(null, -32600, 'Invalid JSON-RPC request.'));
      return;
    }
    if (path === '/mcp' && rpcRequest.method.startsWith('notifications/')) {
      response.writeHead(202).end();
      return;
    }
    const result = path === '/mcp'
      ? await handleMcp(rpcRequest)
      : await handleA2A(rpcRequest);
    if (result === undefined) {
      response.writeHead(202).end();
      return;
    }
    sendJson(response, 200, result);
    return;
  }
  sendJson(response, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`stockwatch listening at http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
  console.error('stockwatch server error:', error);
  process.exitCode = 1;
});
