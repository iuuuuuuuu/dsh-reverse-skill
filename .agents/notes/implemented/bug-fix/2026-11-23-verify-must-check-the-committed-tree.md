# Agent Note: 校验必须量「将要提交的树」，不能量索引

Status: implemented

## Problem

`sync upstream` 定时任务从 11-14 起连续 10 次失败（#44–#53），每次都停在
「Verify the mirrored tree」，27 条 `vendored file is recorded but not tracked` /
`vendored content does not match`。后果不只是红：这一步失败后开 PR 的步骤被跳过，
**上游近两个月的更新一次都没进过仓库**，而任务本身看起来「在跑」。

根因是 `tools/verify.mjs` 的内容校验比对的是 **git 索引**（`git ls-files -s` 的 blob）：

1. 同步新镜像进来的文件在提交前是**未跟踪**的，索引里根本没有它们；
2. 上游改动过的文件，索引里躺的仍是**上一次提交的旧 blob**。

于是刚同步完的新清单被拿去和旧内容逐条比，必然全红。更糟的是反过来也成立：
**上游零漂移时这道门禁一定是绿的**——它绿的时刻恰好是没有东西可验的时刻。
它此前能过，纯粹因为上游一直没动过。

同一次复盘还暴露出第二个缺口：上游新增的可执行文件在 Windows 上从未进过索引，
`git update-index --chmod=+x` 对未跟踪路径是静默空操作，于是 PR 会把它们提交成 `100644`。

## Decision

内容校验改为对**工作树**取摘要，并且走 git 的 clean filter：
`workingTreeDigests()`（`tools/git-objects.mjs`）用一次
`git hash-object -w --stdin-paths` 拿到每个路径提交时会产生的 blob id，再交给
`digestObjects()` 算 SHA-256，与 `tools/upstream-files.json` 比对。

must：**校验对象是 PR 将要提交的那棵树**。索引只是「已经决定要提交什么」的缓存，
在「同步刚写完、还没提交」这个状态下它是过期的，不能当事实来源。

must：**摘要必须经过 git 的 clean filter，不能直接哈希磁盘字节**。
离开 filter 就退回到按工作树字节算，Windows 的 CRLF 与 blob 的 LF 会算出不同结果，
夜任务又会每晚开空 PR。

must：**可执行位在可观测的地方检查可观测的东西**。已跟踪文件看索引 mode；
未跟踪文件在 POSIX 上看文件系统执行位（这正是 `git add` 会记录的来源）；
Windows 上未跟踪文件的执行位不可观测，如实报 warning 而不是猜。

`tools/sync-upstream.mjs` 的 `applyExecutableModes()` 改为
`git update-index --add --chmod=±x`，让上游新增的可执行文件在同步时就带着位进索引。

## Alternatives considered

- **同步后先 `git add -A` 再跑 verify**（零脚本改动，最省事）— 否掉因为**修的是症状不是判据**：
  门禁仍然在量索引，只是这次恰好被喂了新内容。任何别的调用顺序（本地同步后手动
  `pnpm run verify`、以后别的 workflow、阶段顺序调整）都会复现同一个假红。
  判据本身错了，就不该靠流程给它铺路。
- **未跟踪的文件降级成 warning，只比较已跟踪的** — 看起来能立刻让 CI 变绿。
  否掉因为**假绿**：任务失败的那个状态（同步刚写完、全部未跟踪）恰好是它唯一会跳过校验的状态，
  等于门禁在最需要它的时刻闭眼。
- **直接对工作树文件算 SHA-256，不经 git** — 代码最短。
  否掉因为会原样退回更早那个坑：`core.autocrlf=true` 下工作树是 CRLF、blob 是 LF，
  Windows 与本机 Linux CI 算出不同摘要，夜任务重新变成「每晚开一个空 PR」。
- **清单改存 git object id 而不是 SHA-256** — 可以省掉 `-w` 写对象。
  否掉因为要整体改写一千多行的清单只为了少一次 `-w`，而且把清单绑到仓库的对象格式
  （sha1 / sha256）这个与「上游变了什么」无关的维度上，换不来任何额外的校验能力。

## Consequences

- **收益**：夜任务在有漂移的那一次就能自己验完并开 PR；漂移与验证不再互相排斥。
- **收益**：校验不再依赖「跑之前有没有人 add 过」，本地与 CI 走同一条路径。
- **收益**：新可执行文件的位在同步阶段就落进索引，PR 不会再把它提交成 `100644`。
- **代价与已知上限**：`-w` 会在 `.git/objects` 里留下不可达的松散对象（每次约 600 个），
  由下一次 `git gc` 清掉；换来的是不必改写清单格式。
- **代价与已知上限**：Windows 上未跟踪文件的执行位仍然验不了，只能靠 Linux CI。
- **重访信号**：若将来 runner 出现 `core fileMode=false`（文件系统执行位不再等于 git 记录的值），
  POSIX 分支的判据要改成读索引；若同步改成直接提交（不再产生未跟踪文件），
  「未跟踪」这条分支可以删掉。

## Verification

- 复现：在本机干净克隆里跑真实同步（上游已漂移）→ 旧 `verify` 报 27 条失败，与 CI 日志逐条一致。
- 修复后同一状态（全部未暂存）→ `failures: 0`。
- 故障注入证明这道门禁还能变红：改一个 vendored 文件 → `vendored content does not match`；
  删一个 → `recorded but missing from the working tree`；恢复 → `failures: 0`。
- `git ls-files -s` 确认 4 个新增可执行文件在索引里是 `100755`。
- 相关：[上游同步必须保住 git 元数据](./2026-10-25-sync-must-preserve-git-metadata.md)。
