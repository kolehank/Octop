# 离线包覆盖升级运维手册（offline → 新版本）

> 适用于已经用 `agentbuddy-offline-*.tar.gz` 部署过 Octop、现在要升级到新版本离线包的场景（standard / legacy 通用）。
> 首次安装见 `docs/kylin-legacy-deploy.md`。信创老机器（glibc 2.17~2.27）继续选 legacy 包。

## 一、核心原则：升级只换代码，不动数据

| 归属 | 位置 | 升级时 |
|---|---|---|
| **数据**（必须保留） | `$AGENTBUDDY_HOME`：`agentbuddy.db`、`config.json`、`agents/`、`plugins/`、`logs/` | 原地保留，升级全程不删不改 |
| **代码** | `$AGENTBUDDY_HOME/venv`（默认） | 覆盖安装或换新 venv |
| **服务进程** | systemd unit `octop`（`octop service`） | **装完必须重启** |

> ⚠️ 三条铁律，缺一不可：
> 1. **先停服务再装包**——装着旧代码的进程继续处理消息会引用已删除的模块（见 §五 真实事故）；
> 2. **装完必须重启服务**——`install-offline.sh` 只替换磁盘文件，不碰运行中的进程；
> 3. **同版本号覆盖要卸载后装**——wheel 版本号是上游号（如 `1.0.3b5`），白标跨版本升级时可能相同，pip 会判定 `Requirement already satisfied` 而**静默跳过**。

## 二、升级前：确认版本 + 备份

```bash
# 按实际部署替换（默认 $HOME/.agentbuddy）
export AGENTBUDDY_HOME="${AGENTBUDDY_HOME:-$HOME/.agentbuddy}"
export AGENTBUDDY_VENV="${AGENTBUDDY_VENV:-$AGENTBUDDY_HOME/venv}"

# ① 当前版本（升级后用于对比）
"$AGENTBUDDY_VENV/bin/octop" --version

# ② 备份数据（停服务后备份最稳；SQLite 记得连 -wal/-shm 一起）
mkdir -p ~/agentbuddy-backup-$(date +%Y%m%d)
cp -a "$AGENTBUDDY_HOME/agentbuddy.db"* "$AGENTBUDDY_HOME/config.json" \
      "$AGENTBUDDY_HOME/agents" "$AGENTBUDDY_HOME/plugins" \
      ~/agentbuddy-backup-$(date +%Y%m%d)/ 2>/dev/null

# ③ 记下旧包位置（回滚用），旧 venv 保留不动
ls ~/agentbuddy-backup-$(date +%Y%m%d)/
```

## 三、标准升级流程（五步）

```bash
# —— 0) 解包新版本 ——
tar -xzf agentbuddy-offline-<platform>-cp312.tar.gz -C /tmp/upgrade/
# 得到 /tmp/upgrade/offline/ 与 /tmp/upgrade/scripts/install-offline.sh

# —— 1) 停服务（必须第一步做）——
"$AGENTBUDDY_VENV/bin/octop" service stop
# 若提示未安装服务，说明是手工前台/nohup 启动的，改用：
#   pkill -f "octop run"    # 确认 ps -eo pid,lstart,cmd | grep "octop run" 无残留

# —— 2) 卸载旧主包（避免同版本号被 pip 跳过）——
"$AGENTBUDDY_VENV/bin/pip" uninstall -y \
  octop octop-harness octop-gateway octop-memory octop-browser

# —— 3) 装新包（复用同一 venv；第三方依赖已在，仅覆盖主包）——
bash /tmp/upgrade/scripts/install-offline.sh /tmp/upgrade/offline/
# 脚本自带 glibc 预检 + SHA256 校验 + 零出网安装；看到 Installed: ... 即成功

# —— 4) 重启服务（本手册最重要的一步）——
"$AGENTBUDDY_VENV/bin/octop" service restart
# 手工启动的部署：按原方式重新拉起（如 nohup "$AGENTBUDDY_VENV/bin/octop" run --host 0.0.0.0 --port 8088 &）

# —— 5) 验证（五项全过才算升级完成）——
"$AGENTBUDDY_VENV/bin/octop" --version                    # ① 版本已变
curl -s http://127.0.0.1:8088/api/health | head -c 300    # ② 健康检查返回 ok
ps -eo pid,lstart,cmd | grep "octop run" | grep -v grep   # ③ 进程启动时间晚于装包时间
tail -50 "$AGENTBUDDY_HOME/logs/agentbuddy.log"           # ④ 日志无 Traceback
# ⑤ 界面实操：给专家/Agent 发一条测试消息，确认有回复
```

