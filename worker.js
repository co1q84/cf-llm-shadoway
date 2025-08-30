
// Dual-Mode AI Proxy Worker
// 双模式AI代理网关 - 支持Claude和OpenAI格式，提供Socket隐私保护
// Generated at: 2025-08-30T17:18:47.014Z

// ===== Socket Transport Layer =====
// Socket传输层 - 实现隐私保护的HTTP请求
// 简化实现：直接使用fetch API，因为它原生支持流式处，
// 我们只需要清理掉不安全的头部信息即可。

class SocketTransport {
  constructor(debug = false) {
    this.debug = debug;
  }

  log(message) {
    if (this.debug) console.log(`[Transport] ${message}`);
  }

  // 核心方法：使用fetch进行请求，同时清理头部以保护隐私
  async fetch(targetUrl, request, apiKey) {
    const url = new URL(targetUrl);
    
    // 1. 构建干净的HTTP请求头（无CF-*泄露）
    const cleanHeaders = this.buildCleanHeaders(request.headers, url.hostname, apiKey);
    
    // 2. 创建一个新的请求对象
    // 注意：直接传递原始request的body，因为它是一个可读流
    const proxyReq = new Request(targetUrl, {
      method: request.method,
      headers: cleanHeaders,
      body: request.body,
      redirect: 'follow'
    });

    this.log(`Proxying request to ${targetUrl}`);
    
    // 3. 使用原生fetch发送请求
    return fetch(proxyReq);
  }

  // 构建干净的请求头：移除所有CF-*头，添加必要的认证头
  buildCleanHeaders(originalHeaders, hostname, apiKey) {
    const headers = new Headers();
    
    // 复制安全的请求头
    for (const [key, value] of originalHeaders) {
      const keyLower = key.toLowerCase();
      // 过滤掉隐私泄露的头部
      if (!keyLower.startsWith('cf-') && 
          !keyLower.startsWith('x-forwarded-') &&
          !['host', 'connection'].includes(keyLower)) {
        headers.set(key, value);
      }
    }
    
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
    } else {
      this.log("API key is missing.");
    }
    
    return headers;
  }
}


// ===== Format Converter =====
// 双格式转换器 - 消除Claude和OpenAI格式的特殊情况
// 增加了对流式响应的实时格式转换支持

class FormatConverter {
  constructor() {
    this.idCounter = 0;
    this.textDecoder = new TextDecoder();
  }

