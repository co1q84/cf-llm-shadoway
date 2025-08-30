
// Dual-Mode AI Proxy Worker
// 双模式AI代理网关 - 支持Claude和OpenAI格式，提供Socket隐私保护
// Generated at: 2025-08-30T16:26:51.465Z

// ===== Socket Transport Layer =====
// Socket传输层 - 实现隐私保护的HTTP请求

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 消除特殊情况：统一的Socket传输实现
class SocketTransport {
  constructor(debug = false) {
    this.debug = debug;
  }

  log(message) {
    if (this.debug) console.log(`[SocketTransport] ${message}`);
  }

  // 核心方法：Socket级别的HTTP请求，避免CF-*头泄露
  async fetch(targetUrl, request, apiKey) {
    const url = new URL(targetUrl);
    const isSecure = url.protocol === 'https:';
    const port = url.port || (isSecure ? 443 : 80);
    
    this.log(`Connecting to ${url.hostname}:${port} via Socket`);
    
    // 建立Socket连接
    const socket = await connect(
      { hostname: url.hostname, port: Number(port) },
      { secureTransport: isSecure ? "on" : "off", allowHalfOpen: false }
    );

    try {
      // 构建干净的HTTP请求头（无CF-*泄露）
      const cleanHeaders = this.buildCleanHeaders(request, url.hostname, apiKey);
      const requestLine = this.buildRequestLine(request.method, url, cleanHeaders);
      
      const writer = socket.writable.getWriter();
      
      // 发送请求头
      await writer.write(encoder.encode(requestLine));
      
      // 发送请求体（如果有）
      if (request.body) {
        const bodyBuffer = await request.arrayBuffer();
        await writer.write(new Uint8Array(bodyBuffer));
      }
      
      await writer.close();
      
      // 读取响应
      return await this.readHttpResponse(socket);
      
    } catch (error) {
      socket.close();
      throw new Error(`Socket transport failed: ${error.message}`);
    }
  }

  // 构建干净的请求头：移除所有CF-*头，添加必要的认证头
  buildCleanHeaders(request, hostname, apiKey) {
    const headers = new Map();
    
    // 复制安全的请求头
    for (const [key, value] of request.headers) {
      const keyLower = key.toLowerCase();
      // 过滤掉隐私泄露的头部
      if (!keyLower.startsWith('cf-') && 
          !keyLower.startsWith('x-forwarded-') &&
          keyLower !== 'host') {
        headers.set(key, value);
      }
    }
    
    // 设置基础头部
    headers.set('Host', hostname);
    headers.set('Connection', 'close');
    
    // 设置API认证（统一处理）
    if (apiKey) {
      if (hostname.includes('generativelanguage.googleapis.com')) {
        // Gemini API使用x-goog-api-key
        headers.set('x-goog-api-key', apiKey);
      } else if (hostname.includes('api.openai.com')) {
        // OpenAI API使用Authorization Bearer
        headers.set('Authorization', `Bearer ${apiKey}`);
      } else if (hostname.includes('api.anthropic.com')) {
        // Anthropic API使用x-api-key
        headers.set('x-api-key', apiKey);
      }
    }
    
    return headers;
  }

  // 构建HTTP请求行
  buildRequestLine(method, url, headers) {
    const path = url.pathname + url.search;
    let requestLine = `${method} ${path} HTTP/1.1\r\n`;
    
    // 添加所有头部
    for (const [key, value] of headers) {
      requestLine += `${key}: ${value}\r\n`;
    }
    
    requestLine += '\r\n';
    return requestLine;
  }

  // 读取HTTP响应
  async readHttpResponse(socket) {
    const reader = socket.readable.getReader();
    let buffer = new Uint8Array(0);
    let headersParsed = false;
    let headers = new Map();
    let statusCode = 200;
    let responseBody = new Uint8Array(0);
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer = this.concatUint8Arrays(buffer, value);
        
        if (!headersParsed) {
          const headerEndIndex = this.findHeaderEnd(buffer);
          if (headerEndIndex !== -1) {
            // 解析响应头
            const headerText = decoder.decode(buffer.slice(0, headerEndIndex));
            const result = this.parseHttpHeaders(headerText);
            headers = result.headers;
            statusCode = result.status;
            
            // 剩余的是响应体
            responseBody = buffer.slice(headerEndIndex + 4); // +4 for \r\n\r\n
            headersParsed = true;
          }
        } else {
          // 继续读取响应体
          responseBody = this.concatUint8Arrays(responseBody, value);
        }
      }
      
