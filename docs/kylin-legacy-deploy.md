# 信创老机器（麒麟 glibc 2.23 等）离线部署指南

> 适用对象：银河麒麟 ARM 定制机（glibc 2.23）、CentOS 7 系 x86 机（glibc 2.17）
> 等 glibc 基线较老的信创政务机。新机器（Ubuntu 20.04+/较新麒麟）用 standard 包即可，无需读本篇。

## 一、怎么判断用哪个包

安装前在目标机执行：

```bash
ldd --version | head -1
```

| 本机 glibc | 用哪个包 |
|---|---|
| ≥ 2.28 | `agentbuddy-offline-<platform>-cp312.tar.gz`（standard） |
| 2.17 ~ 2.27 | `agentbuddy-offline-legacy-<platform>-cp312.tar.gz`（legacy） |
| < 2.17 | 均不可用（manylinux2014 基线是 2.17，需先升级系统 glibc） |

选错也没关系：`install-offline.sh` 会先做 glibc 预检，本机版本低于包内 wheel
基线时直接报错并提示改用 legacy 包，不会装一半才失败。

## 二、legacy 包与 standard 包的差异

| | standard | legacy |
|---|---|---|
| wheel 标签档 | manylinux2014 + 2_17/2_26/2_28 四档 | 仅 manylinux2014 |
| 第三方版本 | 按 `uv.lock` 原样 | 部分包降级到有 2014 档的版本（见 `scripts/offline_bundle.sh` 内 `LEGACY_PINNED` 替换表） |
| 重链功能（云存储后端 / Bedrock / 键鼠截屏 / OCR / 本地 embedding） | 可用 | **裁剪**（见下文"裁剪清单"） |
| PostgreSQL 模式 | 可用 | 可用（psycopg 钉 3.2.x 兼容版，未砍） |
| 附带 SQLite 兼容库 | 有 | 有 |
| 安装脚本 | 同一个 `install-offline.sh` | 同一个 |

### 裁剪清单（2026-11-16 extras 白名单改造起，legacy 包整链不含）

legacy 包按根包 `pyproject.toml` 的 `deploy-legacy` extras 白名单解析，四条
无 manylinux2014 轮子的重依赖链在**解析期整链排除**（不再靠下载重试逐包剔）：

| 被裁链 | 影响的功能 | legacy 部署注意事项 |
|---|---|---|
| 云存储 SDK（oss2 / 华为 OBS / 腾讯 COS） | Admin 配置 COS/OSS/OBS 云存储工作区后端 | 仍可用 **local_shell / docker / opensandbox** 后端；确需云存储时在有网机按目标平台编译后手动放入 bundle |
| AWS Bedrock（langchain-aws） | Agent 选用 Bedrock 协议 | openai/anthropic 兼容协议与国产模型不受影响；harness 对缺失 SDK 给 ImportError 安装指引 |
| remote-backends（deepagents-backends） | harness 远端 COS/S3/PG 工作区后端 | Octop 自己的数据库（SQLite/PostgreSQL）**不走此包**，部署不受影响 |
| 键鼠/截屏控制（pynput / mss） | Host 桌面键鼠注入、截屏 | legacy 为无头服务器部署本就不用；**浏览器控制（playwright CDP）不受影响** |

OCR（rapidocr/onnxruntime）与本地 embedding（fastembed）不在 legacy 包内
（standard 的 offline 包同样不带，口径一致）。搜索全家桶、Docker 沙箱、
Langfuse、ACP、browser、LDAP、MFA、office 文档处理等主体功能**全部保留**，
由 `tests/unit/test_offline_extras_whitelist.py` 守卫测试逐包断言——上游新增
依赖若把重链带回 legacy 树，该测试即红。

legacy 替换表当前降级的包（版本以表内为准，随锁定树演进复核）：
numpy、pillow、greenlet、tiktoken、argon2-cffi(-bindings)、cryptography、lxml、
psycopg 系。均为小版本降级，API 兼容；若运行时撞到个别 API 差异，优先怀疑这几个。

## 三、安装

