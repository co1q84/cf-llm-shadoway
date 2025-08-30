// Socket传输层 - 实现隐私保护的HTTP请求
// 简化实现：直接使用fetch API，因为它原生支持流式处，
// 我们只需要清理掉不安全的头部信息即可。

export class SocketTransport {
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
