# CF LLM Shadoway

一个基于Cloudflare Workers的AI代理网关，支持Claude和OpenAI两种API格式，提供Socket级别的隐私保护。

## 🎯 核心特性

- **双API格式支持**: 同时支持Claude和OpenAI API格式
- **隐私保护**: 使用Socket传输避免CF-*头泄露
- **多AI后端**: 支持Gemini、OpenAI、Anthropic等主流AI服务
- **零配置**: 开箱即用，无需复杂配置
- **轻量级**: 单文件部署，无外部依赖

## 🚀 快速开始

详细的部署指南，包括**手动部署**和**命令行部署**，请参阅：

➡️ **[部署指南 (DEPLOYMENT.md)](./DEPLOYMENT.md)**

### 2. URL格式

#### Claude格式API
```
https://your-worker.workers.dev/{token}/claude/{provider}/v1/messages
```

#### OpenAI格式API  
```
https://your-worker.workers.dev/{token}/openai/{provider}/v1/chat/completions
```

**支持的Provider**: `gemini` | `openai` | `anthropic`

## 📋 使用示例

### Claude Code配置

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-worker.workers.dev/your-token/claude/gemini",
    "ANTHROPIC_CUSTOM_HEADERS": "x-api-key: YOUR_GEMINI_API_KEY",
    "ANTHROPIC_MODEL": "gemini-2.5-pro"
  }
}
```

### OpenAI SDK配置

```javascript
const openai = new OpenAI({
  apiKey: 'your-gemini-key',
  baseURL: 'https://your-worker.workers.dev/your-token/openai/gemini'
});

const response = await openai.chat.completions.create({
  model: "gemini-2.5-flash",
  messages: [{"role": "user", "content": "Hello"}]
});
```

### 直接API调用

```bash
# Claude格式调用Gemini
curl -X POST https://your-worker.workers.dev/token123/claude/gemini/v1/messages \
  -H "x-api-key: YOUR_GEMINI_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'

# OpenAI格式调用Gemini
curl -X POST https://your-worker.workers.dev/token123/openai/gemini/v1/chat/completions \
  -H "authorization: Bearer YOUR_GEMINI_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

## ⚙️ 环境变量配置

在`wrangler.toml`中配置：

```toml
[vars]
AUTH_TOKEN = "your-secure-token-here"  # 必须修改
DEBUG_MODE = "false"                   # 调试模式
DEFAULT_PROVIDER = "gemini"            # 默认Provider
```

## 🏗️ 架构设计

```
┌─────────────────────────────────────┐
│        Request Router               │  
│    (URL解析 + token验证)             │
├─────────────────────────────────────┤
│     Socket Proxy + Converter       │
│  (隐私保护传输 + 统一格式转换)        │
└─────────────────────────────────────┘
```

### 核心设计原则

1. **消除特殊情况** - 统一的双模式处理逻辑
2. **简化数据结构** - 二元选择替代多重判断  
3. **减少复杂度** - 2层架构，1个核心函数
4. **保证兼容性** - Never break userspace

## 🔧 开发

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 构建
npm run build

# 部署
npm run deploy
```

## 📊 支持的API映射

| 输入格式 | Provider | 目标API | 认证方式 |
|---------|----------|---------|----------|
| Claude | gemini | Gemini API | x-goog-api-key |
| Claude | openai | OpenAI API | Authorization Bearer |
| Claude | anthropic | Claude API | x-api-key |
| OpenAI | gemini | Gemini API | x-goog-api-key |
| OpenAI | openai | OpenAI API | Authorization Bearer |
| OpenAI | anthropic | Claude API | x-api-key |

## 🛡️ 隐私保护

- **Socket传输**: 使用原生TCP Socket避免CF-*头泄露
- **头部过滤**: 自动移除所有隐私相关的请求头
- **无日志**: 不记录任何敏感信息
- **认证安全**: 支持多种认证方式

## 📖 许可证

MIT License

## 🤝 贡献

欢迎提交Issue和Pull Request！

---

**设计哲学**: 遵循Linus Torvalds的"好品味"原则 - 消除特殊情况，简化数据结构，保持代码简洁优雅。