## 四、venv 复用 vs 全新 venv

| | 复用原 venv（§三流程） | 全新 venv（问题排查/大版本跳跃时） |
|---|---|---|
| 速度 | 快（只覆盖主包） | 慢（全量装依赖） |
| 残留风险 | 旧 Python 模块文件残留（pip 不删 wheel 外文件） | 无残留，最干净 |
| 适用 | 日常升级 | 升级后出现 `ModuleNotFoundError`、行为诡异，或跨多个大版本 |

全新 venv 做法（数据不动）：

```bash
export AGENTBUDDY_HOME="${AGENTBUDDY_HOME:-$HOME/.agentbuddy}"
AGENTBUDDY_VENV="$AGENTBUDDY_HOME/venv-$(date +%Y%m%d)" \
  bash /tmp/upgrade/scripts/install-offline.sh /tmp/upgrade/offline/

# ⚠️ systemd unit 的 ExecStart 指向 $AGENTBUDDY_HOME/venv/bin/octop；
#    换 venv 路径后必须重新生成服务：
"$AGENTBUDDY_HOME/venv-$(date +%Y%m%d)/bin/octop" service start
# 或旧的 octop service stop 后，用新 venv 的 octop service start --force-install
```

> 不建议在升级时改动 `AGENTBUDDY_HOME`（数据目录）——那等于换数据库，另按迁移流程处理。

## 五、真实事故案例（2026-11-16）：覆盖安装没重启

**现象**：覆盖安装 v1.2.0 后，给专家发消息报 `模型调用失败：No module named 'octop.infra.history.recorder'`。

**排查**：磁盘上代码完全正常（新包 0 处引用 `recorder`），但报错进程加载的是**旧版 v1.0.13 代码**——旧 `processor.py` 在**处理函数内懒加载** `from octop.infra.history.recorder import ...`；覆盖安装删掉了 `recorder.py`，运行中的旧进程每次走到这行就去磁盘找 → `ModuleNotFoundError`。

**根因**：`install-offline.sh` 只替换磁盘文件，**不重启运行中的服务**。

**修复**：`octop service restart` 即恢复。教训 → 本手册 §一 铁律 1/2。

## 六、回滚（升级后不可用）

数据未动，回滚只需换回旧代码：

```bash
# 1) 停服务
"$AGENTBUDDY_VENV/bin/octop" service stop
# 2) 用旧版本 offline 包重跑 §三 的步骤 2~4（卸载主包 → 装旧包 → 重启）
# 3) 若新版本已改过数据库结构且无法回退，恢复备份：
#    cp -a ~/agentbuddy-backup-<日期>/agentbuddy.db* "$AGENTBUDDY_HOME/"
#    （恢复数据库前先停服务；恢复后重启）
```

> 保留至少一份上一版本 offline tar.gz 与升级前的数据备份，直到新版本稳定运行一周。

## 七、一页速查

```bash
export AGENTBUDDY_VENV=${AGENTBUDDY_VENV:-$HOME/.agentbuddy/venv}
tar -xzf agentbuddy-offline-*.tar.gz -C /tmp/upgrade/
"$AGENTBUDDY_VENV/bin/octop" --version                 # 升级前记版本
"$AGENTBUDDY_VENV/bin/octop" service stop              # ① 停
"$AGENTBUDDY_VENV/bin/pip" uninstall -y octop octop-harness octop-gateway octop-memory octop-browser
bash /tmp/upgrade/scripts/install-offline.sh /tmp/upgrade/offline/   # ② 装
"$AGENTBUDDY_VENV/bin/octop" service restart           # ③ 重启（别忘）
curl -s http://127.0.0.1:8088/api/health               # ④ 验证
```