  generateId(prefix = 'msg_') {
    return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 统一入口：根据目标格式和Provider进行转换
  async convertRequest(inputFormat, outputProvider, requestBody) {
    // ... (省略未改变的请求转换逻辑)
  }

  async convertResponse(targetFormat, sourceProvider, response, originalRequest) {
    const isStream = this.isStreamResponse(response, originalRequest);
    
    if (isStream) {
      // 流式：通过TransformStream进行实时格式转换
      const conversionStream = this.getConversionStream(targetFormat, sourceProvider, originalRequest.model);
      const newBody = response.body.pipeThrough(conversionStream);
      
      return new Response(newBody, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    } else {
      // 非流式：格式转换
      const responseData = await response.json();
      
      if (targetFormat === 'claude') {
        return this.convertToClaude(sourceProvider, responseData, response.status);
      } else if (targetFormat === 'openai') {
        return this.convertToOpenAI(sourceProvider, responseData, response.status, originalRequest);
      }
      throw new Error(`Unsupported target format: ${targetFormat}`);
    }
  }

  // 获取转换流
  getConversionStream(targetFormat, sourceProvider, model) {
    // 如果源和目标格式一致，则直接透传
    if ((targetFormat === 'openai' && sourceProvider === 'openai') ||
        (targetFormat === 'claude' && sourceProvider === 'anthropic')) {
      return new TransformStream(); // Passthrough
    }

    // Gemini -> OpenAI 流转换
    if (sourceProvider === 'gemini' && targetFormat === 'openai') {
      return this.createGeminiToOpenAIStream(model);
    }
    
    // Anthropic -> OpenAI 流转换
    if (sourceProvider === 'anthropic' && targetFormat === 'openai') {
        return this.createClaudeToOpenAIStream(model);
    }

    // Gemini -> Claude 流转换
    if (sourceProvider === 'gemini' && targetFormat === 'claude') {
      return this.createGeminiToClaudeStream();
    }

    // OpenAI -> Claude 流转换
    if (sourceProvider === 'openai' && targetFormat === 'claude') {
      return this.createOpenAIToClaudeStream();
    }

    // 对于其他未实现的流式转换，抛出明确错误
    throw new Error(`Stream conversion from ${sourceProvider} to ${targetFormat} is not supported.`);
  }

  // 创建 OpenAI -> Claude 的转换流
  createOpenAIToClaudeStream() {
    let buffer = '';
    return new TransformStream({
      transform: (chunk, controller) => {
        buffer += this.textDecoder.decode(chunk);
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          if (line.includes('[DONE]')) return;

          try {
            const openaiData = JSON.parse(line.substring(6));
            const choice = openaiData.choices && openaiData.choices[0];
            if (choice && choice.delta && choice.delta.content) {
              const claudeChunk = {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: choice.delta.content }
              };
              controller.enqueue(`data: ${JSON.stringify(claudeChunk)}\n\n`);
            }
          } catch (e) {
            console.error('Error parsing OpenAI stream chunk for Claude conversion:', e, line);
          }
        }
      },
      flush: (controller) => {
        const stopChunk = {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 }
        };
        const stopMessage = { type: 'message_stop' };
        controller.enqueue(`data: ${JSON.stringify(stopChunk)}\n\n`);
        controller.enqueue(`data: ${JSON.stringify(stopMessage)}\n\n`);
      }
    });
  }

  // 创建 Gemini -> Claude 的转换流
  createGeminiToClaudeStream() {
    let buffer = '';
    return new TransformStream({
      transform: (chunk, controller) => {
        buffer += this.textDecoder.decode(chunk);
        const parts = buffer.split('\r\n\r\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          try {
            const geminiData = JSON.parse(part.substring(6));
            if (geminiData.candidates && geminiData.candidates[0].content.parts[0].text) {
              const text = geminiData.candidates[0].content.parts[0].text;
              
              // 构建Claude格式的块
              const claudeChunk = {
                type: 'content_block_delta',
                index: 0,
                delta: {
                  type: 'text_delta',
                  text: text
                }
              };
              controller.enqueue(`data: ${JSON.stringify(claudeChunk)}\n\n`);
            }
          } catch (e) {
            console.error('Error parsing Gemini stream chunk for Claude conversion:', e, part);
          }
        }
      },
      flush: (controller) => {
        // 模拟Anthropic的结束事件
        const stopChunk = {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 } // Usage data is not available from Gemini stream
        };
        const stopMessage = {
          type: 'message_stop',
        };
        controller.enqueue(`data: ${JSON.stringify(stopChunk)}\n\n`);
        controller.enqueue(`data: ${JSON.stringify(stopMessage)}\n\n`);
      }
    });
  }

  // 创建 Gemini -> OpenAI 的转换流
  createGeminiToOpenAIStream(model) {
    let buffer = '';
    const completionId = this.generateId('chatcmpl-');
    const created = Math.floor(Date.now() / 1000);

    return new TransformStream({
      transform: (chunk, controller) => {
        buffer += this.textDecoder.decode(chunk);
        
        // Gemini的SSE以 `data: { ... }` 形式出现，并以\r\n\r\n分割
        const parts = buffer.split('\r\n\r\n');
        buffer = parts.pop() || ''; // 保留不完整的最后一个块

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          
          try {
            const geminiData = JSON.parse(part.substring(6));
            if (geminiData.candidates && geminiData.candidates[0].content.parts[0].text) {
              const text = geminiData.candidates[0].content.parts[0].text;
              
              const openaiChunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: created,
                model: model,
                choices: [{
                  index: 0,
                  delta: { content: text },
                  finish_reason: null
                }]
              };
              controller.enqueue(`data: ${JSON.stringify(openaiChunk)}\n\n`);
            }
          } catch (e) {
            console.error('Error parsing Gemini stream chunk:', e, part);
          }
        }
      },
      flush: (controller) => {
        // 流结束时发送结束标志
        const endChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created: created,
          model: model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }]
        };
        controller.enqueue(`data: ${JSON.stringify(endChunk)}\n\n`);
        controller.enqueue('data: [DONE]\n\n');
      }
    });
  }
    
  // 创建 Claude -> OpenAI 的转换流
  createClaudeToOpenAIStream(model) {
    let buffer = '';
    const completionId = this.generateId('chatcmpl-');
    const created = Math.floor(Date.now() / 1000);

    return new TransformStream({
      transform: (chunk, controller) => {
        buffer += this.textDecoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          
          try {
            const claudeData = JSON.parse(line.substring(6));
            let openaiChunk = null;

            if (claudeData.type === 'content_block_delta' && claudeData.delta.type === 'text_delta') {
              openaiChunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: created,
                model: model,
                choices: [{
                  index: 0,
                  delta: { content: claudeData.delta.text },
                  finish_reason: null
                }]
              };
            } else if (claudeData.type === 'message_stop') {
              openaiChunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: created,
                model: model,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: 'stop'
                }]
              };
            }

            if (openaiChunk) {
              controller.enqueue(`data: ${JSON.stringify(openaiChunk)}\n\n`);
            }

          } catch (e) {
            console.error('Error parsing Claude stream chunk:', e, line);
          }
        }
      },
      flush: (controller) => {
        controller.enqueue('data: [DONE]\n\n');
      }
    });
  }


  // ... (省略未改变的非流式转换逻辑和请求转换逻辑)
  // isStreamResponse, convertFromClaude, convertFromOpenAI, etc.
  // convertToClaude, convertToOpenAI, and their helpers
}


