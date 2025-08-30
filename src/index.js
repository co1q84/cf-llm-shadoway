// 主路由逻辑 - 遵循"好品味"原则的极简实现
import { SocketTransport } from './socket-transport.js';
import { FormatConverter } from './format-converter.js';

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

export default {
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
}