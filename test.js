// 测试用例 - 验证双模式API代理功能
const API_BASE = 'https://your-worker.workers.dev'; // 替换为你的Worker域名
const AUTH_TOKEN = 'your-secure-token';             // 替换为你的认证令牌

// 测试配置
const TESTS = {
  claude: {
    gemini: {
      url: `${API_BASE}/${AUTH_TOKEN}/claude/gemini/v1/messages`,
      headers: {
        'x-api-key': 'YOUR_GEMINI_API_KEY',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'gemini-2.5-flash',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'Say hello in Chinese' }
        ]
      }
    },
    gemini_stream: {
      url: `${API_BASE}/${AUTH_TOKEN}/claude/gemini/v1/messages`,
      headers: {
        'x-api-key': 'YOUR_GEMINI_API_KEY',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'gemini-2.5-flash',
        max_tokens: 100,
        stream: true,
        messages: [
          { role: 'user', content: 'Say hello in Chinese' }
        ]
      }
    },
    openai: {
      url: `${API_BASE}/${AUTH_TOKEN}/claude/openai/v1/messages`,
      headers: {
        'x-api-key': 'YOUR_OPENAI_API_KEY',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'gpt-4o-mini',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'Say hello in Chinese' }
        ]
      }
    }
  },
  openai: {
    gemini: {
      url: `${API_BASE}/${AUTH_TOKEN}/openai/gemini/v1/chat/completions`,
      headers: {
        'authorization': 'Bearer YOUR_GEMINI_API_KEY',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'gemini-2.5-flash',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'Say hello in Chinese' }
        ]
      }
    },
    gemini_stream: {
      url: `${API_BASE}/${AUTH_TOKEN}/openai/gemini/v1/chat/completions`,
      headers: {
        'authorization': 'Bearer YOUR_GEMINI_API_KEY',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'gemini-2.5-flash',
        max_tokens: 100,
        stream: true,
        messages: [
          { role: 'user', content: 'Say hello in Chinese' }
        ]
      }
    },
    openai: {
      url: `${API_BASE}/${AUTH_TOKEN}/openai/openai/v1/chat/completions`,
      headers: {
        'authorization': 'Bearer YOUR_OPENAI_API_KEY',
        'Content-Type': 'application/json'
      },
      body: {
        model: 'gpt-4o-mini',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'Say hello in Chinese' }
        ]
      }
    }
  }
};

async function runTest(name, config) {
  console.log(`\n🧪 Testing ${name}...`);
  console.log(`URL: ${config.url}`);
  console.log(`Stream: ${config.body.stream || false}`);
  
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(config.body)
    });
    
    console.log(`Status: ${response.status}`);
    console.log(`Content-Type: ${response.headers.get('content-type')}`);
    
    if (response.ok) {
      // 检查是否为流式响应
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        console.log('✅ Stream Success!');
        console.log('Stream response detected, reading first few chunks...');
        
        const reader = response.body.getReader();
        let chunks = 0;
        try {
          while (chunks < 3) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = new TextDecoder().decode(value);
            console.log(`Chunk ${chunks + 1}:`, chunk.slice(0, 100) + '...');
            chunks++;
          }
        } finally {
          reader.releaseLock();
        }
      } else {
        const data = await response.json();
        console.log('✅ Non-stream Success!');
        console.log('Response preview:', JSON.stringify(data, null, 2).slice(0, 200) + '...');
      }
    } else {
      const error = await response.text();
      console.log('❌ Failed!');
      console.log('Error:', error);
    }
  } catch (error) {
    console.log('❌ Network Error!');
    console.log('Error:', error.message);
  }
}

