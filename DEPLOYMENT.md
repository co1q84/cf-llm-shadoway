# 部署指南

## 🚀 Cloudflare Workers部署步骤

### 1. 准备工作

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

### 2. 配置项目

编辑 `wrangler.toml`:

```toml
name = "cf-llm-shadoway"
main = "worker.js"
compatibility_date = "2024-01-01"

[env.production]
name = "cf-llm-shadoway"

[vars]
AUTH_TOKEN = "your-secure-token-here"    # ⚠️  必须修改为强密码
DEBUG_MODE = "false"                     # 生产环境建议关闭
DEFAULT_PROVIDER = "gemini"              # 默认Provider
```

### 3. 构建和部署

```bash
# 构建Worker
npm run build

# 部署到Cloudflare
npm run deploy

# 或者使用wrangler直接部署
wrangler deploy
```

### 4. 获取Worker URL

部署成功后，你会得到类似这样的URL：
```
https://cf-llm-shadoway.your-username.workers.dev
```

## 🔧 环境变量配置

| 变量名 | 必须 | 默认值 | 说明 |
|--------|------|--------|------|
| `AUTH_TOKEN` | ✅ | `your-secure-token` | 访问认证令牌，强烈建议修改 |
| `DEBUG_MODE` | ❌ | `false` | 调试模式，生产环境应设为false |
| `DEFAULT_PROVIDER` | ❌ | `gemini` | 默认AI服务提供商 |

### 安全配置建议

```bash
# 生成强密码作为AUTH_TOKEN
openssl rand -base64 32

# 或者使用其他强密码生成器
```

## 📋 配置验证

### 1. 基础连通性测试

```bash
curl https://your-worker.workers.dev/your-token/claude/gemini/v1/messages \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

期望响应：401 Unauthorized (因为缺少API key)

### 2. 完整功能测试

使用项目中的 `test.js` 文件：

```bash
# 编辑test.js中的配置
# 然后运行
node test.js
```

## 🎯 与现有服务集成

### Claude Code集成

1. 备份现有配置：
```bash
cp ~/.claude/settings.json ~/.claude/settings.json.backup
```

2. 编辑 `~/.claude/settings.json`：
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-worker.workers.dev/your-token/claude/gemini",
    "ANTHROPIC_CUSTOM_HEADERS": "x-api-key: YOUR_GEMINI_API_KEY",
    "ANTHROPIC_MODEL": "gemini-2.5-pro",
    "ANTHROPIC_SMALL_FAST_MODEL": "gemini-2.5-flash"
  }
}
```

3. 测试Claude Code：
```bash
claude "Hello, test message"
```

### OpenAI SDK集成

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'your-provider-api-key',
  baseURL: 'https://your-worker.workers.dev/your-token/openai/gemini'
});

// 现在所有OpenAI SDK调用都会通过你的代理
```

## 🛠️ 故障排除

### 常见问题

1. **401 Unauthorized**
   - 检查AUTH_TOKEN是否正确
   - 检查API key是否在正确的header中

2. **400 Bad Request**
   - 检查URL格式是否正确: `/{token}/{format}/{provider}/*`
   - 检查format是否为 `claude` 或 `openai`
   - 检查provider是否支持

3. **500 Internal Server Error**
   - 开启DEBUG_MODE查看详细错误
   - 检查Cloudflare Workers日志

4. **Socket连接失败**
   - 可能是网络问题或目标API暂时不可用
   - 尝试切换到其他provider

### 调试模式

开启调试模式查看详细日志：

```toml
[vars]
DEBUG_MODE = "true"
```

然后查看Cloudflare Workers实时日志：
```bash
wrangler tail
```

## 📊 性能优化

### 1. 冷启动优化

Worker已经优化为单文件部署，冷启动时间 < 100ms

### 2. 内存使用

当前Worker大小约24KB，内存使用极低

### 3. 并发处理

Cloudflare Workers自动处理并发，无需额外配置

## 🔒 安全建议

1. **强制HTTPS**: Cloudflare Workers默认强制HTTPS
2. **TOKEN安全**: 使用强密码作为AUTH_TOKEN
3. **API Key保护**: 不要在代码中硬编码API Key
4. **访问控制**: 考虑添加IP白名单或其他访问限制

## 📈 监控和日志

### Cloudflare Dashboard

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 Workers & Pages
3. 选择你的Worker
4. 查看实时指标和日志

### 关键指标

- 请求数量
- 错误率
- 响应时间
- CPU使用率

## 🔄 更新和维护

### 更新Worker

```bash
# 修改代码后重新构建和部署
npm run build
npm run deploy
```

### 回滚

```bash
# 查看部署历史
wrangler deployments list

# 回滚到指定版本
wrangler rollback [deployment-id]
```

### 备份配置

定期备份 `wrangler.toml` 和环境变量配置。

---

🎉 **部署完成！** 你现在拥有一个功能完整的双模式AI代理网关！