# Cloudflare Docker Registry Proxy

一个运行在 Cloudflare Workers 上的 Docker Registry 代理服务，支持代理多个主流的容器镜像仓库。

## 功能特性

- 🚀 **多 Registry 支持**：支持代理以下容器镜像仓库：
  - Docker Hub (`registry-1.docker.io`)
  - Quay.io (`quay.io`)
  - Google Container Registry (`gcr.io`)
  - Kubernetes GCR (`k8s.gcr.io`)
  - Kubernetes Registry (`registry.k8s.io`)
  - GitHub Container Registry (`ghcr.io`)
  - Cloudsmith (`docker.cloudsmith.io`)
  - Mcr (`mcr.microsoft.com`)

- 🔐 **认证处理**：自动处理 Docker Registry 的认证流程和 token 获取

- 🔄 **路径重定向**：自动处理 Docker Hub 的 library 路径重定向

- 🌐 **CORS 支持**：内置 CORS 支持，方便前端调用

- ⚡ **高性能**：基于 Cloudflare Workers 边缘计算，全球低延迟

## 项目结构

```
cloudflare-docker-registry/
├── src/
│   ├── index.ts                 # Worker 入口文件
│   ├── core/
│   │   ├── index.ts            # RegistryProxy 核心类
│   │   └── proxys/
│   │       └── docker.proxy.ts # Docker 代理实现
│   ├── constants/
│   │   └── registry.ts         # Registry 配置常量
│   ├── types/
│   │   └── index.ts            # TypeScript 类型定义
│   └── shared/
│       └── shared.ts           # 共享工具函数（CORS）
├── wrangler.jsonc              # Cloudflare Workers 配置
├── tsconfig.json               # TypeScript 配置
└── package.json                # 项目依赖配置
```

## 快速开始

### 前置要求

- Node.js >= 18
- pnpm (推荐) 或 npm/yarn
- Cloudflare 账号

### 安装依赖

```bash
pnpm install
```

### 本地开发

```bash
pnpm dev
# 或
pnpm start
```

### 部署到 Cloudflare Workers

```bash
pnpm deploy
```

## 使用方法

### 配置自定义域名

在 `wrangler.jsonc` 中配置你的自定义域名，例如：

```jsonc
{
  "name": "docker-registry",
  "routes": [
    { "pattern": "docker.yourdomain.com", "custom_domain": true }
  ]
}
```

### 使用代理服务

部署后，你可以通过你的 Worker 域名访问各个 Registry：

```bash
# 拉取 Docker Hub 镜像
docker pull docker.yourdomain.com/library/nginx:latest

# 拉取 GitHub Container Registry 镜像
docker pull ghcr.yourdomain.com/username/image:tag

# 拉取 Quay.io 镜像
docker pull quay.yourdomain.com/namespace/image:tag
```

### API 端点

- `GET /v2/` - Registry API 版本检查
- `GET /v2/auth` - Token 认证端点
- `GET /v2/{namespace}/{repository}/manifests/{tag}` - 获取镜像清单
- `GET /v2/{namespace}/{repository}/blobs/{digest}` - 获取镜像层

## 工作原理

1. **请求路由**：根据请求的 hostname 匹配对应的上游 Registry
2. **认证处理**：当上游返回 401 时，自动重写 `Www-Authenticate` 头，将 realm 指向 Worker 的 `/v2/auth` 端点
3. **Token 获取**：`/v2/auth` 端点从原始 Registry 获取 token 并返回
4. **路径重定向**：对于 Docker Hub，自动处理 library 命名空间的路径重定向
5. **请求转发**：将请求转发到对应的上游 Registry

## 配置说明

### Registry 配置

在 `src/constants/registry.ts` 中可以配置各个 Registry 的上游地址：

```typescript
export const registryConfigs: RegistryConfig = {
    docker: 'https://registry-1.docker.io',
    quay: 'https://quay.io',
    // ... 其他 Registry
};
```

### CORS 配置

在 `src/shared/shared.ts` 中可以自定义 CORS 头：

```typescript
export function cors(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    // 自定义其他 CORS 头
    return new Response(response.body, { status: response.status, headers });
}
```

## 开发

### 生成类型定义

```bash
pnpm cf-typegen
```

这会根据 `wrangler.jsonc` 配置生成 `worker-configuration.d.ts` 类型定义文件。

### 代码格式化

项目使用 Prettier 进行代码格式化，配置文件为 `.prettierrc.toml`。

## 技术栈

- **TypeScript** - 类型安全的 JavaScript
- **Cloudflare Workers** - 边缘计算平台
- **Wrangler** - Cloudflare Workers 开发工具

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关链接

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Docker Registry API 规范](https://docs.docker.com/registry/spec/api/)
- [Wrangler 文档](https://developers.cloudflare.com/workers/wrangler/)