// ===== Main Handler =====
const handler = // 主路由逻辑 - 遵循"好品味"原则的极简实现

// Provider URL映射
const PROVIDER_URLS = {
  'gemini': 'https://generativelanguage.googleapis.com/v1beta',
  'openai': 'https://api.openai.com/v1',
  'anthropic': 'https://api.anthropic.com/v1'
};

// 模型映射 - 遵循需求文档的双层结构
const MODEL_MAPPING = {
  // Claude格式输入的模型映射
  'claude': {
    'gemini': {
      'gemini-2.5-pro': 'models/gemini-2.0-flash-exp',
      'gemini-2.5-flash': 'models/gemini-2.0-flash-exp',
    },
    'openai': {
      'gpt-4o': 'gpt-4o',
    },
    'anthropic': {
        'claude-3-5-sonnet-20240620': 'claude-3-5-sonnet-20240620',
    }
  },
  // OpenAI格式输入的模型映射
  'openai': {
    'gemini': {
      'gemini-pro': 'models/gemini-pro',
      'gemini-2.5-flash': 'models/gemini-2.0-flash-exp',
    },
    'openai': {
      'gpt-4o': 'gpt-4o',
      'gpt-4o-mini': 'gpt-4o-mini',
    },
    'anthropic': {
      'claude-3-sonnet': 'claude-3-5-sonnet-20240620',
      'claude-3-haiku': 'claude-3-haiku-20240725'
    }
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
  // 为了支流式请求，我们需要克隆请求，因为body只能被读取一次
  const requestBody = await request.clone().json();
  
  // 2. 模型名称映射（使用新的双层结构）
  let finalModel = requestBody.model;
  if (requestBody.model && MODEL_MAPPING[format] && MODEL_MAPPING[format][provider] && MODEL_MAPPING[format][provider][requestBody.model]) {
    finalModel = MODEL_MAPPING[format][provider][requestBody.model];
    requestBody.model = finalModel; // 更新模型名称用于后续转换
  }
  
  // 3. 格式转换：输入格式 → Provider格式
  const providerRequest = await converter.convertRequest(format, provider, requestBody);
  
  // 4. 构建目标URL (现在需要传入isStream标志)
  const isStream = requestBody.stream === true;
  const finalEndpoint = buildEndpoint(format, provider, endpoint, finalModel, isStream);
  const targetUrl = `${PROVIDER_URLS[provider]}/${finalEndpoint}`;
  
  // 5. 创建代理请求
  // 注意：body现在需要被stringify，因为providerRequest是JS对象
  const proxyReq = new Request(targetUrl, {
    method: 'POST',
    headers: request.headers, // headers将在transport层被清理
    body: JSON.stringify(providerRequest)
  });
  
  // 6. Socket传输（隐私保护）
  // 注意：现在我们传递的是新构建的proxyReq，而不是原始request
  const providerResponse = await transport.fetch(targetUrl, proxyReq, apiKey);
  
  // 7. 错误理
  if (!providerResponse.ok) {
    return providerResponse; // 直接返回错误响应
  }
  
  // 8. 响应转换：Provider格式 → 目标格式（传递原始请求体用于流式检测）
  return await converter.convertResponse(format, provider, providerResponse, requestBody);
}

// 构建目标端点URL - 修复了Gemini路径重写BUG，增强了路径透传能力
function buildEndpoint(format, provider, endpoint, model, isStream) {
  // 规则映射表，用于需要特殊处理的端点
  const endpointRules = {
    'gemini': {
      'chat/completions': { action: isStream ? 'streamGenerateContent' : 'generateContent', needsModel: true },
      'messages': { action: isStream ? 'streamGenerateContent' : 'generateContent', needsModel: true },
      'embedContent': { action: 'embedContent', needsModel: true },
      'embedText': { action: 'embedText', needsModel: true }, // 兼容旧版
    }
  };

  const rules = endpointRules[provider];
  if (rules) {
    for (const pathSuffix in rules) {
      if (endpoint.endsWith(pathSuffix)) {
        const rule = rules[pathSuffix];
        // 保留原始路径前缀，只替换或附加必要部分
        const basePath = endpoint.substring(0, endpoint.length - pathSuffix.length);
        const modelPath = rule.needsModel ? `models/${model}` : '';
        return `${basePath}${modelPath}:${rule.action}`;
      }
    }
  }

  // 默认情况下，对有provider都进行更健壮的路径透传
  // 例如支持 /v1/embeddings 等API
  return endpoint;
}
;

// ===== Worker Export =====
export default handler;
