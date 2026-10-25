# Agent Note: 同步上游时，git 元数据必须跟着保住（换行规则 + 可执行位）

Status: implemented

> **事后补记（2026-10-25）**：依据提交 `5618bdc`（`.gitattributes` 合并式写入）与
> `053dc80`（保住可执行位）与 `tools/sync-upstream.mjs` 的现有代码重建。
> 两件事合并成一篇，因为它们**同一个根因**：同步只搬文件内容，丢掉了 git 元数据。

## Problem

`tools/sync-upstream.mjs` 的做法是「按上游清单逐个取文件内容、写进本地」。
内容对了，但有两样东西不在内容里：

1. **换行规则**：本包在 `.gitattributes` 里追加了自己的一组 `text eol=lf`
   （`*.mjs` / `*.cjs` / `*.ts` / `VERSION` …）。上游同步会把这个文件整体覆盖，
   于是追加的规则**每次同步都消失** —— 表现是本地文件突然变成 CRLF、diff 全是噪音。
2. **可执行位**：上游树里 `100755` 的文件（`kali/scripts/*.sh`、`skills/scripts/*.sh`）
   在同步后丢掉执行位。git 把它记在 tree 里，但文件系统不保证能表示它，
   所以「抄一份工作副本」这条路径天然会丢。

两者都不会让同步报错——**静默丢元数据**，下一次有人跑脚本才发现 `Permission denied`，
或者看到满屏只有行尾差异的 diff。

## Decision

1. **`.gitattributes` 用「标记段合并」而不是整文件覆盖**：
   `GITATTRIBUTES_MARKER = '# --- dsh-reverse-skill additions'` 之上是上游原文，
   之下是本包的追加段；同步时只替换标记线以上的部分，追加段原样保留。
2. **可执行位从上游的 git tree 里读，不从工作副本推断**：
   `git ls-files -s -z` 取 mode，只保留 `100755` 且**属于 vendored 集合**的路径，
   同步写完内容后再 `chmodSync` 补上执行位。

`must`：**元数据要「显式记录」而不是「从当前状态推断」。** 代码注释里那句
「not every filesystem can represent it, so the mode is tracked explicitly」
就是这条：靠工作副本的权限位判断，在 Windows / 某些挂载上是错的。

`must`：**只对 vendored 集合内的路径补执行位。** 上游树里还有本包不收录的文件，
不加限制会顺手改掉仓库里别的脚本的权限。

## Alternatives considered

- **同步后再手工 `git update-index --chmod=+x`** —— 零代码改动。**否掉因为它靠人记得**：
  每次同步都要记得跑一遍；忘了的表现是「脚本在 CI 上 Permission denied」，
  而本地因为换行/权限宽松根本复现不出来。
- **让 `.gitattributes` 只由本包维护、不参与上游同步** —— 简单。**否掉因为上游那份也在变**：
  上游新增规则（比如某个新后缀）时本包会漏掉，于是同一类文件在上游是 LF、在本地不是。
  「完全接管」与「完全跟随」都会分叉，只有分段合并能同时跟上两边。
- **同步时保留整个工作副本的权限位（`preserveMode` 之类）** —— 不依赖上游 git。**否掉因为方向反了**：
  工作副本的权限是**上次同步的结果**，用它推「上游要求什么」是循环论证；
  上游的 tree 才是事实来源。

## Consequences

- **收益**：反复同步不会再把行尾规则与执行位洗掉；CI 上不会出现「本地能跑、CI Permission denied」。
- **收益**：判据来自上游 git tree（事实），不来自工作副本（上次的结果）。
- **代价与已知上限**：`.gitattributes` 现在有**两个来源**（上游段 + 本包追加段），
  标记线写坏了就会退化成整文件覆盖 —— 目前没有门禁校验这条标记线存在。
- **代价与已知上限**：可执行位只在 `git ls-files -s` 能读到时才补得上；
  上游若改成 submodule 或 tar 分发，这条路要重写。
- **代价与已知上限**：`chmodSync` 在 Windows 上基本是空操作，FCB 的只读位不等于 unix 权限。
  也就是说**Windows 上验证不了这条修复**，只能靠 CI（Linux）确认。

## Verification

- `tools/sync-upstream.mjs` 新增 `GITATTRIBUTES_MARKER` / `GITATTRIBUTES_ADDITIONS`
  与 `executablePaths()`；
- 同步后 `.gitattributes` 的追加段仍在（本地可验）；
- 可执行位在 Linux CI 上可验（Windows 本地验不了，见上文代价）。
