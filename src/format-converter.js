// 双格式转换器 - 消除Claude和OpenAI格式的特殊情况
export class FormatConverter {
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