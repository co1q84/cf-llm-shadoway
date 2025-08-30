// 构建脚本 - 将所有模块合并为单个Worker文件
const fs = require('fs');
const path = require('path');

function buildWorker() {
  console.log('🔨 Building dual-mode AI proxy worker...');

  // 读取源文件
  const socketTransport = fs.readFileSync('./src/socket-transport.js', 'utf8')
    .replace(/import.*from.*["'].*["'];?\n/g, '') // 移除import语句
    .replace(/export\s+/g, ''); // 移除export

  const formatConverter = fs.readFileSync('./src/format-converter.js', 'utf8')
    .replace(/import.*from.*["'].*["'];?\n/g, '')
    .replace(/export\s+/g, '');

  const index = fs.readFileSync('./src/index.js', 'utf8')
    .replace(/import.*from.*["'].*["'];?\n/g, '')
    .replace(/export\s+default\s+/, '');

  // 合并文件内容
  const workerContent = `
// Dual-Mode AI Proxy Worker
// 双模式AI代理网关 - 支持Claude和OpenAI格式，提供Socket隐私保护
// Generated at: ${new Date().toISOString()}

// ===== Socket Transport Layer =====
${socketTransport}

// ===== Format Converter =====
${formatConverter}

// ===== Main Handler =====
const handler = ${index};

// ===== Worker Export =====
export default handler;
`;

  // 写入worker.js文件
  fs.writeFileSync('./worker.js', workerContent);
  
  console.log('✅ Worker built successfully: worker.js');
  console.log('📦 File size:', Math.round(fs.statSync('./worker.js').size / 1024), 'KB');
  console.log('🚀 Ready for deployment with: wrangler deploy');
}

buildWorker();