```bash
# tar.gz 与 SHA256SUMS-legacy.txt 在同一 Release 资产里,放到同一目录再解包
# (install-offline.sh 会在 offline-legacy/ 的上一层找 SHA256SUMS-legacy.txt 做校验)
tar -xzf agentbuddy-offline-legacy-<platform>-cp312.tar.gz
bash scripts/install-offline.sh <解包目录>/offline-legacy/
```

脚本自动处理三件事：

1. **glibc 预检**（见上，硬拦截）；
2. **SQLite 兼容**：octop 迁移 SQL 使用窗口函数（`ROW_NUMBER() OVER`）与
   `RETURNING`，需要系统 SQLite ≥ 3.35。老机器的系统 SQLite 往往 < 3.25，
   脚本检测到后会启用包内预编译的 `libsqlite3.so.0`（在 manylinux2014 容器中
   构建，glibc 2.17 基线），把 venv 的 `octop` 入口包成 wrapper 注入
   `LD_LIBRARY_PATH`——前台 `octop run` 与 systemd 常驻（ExecStart 指向同一
   bin）统一生效，不动系统文件、无需手工 `systemctl edit`。
3. **零出网安装**：`pip --no-index --find-links` 全量安装 5 个主包 + 全部依赖。

## 四、兜底：现场编译 SQLite（无预编译 .so 时）

若包内没有本机架构的 `libsqlite3.so.0`（如安装脚本提示），且目标机有 gcc：

```bash
# 包内自带源码与脚本
cp <解包目录>/offline-legacy/sqlite3/sqlite-amalgamation*.zip ~/
cp <解包目录>/offline-legacy/sqlite3/build_sqlite.sh ~/
bash ~/build_sqlite.sh          # 产物: ~/agentbuddy/sqlite3-new/libsqlite3.so.0
# 然后重跑 install-offline.sh,它会检测到产物并自动包 wrapper
```

无 gcc 时需要另找编译机（同架构 ARM/x86 Linux，glibc ≤ 2.23 环境）编译后拷入。

## 五、历史背景（2026-10 现场修复记录摘要）

legacy 包源于一次麒麟 ARM（glibc 2.23）现场部署的三个坑，现均已在包内解决：

1. **glibc 基线**：锁定树部分第三方包（numpy 2.5.x、argon2-cffi-bindings 26.x
   等）只有 manylinux_2_24+ 档 wheel，glibc 2.23 无法安装 → legacy 替换表降级；
2. **系统 SQLite 过老**：`octop init` 迁移报 `near "OVER": syntax error` →
   预编译 .so + wrapper 自动注入；
3. **包与清单不一致**（bundle 放了 mcp 2.x / anthropic 2.x，代码按 1.x API 写，
   启动即崩）→ CI 闸门做"清单 vs 实际 wheel"逐项比对，防复发。

原始修复记录见仓库 `kylin-fix/`（未入库，现场档案）。

## 六、2026-11-16 改造：extras 白名单取代"剔除重试"

改造前 legacy 构建靠 `pip download` 失败→剔除→重试的循环追链：上游每次给
harness 加一个无 2014 档轮子的依赖（如云存储 SDK 链、pynput→evdev 链），
CI 就要人工补一轮剔除表，链条式暴露防不胜防。

改造后：

- 根包 `pyproject.toml` 把 harness extras 拆成两层声明——主 deps 只带轻链
  （web-search-all/docker/observability/acp），重链（bedrock / object-storage /
  desktop / remote-backends）收进 `deploy-full` extra；
- legacy 导出走 `uv export --no-all-extras --extra deploy-legacy`，重链在
  **依赖解析期**整链不进树；
- `LEGACY_PINNED`（版本钉定）与 `LEGACY_EXCLUDE`（整包剔除）保留为双保险，
  兜底 extras 声明与 pyproject 漂移；
- 守卫测试 `tests/unit/test_offline_extras_whitelist.py` 四用例：legacy 树无
  重链残留、主体功能 27 包齐全、deploy-full 能力不回退、白名单引用的 extras
  必须存在。

standard 档与 Docker（full 变体 uv sync 带 `--extra deploy-full`）行为与
v1.2.0 完全等价（导出实测 = v1.2.0 全量树 − dev 工具，零能力回退）。