async function runAllTests() {
  console.log('🚀 CF LLM Shadoway Test Suite');
  console.log('='.repeat(50));
  
  console.log('\n📋 Test Configuration:');
  console.log(`Base URL: ${API_BASE}`);
  console.log(`Auth Token: ${AUTH_TOKEN.slice(0, 8)}...`);
  
  console.log('\n⚠️  Please update API keys in the test configuration before running!');
  
  // Claude格式测试
  console.log('\n🔵 Testing Claude Format API...');
  await runTest('Claude → Gemini', TESTS.claude.gemini);
  await runTest('Claude → Gemini (Stream)', TESTS.claude.gemini_stream);
  await runTest('Claude → OpenAI', TESTS.claude.openai);
  
  // OpenAI格式测试
  console.log('\n🟢 Testing OpenAI Format API...');
  await runTest('OpenAI → Gemini', TESTS.openai.gemini);
  await runTest('OpenAI → Gemini (Stream)', TESTS.openai.gemini_stream);
  await runTest('OpenAI → OpenAI', TESTS.openai.openai);
  
  console.log('\n✨ Test suite completed!');
  console.log('\n📖 Manual Testing Commands:');
  console.log('Copy and paste these curl commands to test manually:\n');
  
  // 生成curl命令
  Object.entries(TESTS).forEach(([format, providers]) => {
    Object.entries(providers).forEach(([provider, config]) => {
      const authHeader = config.headers['x-api-key'] 
        ? `-H "x-api-key: ${config.headers['x-api-key']}"` 
        : `-H "authorization: ${config.headers.authorization}"`;
      
      console.log(`# ${format.toUpperCase()} → ${provider.toUpperCase()}`);
      console.log(`curl -X POST "${config.url}" \\`);
      console.log(`  ${authHeader} \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -d '${JSON.stringify(config.body, null, 2)}'`);
      console.log('');
    });
  });
}

// Claude Code集成测试
function generateClaudeCodeConfig() {
  console.log('\n🎯 Claude Code Integration Examples:');
  console.log('='.repeat(50));
  
  const configs = [
    {
      name: 'Gemini Backend',
      config: {
        "env": {
          "ANTHROPIC_BASE_URL": `${API_BASE}/${AUTH_TOKEN}/claude/gemini`,
          "ANTHROPIC_CUSTOM_HEADERS": "x-api-key: YOUR_GEMINI_API_KEY",
          "ANTHROPIC_MODEL": "gemini-2.5-pro",
          "ANTHROPIC_SMALL_FAST_MODEL": "gemini-2.5-flash"
        }
      }
    },
    {
      name: 'OpenAI Backend', 
      config: {
        "env": {
          "ANTHROPIC_BASE_URL": `${API_BASE}/${AUTH_TOKEN}/claude/openai`,
          "ANTHROPIC_CUSTOM_HEADERS": "x-api-key: YOUR_OPENAI_API_KEY",
          "ANTHROPIC_MODEL": "gpt-4o",
          "ANTHROPIC_SMALL_FAST_MODEL": "gpt-4o-mini"
        }
      }
    }
  ];
  
  configs.forEach(({ name, config }) => {
    console.log(`\n## ${name}`);
    console.log('Edit ~/.claude/settings.json:');
    console.log(JSON.stringify(config, null, 2));
  });
}

// OpenAI SDK集成测试
function generateOpenAISDKExample() {
  console.log('\n🔧 OpenAI SDK Integration Examples:');
  console.log('='.repeat(50));
  
  console.log(`
// Using Gemini as OpenAI-compatible backend
const openai = new OpenAI({
  apiKey: 'your-gemini-api-key',
  baseURL: '${API_BASE}/${AUTH_TOKEN}/openai/gemini'
});

const response = await openai.chat.completions.create({
  model: "gemini-2.5-flash",
  messages: [
    {"role": "user", "content": "Hello"}
  ]
});

console.log(response.choices[0].message.content);
`);
}

// 如果直接运行此文件
if (typeof window === 'undefined' && typeof global !== 'undefined') {
  // Node.js环境
  runAllTests().then(() => {
    generateClaudeCodeConfig();
    generateOpenAISDKExample();
  });
} else {
  // 浏览器环境
  console.log('Run runAllTests() to start testing');
}