      return new Response(responseBody, {
        status: statusCode,
        headers: Object.fromEntries(headers)
      });
      
    } finally {
      reader.releaseLock();
    }
  }

  // 辅助方法
  concatUint8Arrays(arr1, arr2) {
    const result = new Uint8Array(arr1.length + arr2.length);
    result.set(arr1);
    result.set(arr2, arr1.length);
    return result;
  }

  findHeaderEnd(buffer) {
    const pattern = new Uint8Array([13, 10, 13, 10]); // \r\n\r\n
    for (let i = 0; i <= buffer.length - pattern.length; i++) {
      let match = true;
      for (let j = 0; j < pattern.length; j++) {
        if (buffer[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }

  parseHttpHeaders(headerText) {
    const lines = headerText.split('\r\n');
    const statusLine = lines[0];
    const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 200;
    
    const headers = new Map();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        const colonIndex = line.indexOf(':');
        if (colonIndex !== -1) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          headers.set(key.toLowerCase(), value);
        }
      }
    }
    
    return { status, headers };
  }
}

// ===== Format Converter =====
// 双格式转换器 - 消除Claude和OpenAI格式的特殊情况
class FormatConverter {
  constructor() {
    this.idCounter = 0;
  }

  generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 统一入口：根据目标格式和Provider进行转换
  async convertRequest(inputFormat, outputProvider, requestBody) {
    if (inputFormat === 'claude') {
      return this.convertFromClaude(outputProvider, requestBody);
    } else if (inputFormat === 'openai') {
      return this.convertFromOpenAI(outputProvider, requestBody);
    }
    throw new Error(`Unsupported input format: ${inputFormat}`);
  }

