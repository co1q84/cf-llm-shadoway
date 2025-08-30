// Socket传输层 - 实现隐私保护的HTTP请求
import { connect } from "cloudflare:sockets";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 消除特殊情况：统一的Socket传输实现
export class SocketTransport {
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