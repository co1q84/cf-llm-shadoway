// 双格式转换器 - 消除Claude和OpenAI格式的特殊情况
// 增加了对流式响应的实时格式转换支持

export class FormatConverter {
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
