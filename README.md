# dsh-plugin-registry

企业内部 DSH（DeepSeek Harness）插件市场，思路借鉴 [dsh.so](https://www.dsh.so/zh/)。员工在 DSH 中添加一个内网索引地址后，只能看到并安装**公司放行**的插件：

- **公司自研插件**：内网 GitLab 上打了 `dsh-plugin` 话题（topic）的仓库，自动收录。
- **外部开源插件**：写进内网 GitLab 上一个项目里的 `allowlist.json`，经合并请求（MR）审批后放行。

每个插件都要经过信息完整性检查、隔离环境真实安装、依赖漏洞和密钥泄露扫描，通过后才会进入索引。

生成器打包成 Docker 镜像，在任意一台装了 Docker 的内网机器上按间隔运行，把三个静态文件写进共享目录，再由 nginx 对外提供。整个流程不依赖 GitLab CI 和 Pages，也不需要数据库；GitLab 只用于通过接口发现插件、托管允许名单并审批它的 MR：

| 文件 | 用途 |
|------|------|
| `index.json` | DSH 自定义插件索引，格式与 dsh.so 的 `https://cdn.dsh.so/market/top-rank.json` 相同（`format: 1`） |
| `index.html` | 浏览页：可搜索，可按风险等级和来源筛选，显示安装来源 |
| `report.json` | 全部候选插件的验证结果和排除原因，供插件作者排查 |

## 员工：在 DSH 中接入

1. 打开 DSH 插件页，启用实验插件「自定义插件索引」。
2. 进入发现页，点击「添加索引源」，填入 `http://<部署机器>:<端口>/index.json`。浏览页顶部也显示了这个地址。
3. 搜索并安装插件。

## 插件作者：发布自研插件

1. 在 GitLab 仓库的 Settings → General → Topics 中添加 `dsh-plugin`。
2. 仓库根目录需要有：
   - `README`（任意扩展名）。
   - `package.json`，包含 `name`、`version`、`description`、`engines.dsh`（声明支持的 DSH 版本范围）。`keywords` 可选，会作为浏览页的标签。
3. 下一次定时任务会收录默认分支的最新提交。没有出现在索引里时，查看 `report.json` 中对应条目的 `reasons`。

## 审批人：放行外部插件

在内网 GitLab 上建一个项目存放 `allowlist.json`（下称「名单项目」，由 `ALLOWLIST_GITLAB_PROJECT` 指定），可以直接复制本仓库的 `allowlist.json` 和 `.gitlab/CODEOWNERS` 作为起点。在名单项目中追加条目并提交 MR，`.gitlab/CODEOWNERS` 指定由审批组审核这个文件。生成器每次运行时都会从 GitLab 读取该文件在默认分支上的版本，所以 MR 合并后，下一轮生成就会生效。合并前可以在本地运行 `node bin/generate.mjs --check-allowlist --allowlist allowlist.json` 校验格式。

```json
{
  "plugins": [
    {
      "repository": "https://github.com/someone/dsh-example",
      "author": "someone",
      "approvedBy": "zhang.san",
      "descriptionZh": "可选：中文描述",
      "source": { "type": "npm", "package": "dsh-example", "version": "1.2.3" }
    },
    {
      "repository": "https://github.com/someone/dsh-other",
      "author": "someone",
      "approvedBy": "li.si",
      "source": { "type": "git", "url": "https://github.com/someone/dsh-other.git", "commit": "<40 位提交号>" }
    }
  ]
}
```

规则：

- 版本必须锁定。npm 来源写精确版本号，不能写 `^1.0.0` 这样的范围；git 来源写完整的 40 位提交号。升级外部插件需要重新提交 MR。
- `approvedBy` 必填。
- 同一来源不能重复。
- 只要有一条不合格，整个生成任务就会失败，不会发布残缺的索引。

## 验证规则

| 级别 | 检查内容 | 不通过时 |
|------|----------|----------|
| L1 已找到 | 能拉取到源码，仓库非空，有 README | 排除 |
| L2 结构化 | `package.json` 合法，含 name / version / description | 排除 |
| L3 安装规范 | 声明 `engines.dsh`；npm 来源的包名和版本与名单一致 | 排除 |
| L4 安装实测 | 在 Docker 容器中执行 `npm pack` 后真实安装。容器以非 root 用户运行，限制内存 1g、CPU 1 核、进程数 512 | 标 `install-failed`，排除 |

安全扫描：

- **依赖漏洞**：安装后在容器内运行 `npm audit`。critical 定为严重，high 定为高，moderate 定为中，其余定为低。
- **密钥泄露**：用 gitleaks 扫描插件源码。只要发现疑似密钥，风险至少定为高。报告只记录规则名、文件和行号，不记录密钥原文。
- **风险待定**：漏洞扫描没有拿到结果时记为待定（unknown），这类插件一律不放行。

放行条件：通过 L4，风险不高于 `INDEX_MAX_RISK`（默认 `medium`），并且插件名在索引中唯一（同名时只保留第一个）。

索引中的标签（`metadata.labels`）：`source-internal` / `source-external`、`install-verified`、`risk-low` / `risk-medium`。

## 部署

需要一台能访问内网 GitLab 和 npm 镜像、装了 Docker 和 Docker Compose 的机器。

1. 在内网 GitLab 上建好名单项目（见上文「审批人：放行外部插件」），不需要开启 CI 和 Pages。
2. 在部署机器上 `git clone https://github.com/futuretea/dsh-plugin-registry.git`（或内网镜像），复制配置文件：`cp deploy/.env.example deploy/.env`，然后按下表填写。
3. 启动：`docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`。
4. 查看生成日志：`docker compose -f deploy/docker-compose.yml logs -f generator`。
5. 把名单项目 `.gitlab/CODEOWNERS` 中的 `@dsh-plugin-registry-approvers` 换成实际的审批组，并在受保护分支中开启「需要代码所有者批准」。

| 变量 | 必填 | 说明 |
|------|------|------|
| `GITLAB_URL` | 是 | 内网 GitLab 地址 |
| `GITLAB_TOKEN` | 是 | 有 `read_api` + `read_repository` 权限的访问令牌，用来列出带话题的仓库、拉取源码、读取允许名单 |
| `ALLOWLIST_GITLAB_PROJECT` | 是 | 名单项目的 GitLab 路径，例如 `platform/dsh-plugin-registry` |
| `ALLOWLIST_REF` | 否 | 读取允许名单的分支，留空表示项目默认分支 |
| `NPM_REGISTRY` | 否 | 沙盒安装时使用的 npm 镜像地址 |
| `SANDBOX_IMAGE` | 否 | 沙盒镜像，默认 `node:24-alpine` |
| `INDEX_MAX_RISK` | 否 | 允许放行的最高风险等级：`low` / `medium` / `high` / `critical`，默认 `medium` |
| `DSH_PLUGIN_TOPIC` | 否 | 自研插件的话题名，默认 `dsh-plugin` |
| `GENERATE_INTERVAL` | 否 | 两次生成之间的间隔秒数，默认 21600（6 小时） |
| `MARKET_PORT` | 否 | nginx 对外端口，默认 8080 |
| `GITLEAKS_BASE_URL` | 否 | 构建镜像时下载 gitleaks 的地址，部署机器无法访问 GitHub 时改为内网镜像 |

运行方式：

- 生成器容器通过挂载 `/var/run/docker.sock` 调用宿主机的 Docker，为每个插件启动一个一次性的沙盒容器。插件源码以 tar 包形式通过标准输入传进沙盒。
- 生成失败时（例如 GitLab 不可达、允许名单格式错误），不会覆盖已发布的文件；日志里会写明失败原因。三个文件都是先写临时文件再改名，nginx 不会读到写了一半的内容。
- nginx 给 `index.json` 加了 `Access-Control-Allow-Origin: *` 响应头，DSH 网页端可以跨域读取索引。
- 不想常驻运行的话，可以改用宿主机 cron 定时执行一次：`docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm -e GENERATE_ONCE=1 generator`。这时 nginx 照常运行，换成公司已有的静态服务器也可以。
- 本地开发时，不设置 `ALLOWLIST_GITLAB_PROJECT` 就会读取本地的 `allowlist.json`（可用 `ALLOWLIST_PATH` 指定）。

## 本地开发

需要 Node.js 22 及以上版本（项目开发和验证使用 24）、git、Docker、gitleaks；也可以直接使用 `Dockerfile` 构建的镜像，里面已包含这些工具。项目没有第三方 npm 依赖。

```bash
npm test                     # 单元测试（需要 git 和 gitleaks）
npm run test:e2e             # 在真实 Docker 沙盒中安装测试（需要 Docker 和 npm 网络）
npm run lint
node bin/generate.mjs --help
node scripts/demo.mjs /tmp/dsh-demo-public   # 用演示插件跑一遍完整流程
python3 -m http.server -d /tmp/dsh-demo-public 8765   # 打开 http://127.0.0.1:8765 查看
```

代码结构：

```
bin/generate.mjs          命令行入口
src/gitlab.mjs            按话题发现自研插件
src/allowlist.mjs         读取并校验外部插件允许名单
src/fetch-source.mjs      按提交号或版本拉取插件源码
src/checks/metadata.mjs   L1–L3 检查
src/checks/install.mjs    L4 Docker 沙盒安装 + npm audit
src/checks/secrets.mjs    gitleaks 密钥扫描
src/risk.mjs              风险定档与放行判定
src/pipeline.mjs          逐个验证候选插件
src/index-format.mjs      生成与校验 DSH 索引
src/site.mjs, src/site/   静态浏览页
src/generate.mjs          串起完整流程并写出文件
deploy/                   Docker Compose、nginx 配置、循环运行脚本
```

## 已知限制

- **员工端需要能访问插件来源**：npm 镜像（或公网 npm）、内网 GitLab（自研插件要有仓库读权限），以及外部 git 插件的地址。本项目只生成索引，不代理下载。
- **索引格式依据 dsh.so 的公开清单推断**：未对照 DSH 官方文档核实，DSH 客户端是否还有其他必填字段尚不确定。
- **只验证到 L4**：不会把插件加载进 DSH 跑冒烟测试（L5），也不做模型驱动的动态安全审计。
- **沙盒需要联网**：为了从镜像安装依赖，沙盒容器没有断网，只限制了资源。
- **生成器容器能控制宿主机的 Docker**：挂载 `docker.sock` 等同于给生成器宿主机的 root 权限，所以部署机器应专门用于本服务。
- **只在本地验证过**：GitLab API 对接用模拟数据测试；Docker Compose 部署用演示数据完整跑通过，但还没有接入真实的内网 GitLab。
- **代码所有者批准需要 GitLab Premium**：版本不支持时，用受保护分支加 MR 审批规则代替。