  async convertResponse(targetFormat, sourceProvider, response, originalRequest) {
    // 二元选择：流式直传 OR 格式转换
    const isStream = this.isStreamResponse(response, originalRequest);
    
    if (isStream) {
      // 流式：直接透传，保持Socket隐私保护
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*'
        }
      });
    } else {
      // 非流式：格式转换
      const responseData = await response.json();
      
      if (targetFormat === 'claude') {
        return this.convertToClaude(sourceProvider, responseData, response.status);
      } else if (targetFormat === 'openai') {
        return this.convertToOpenAI(sourceProvider, responseData, response.status);
      }
      throw new Error(`Unsupported target format: ${targetFormat}`);
    }
  }

  // 流式响应检测 - 消除特殊情况的统一判断
  isStreamResponse(response, originalRequest) {
    // 检查原始请求是否要求流式
    const requestStream = originalRequest && (
      originalRequest.stream === true || 
      originalRequest.stream === 'true'
    );
    
    // 检查响应头是否为流式
    const contentType = response.headers.get('content-type') || '';
    const isEventStream = contentType.includes('text/event-stream');
    const isChunked = response.headers.get('transfer-encoding') === 'chunked';
    
    return requestStream || isEventStream || isChunked;
  }

  // Claude格式 → Provider格式转换
  convertFromClaude(provider, claudeRequest) {
    switch (provider) {
      case 'gemini':
        return this.claudeToGemini(claudeRequest);
      case 'openai':
        return this.claudeToOpenAI(claudeRequest);
      case 'anthropic':
        return claudeRequest; // 直通
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  // OpenAI格式 → Provider格式转换
  convertFromOpenAI(provider, openaiRequest) {
    switch (provider) {
      case 'gemini':
        return this.openaiToGemini(openaiRequest);
      case 'openai':
        return openaiRequest; // 直通
      case 'anthropic':
        return this.openaiToClaude(openaiRequest);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  // Claude → Gemini
  claudeToGemini(claudeRequest) {
    const contents = [];
    
    for (const message of claudeRequest.messages) {
      const parts = [];
      
      if (typeof message.content === 'string') {
        parts.push({ text: message.content });
      } else {
        for (const content of message.content) {
          if (content.type === 'text') {
            parts.push({ text: content.text });
          } else if (content.type === 'tool_use') {
            parts.push({
              functionCall: {
                name: content.name,
                args: content.input
              }
            });
          }
        }
      }
      
      contents.push({
        parts,
        role: message.role === 'assistant' ? 'model' : 'user'
      });
    }

    const geminiRequest = {
      contents,
      generationConfig: {}
    };

    if (claudeRequest.max_tokens) {
      geminiRequest.generationConfig.maxOutputTokens = claudeRequest.max_tokens;
    }
    if (claudeRequest.temperature !== undefined) {
      geminiRequest.generationConfig.temperature = claudeRequest.temperature;
    }

    if (claudeRequest.tools && claudeRequest.tools.length > 0) {
      geminiRequest.tools = [{
        functionDeclarations: claudeRequest.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }))
      }];
    }

    return geminiRequest;
  }

  // Claude → OpenAI
  claudeToOpenAI(claudeRequest) {
    const messages = [];
    
    for (const message of claudeRequest.messages) {
      if (typeof message.content === 'string') {
        messages.push({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content
        });
      } else {
        const textContents = [];
        const toolCalls = [];
        
        for (const content of message.content) {
          if (content.type === 'text') {
            textContents.push(content.text);
          } else if (content.type === 'tool_use') {
            toolCalls.push({
              id: content.id,
              type: 'function',
              function: {
                name: content.name,
                arguments: JSON.stringify(content.input)
              }
            });
          } else if (content.type === 'tool_result') {
            messages.push({
              role: 'tool',
              tool_call_id: content.tool_use_id,
              content: typeof content.content === 'string' ? content.content : JSON.stringify(content.content)
            });
          }
        }
        
        if (textContents.length > 0 || toolCalls.length > 0) {
          const msg = {
            role: message.role === 'assistant' ? 'assistant' : 'user'
          };
          if (textContents.length > 0) {
            msg.content = textContents.join('\n');
          }
          if (toolCalls.length > 0) {
            msg.tool_calls = toolCalls;
          }
          messages.push(msg);
        }
      }
    }

    const openaiRequest = {
      model: claudeRequest.model,
      messages,
      stream: claudeRequest.stream
    };

    if (claudeRequest.max_tokens) openaiRequest.max_tokens = claudeRequest.max_tokens;
    if (claudeRequest.temperature !== undefined) openaiRequest.temperature = claudeRequest.temperature;

    if (claudeRequest.tools && claudeRequest.tools.length > 0) {
      openaiRequest.tools = claudeRequest.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }
      }));
    }

    return openaiRequest;
  }

  // OpenAI → Gemini
  openaiToGemini(openaiRequest) {
    const contents = [];
    
    for (const message of openaiRequest.messages) {
      const parts = [];
      
      if (message.content) {
        parts.push({ text: message.content });
      }
      
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments)
            }
          });
        }
      }
      
      if (message.role === 'tool') {
        // Tool result message
        parts.push({
          functionResponse: {
            name: 'function_result',
            response: { content: message.content }
          }
        });
      }
      
      if (parts.length > 0) {
        contents.push({
          parts,
          role: message.role === 'assistant' ? 'model' : 
                message.role === 'tool' ? 'tool' : 'user'
        });
      }
    }

    const geminiRequest = {
      contents,
      generationConfig: {}
    };

    if (openaiRequest.max_tokens) {
      geminiRequest.generationConfig.maxOutputTokens = openaiRequest.max_tokens;
    }
    if (openaiRequest.temperature !== undefined) {
      geminiRequest.generationConfig.temperature = openaiRequest.temperature;
    }

    if (openaiRequest.tools && openaiRequest.tools.length > 0) {
      geminiRequest.tools = [{
        functionDeclarations: openaiRequest.tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }))
      }];
    }

    return geminiRequest;
  }

  // OpenAI → Claude
  openaiToClaude(openaiRequest) {
    const messages = [];
    
    for (const message of openaiRequest.messages) {
      const content = [];
      
      if (message.content) {
        content.push({ type: 'text', text: message.content });
      }
      
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments)
          });
        }
      }
      
      if (message.role === 'tool') {
        content.push({
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: message.content
        });
      }
      
      if (content.length > 0) {
        messages.push({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: content.length === 1 && content[0].type === 'text' ? content[0].text : content
        });
      }
    }

    const claudeRequest = {
      model: openaiRequest.model,
      messages,
      stream: openaiRequest.stream
    };

    if (openaiRequest.max_tokens) claudeRequest.max_tokens = openaiRequest.max_tokens;
    if (openaiRequest.temperature !== undefined) claudeRequest.temperature = openaiRequest.temperature;

    if (openaiRequest.tools && openaiRequest.tools.length > 0) {
      claudeRequest.tools = openaiRequest.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters
      }));
    }

    return claudeRequest;
  }

  // Provider响应 → Claude格式
  convertToClaude(provider, responseData, statusCode) {
    let claudeResponse;
    
    switch (provider) {
      case 'gemini':
        claudeResponse = this.geminiToClaude(responseData);
        break;
      case 'openai':
        claudeResponse = this.openaiToClaude(responseData);
        break;
      case 'anthropic':
        claudeResponse = responseData; // 直通
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    return new Response(JSON.stringify(claudeResponse), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Provider响应 → OpenAI格式
  convertToOpenAI(provider, responseData, statusCode) {
    let openaiResponse;
    
    switch (provider) {
      case 'gemini':
        openaiResponse = this.geminiToOpenAI(responseData);
        break;
      case 'openai':
        openaiResponse = responseData; // 直通
        break;
      case 'anthropic':
        openaiResponse = this.claudeToOpenAIResponse(responseData);
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    return new Response(JSON.stringify(openaiResponse), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Gemini响应 → Claude格式
  geminiToClaude(geminiResponse) {
    const claudeResponse = {
      id: this.generateId(),
      type: 'message',
      role: 'assistant',
      content: []
    };

    if (geminiResponse.candidates && geminiResponse.candidates.length > 0) {
      const candidate = geminiResponse.candidates[0];
      
      for (const part of candidate.content.parts) {
        if (part.text) {
          claudeResponse.content.push({
            type: 'text',
            text: part.text
          });
        } else if (part.functionCall) {
          claudeResponse.content.push({
            type: 'tool_use',
            id: this.generateId(),
            name: part.functionCall.name,
            input: part.functionCall.args
          });
        }
      }
    }

    if (geminiResponse.usageMetadata) {
      claudeResponse.usage = {
        input_tokens: geminiResponse.usageMetadata.promptTokenCount,
        output_tokens: geminiResponse.usageMetadata.candidatesTokenCount
      };
    }

    return claudeResponse;
  }

  // Gemini响应 → OpenAI格式
  geminiToOpenAI(geminiResponse) {
    const openaiResponse = {
      id: this.generateId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gemini-pro',
      choices: []
    };

    if (geminiResponse.candidates && geminiResponse.candidates.length > 0) {
      const candidate = geminiResponse.candidates[0];
      const message = { role: 'assistant', content: '' };
      const toolCalls = [];
      
      for (const part of candidate.content.parts) {
        if (part.text) {
          message.content += part.text;
        } else if (part.functionCall) {
          toolCalls.push({
            id: this.generateId(),
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args)
            }
          });
        }
      }
      
      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }
      
      openaiResponse.choices.push({
        index: 0,
        message,
        finish_reason: 'stop'
      });
    }

    if (geminiResponse.usageMetadata) {
      openaiResponse.usage = {
        prompt_tokens: geminiResponse.usageMetadata.promptTokenCount,
        completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount,
        total_tokens: geminiResponse.usageMetadata.totalTokenCount
      };
    }

    return openaiResponse;
  }

  // 其他转换方法省略，遵循相同模式...
}

// ===== Main Handler =====
const handler = // 主路由逻辑 - 遵循"好品味"原则的极简实现

// Provider URL映射
const PROVIDER_URLS = {
  'gemini': 'https://generativelanguage.googleapis.com/v1beta',
  'openai': 'https://api.openai.com/v1',
  'anthropic': 'https://api.anthropic.com/v1'
};

// 模型映射 - 统一模型名称到Provider原生名称
const MODEL_MAPPING = {
  'gemini': {
    'gemini-2.5-pro': 'models/gemini-2.0-flash-exp',
    'gemini-2.5-flash': 'models/gemini-2.0-flash-exp',
    'gemini-pro': 'models/gemini-pro'
  },
  'openai': {
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt-4': 'gpt-4'
  },
  'anthropic': {
    'claude-3-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-3-haiku': 'claude-3-5-haiku-20241022'
  }
};

{
  async fetch(request, env, ctx) {
    // 初始化配置
    const config = {
      AUTH_TOKEN: env.AUTH_TOKEN || 'your-secure-token',
      DEBUG_MODE: env.DEBUG_MODE === 'true',
      DEFAULT_PROVIDER: env.DEFAULT_PROVIDER || 'gemini'
    };

    try {
      return await handleRequest(request, config);
    } catch (error) {
      console.error('Proxy error:', error);
      return new Response(JSON.stringify({ 
        error: error.message,
        type: 'proxy_error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

// 核心处理函数 - 消除所有特殊情况的统一逻辑
async function handleRequest(request, config) {
  // 只支持POST请求
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // 解析URL：/{token}/{format}/{provider}/*
  const { token, format, provider, endpoint, error } = parseUrl(request.url);
  if (error) return error;

  // 验证Token
  if (token !== config.AUTH_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 获取API Key
  const apiKey = getApiKey(request.headers);
  if (!apiKey) {
    return new Response('Missing API key in x-api-key or authorization header', { status: 401 });
  }

  // 核心逻辑：统一的代理处理流程
  return await proxyRequest(format, provider, endpoint, request, apiKey, config.DEBUG_MODE);
}

// URL解析 - 消除特殊情况的统一解析
function parseUrl(url) {
  const urlObj = new URL(url);
  const parts = urlObj.pathname.split('/').filter(Boolean);
  
  if (parts.length < 3) {
    return { error: new Response('Invalid URL format. Expected: /{token}/{format}/{provider}/*', { status: 400 }) };
  }

  const [token, format, provider, ...endpointParts] = parts;
  
  // 验证格式
  if (!['claude', 'openai'].includes(format)) {
    return { error: new Response('Invalid format. Must be "claude" or "openai"', { status: 400 }) };
  }

  // 验证Provider
  if (!PROVIDER_URLS[provider]) {
    return { error: new Response(`Unsupported provider: ${provider}. Supported: ${Object.keys(PROVIDER_URLS).join(', ')}`, { status: 400 }) };
  }

  const endpoint = endpointParts.join('/') + urlObj.search;
  
  return { token, format, provider, endpoint };
}

// 获取API Key - 统一处理
function getApiKey(headers) {
  return headers.get('x-api-key') || 
         headers.get('authorization')?.replace('Bearer ', '') ||
         headers.get('Authorization')?.replace('Bearer ', '');
}

// 核心代理函数 - 这里是"好品味"的体现：无特殊情况
async function proxyRequest(format, provider, endpoint, request, apiKey, debug) {
  const transport = new SocketTransport(debug);
  const converter = new FormatConverter();
  
  // 1. 解析请求体
  const requestBody = await request.json();
  
  // 2. 模型名称映射
  if (requestBody.model && MODEL_MAPPING[provider] && MODEL_MAPPING[provider][requestBody.model]) {
    requestBody.model = MODEL_MAPPING[provider][requestBody.model];
  }
  
  // 3. 格式转换：输入格式 → Provider格式
  const providerRequest = converter.convertRequest(format, provider, requestBody);
  
  // 4. 构建目标URL
  const targetUrl = `${PROVIDER_URLS[provider]}/${endpoint}`;
  
  // 5. 创建代理请求
  const proxyReq = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(providerRequest)
  });
  
  // 6. Socket传输（隐私保护）
  const providerResponse = await transport.fetch(targetUrl, proxyReq, apiKey);
  
  // 7. 错误处理
  if (!providerResponse.ok) {
    return providerResponse; // 直接返回错误响应
  }
  
  // 8. 响应转换：Provider格式 → 目标格式（传递原始请求体用于流式检测）
  return await converter.convertResponse(format, provider, providerResponse, requestBody);
}

// 构建目标端点URL - 根据格式和Provider确定正确的端点
function buildEndpoint(format, provider, endpoint) {
  // Claude格式的端点映射
  if (format === 'claude') {
    if (endpoint.startsWith('v1/messages')) {
      switch (provider) {
        case 'gemini':
          return 'models/gemini-pro:generateContent';
        case 'openai':
          return 'chat/completions';
        case 'anthropic':
          return 'messages';
      }
    }
  }
  
  // OpenAI格式的端点映射
  if (format === 'openai') {
    if (endpoint.startsWith('v1/chat/completions')) {
      switch (provider) {
        case 'gemini':
          return 'models/gemini-pro:generateContent';
        case 'openai':
          return 'chat/completions';
        case 'anthropic':
          return 'messages';
      }
    }
  }
  
  // 默认直接使用原始端点
  return endpoint;
};

// ===== Worker Export =====
export default handler;
