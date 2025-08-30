# Cloudflare Workers 手动部署指南

本文档将指导你如何通过 Cloudflare 控制台Dashboard）手动部署 `cf-llm-shadoway` 项目。

## 部署流程概览

手动部署主要分为两个阶段：

1.  **本地准备**: 在你的电脑上生成用于部署的 `worker.js` 单文件。
2.  **云端部署**: 在 Cloudflare 控制台中创建 Worker 并粘贴代码、配置环境变量。

---

### 阶段一：在本地生成 `worker.js`

在将代码部署到 Cloudflare 之前，你需要先将项目的所有模块合并成一个文件。

**前提条件:**
*   你已经安装了 [Node.js](https://nodejs.org/) (LTS 版本即可)。
*   你已经通过 `git clone` 将项目代码下载到了本地。

**步骤:**

1.  **打开终端**:
    进入项目的根目录。

2.  **安装依赖**:
    运行以下命令来安装所需的开发工具（如 `wrangler`）。
    ```bash
    npm install
    ```

3.  **构建 Worker 脚本**:
    运行构建命令，此命令会执行 `build.js` 脚本，将 `src/` 目录下的所有源文件合并成一个可部署的 `worker.js` 文件。
    ```bash
    npm run build
    ```
    执行成功后，你会在项目根目录看到一个新生成的 `worker.js` 文件。这个文件就是我们唯一需要部署的文件。

---

### 阶段二：在 Cloudflare 控制台部署

**步骤:**

1.  **登录 Cloudflare**:
    打开并登录你的 [Cloudflare Dashboard](https://dash.cloudflare.com/)。

2.  **进入 Workers & Pages**:
    在左侧导航栏中，选择 **Workers & Pages**。

3.  **创建服务**:
    *   点击 **Create application** 或 **Create service**。
    *   选择 **Create Worker** 选项。
    *   为你的 Worker 服务设置一个唯一的名称（例如 `my-ai-proxy`），然后点击 **Deploy**。

4.  **配置 Worker**:
    *   创建成功后，点击 **Configure service** 或 **Edit code** 进入 Worker 的管理界面。

5.  **粘贴代码**:
    *   在 Cloudflare 的在线代码编辑器中，删除所有默认生成的代码。
    *   打开你本地项目根目录下的 `worker.js` 文件，复制其**全部内容**。
    *   将复制的内容粘贴到 Cloudflare 的在线编辑器中。
    *   点击编辑器下方的 **Save and deploy** 按钮。

6.  **配置环境变量**:
    *   在 Worker 的管理界面，进入 **Settings** -> **Variables**。
    *   在 **Environment Variables** 部分，点击 **Add variable** 添加以下三个环境变量：

        | 变量名            | 值                             | 描述                                     |
        | ----------------- | ------------------------------ | ---------------------------------------- |
        | `AUTH_TOKEN`      | `your-secure-token-here`       | **（必须修改）** 设置一个复杂且唯一的安全令牌，用于访问你的代理服务。 |
        | `DEBUG_MODE`      | `false`                        | 设置为 `true` 会在响应中包含更多调试信息。 |
        | `DEFAULT_PROVIDER`| `gemini`                       | 默认的上游 AI 服务 (`gemini`, `openai`, `anthropic`)。 |

    *   **重要**: 确保为 `AUTH_TOKEN` 设置一个难以猜测的强密码。
    *   配置完成后，环境变量会自动保存并应用到你的 Worker 服务中。

7.  **完成部署**:
    至此，你的 Worker 已经成功部署并配置完毕。你可以通过 Worker 的 URL (`https://<你的Worker名称>.<你的子域>.workers.dev`) 来访问它了。
