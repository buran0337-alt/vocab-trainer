# CET-6 Vocabulary Trainer 数据模型

**文档版本：** v1.6  
**对应需求：** `REQUIREMENTS.md` v2.8  
**对应计划：** `DEVELOPMENT_PLAN.md` v3.1  
**规则基准：** `RULE_DECISIONS.md` v2.0（R01–R32）  
**实现位置：** `src/data/`

---

## 1. 范围和边界

本数据模型建立 IndexedDB 数据结构、数据访问仓库、通用北京时间转换和事务保护。阶段 3 和阶段 4 已将单词库及导入页面接入仓库；阶段 5 增加了独立复习算法；阶段 6 已接入学习页面和反馈持久化；阶段 7 已接入每日任务和基础统计；阶段 8 已接入分组、分组反馈和独立单词检验；阶段 9 已接入薄弱词计算、排序、反馈和统计；阶段 10 已接入完整备份与恢复；阶段 11 已接入统计与可视化分析。

页面组件不直接访问 IndexedDB；单词库、导入、学习、薄弱词、分组、统计和备份恢复分别通过对应服务调用仓库。

独立单词检验通过 `WordInspectionService` 的窄接口只读单词、分组和分组关系；它不持有复习状态、学习历史或每日任务仓库，也不写入任何 object store。

阶段 10 已通过 `BackupRepository` 实现七类数据的完整快照读取和原子覆盖恢复，未改变 object store、字段、索引或数据库版本。

阶段 11 的 `LearningAnalyticsService` 是只读聚合服务。它一次读取单词、分组、关联、复习状态和全部学习历史，复用现有全局完成分类、北京时间日期和薄弱分函数，不新增持久化字段。

## 2. 时间表示

| 类型 | 表示方式 | 用途 |
|---|---|---|
| 精确时刻 | Unix epoch 毫秒整数，字段名以 `AtMs` 结尾 | 创建时间、修改时间、点击反馈时间、上次反馈时间、下次到期时间 |
| 北京日期 | `YYYY-MM-DD` 字符串 | 每日任务归属、学习历史按日统计 |
| 间隔 | `intervalMinutes`，整数分钟；无值时为 `null` | 统一表示 10 分钟和整天间隔，避免同时混用秒、小时和天 |

北京时间日期由 `Intl.DateTimeFormat` 按固定时区 `Asia/Shanghai` 计算，不读取设备本地时区。学习历史的 `beijingDate` 由仓库接收点击反馈时间后自动生成，调用者不能单独伪造日期归属。

## 3. 实体关系

```text
Word 1 ─── 0..1 ReviewState
  │
  └── 0..N WordGroup N ─── 1 Group

Word 1 ─── 0..N LearningHistory
Group 1 ── 0..N WordGroup

DailyTask       按北京日期独立保存全局每日任务快照
AppSettings     单例保存每日基础目标和固定时区
```

关键关系：

- 一个单词最多一份复习状态。
- 一个单词可以属于多个分组，同一分组也可包含多个单词。
- 同一单词与同一分组最多一条 `WordGroup` 关联。
- 分组关联只连接单词和分组，不保存独立学习进度。
- 学习历史引用单词；分组学习历史额外保存当时的分组 ID。
- 删除单词时会同时删除其关联、复习状态和学习历史。
- 删除分组时只删除分组和关联，不删除单词或复习状态；既有历史记录作为事实保留。
- 每日任务的完成 ID 集合只记录全局任务，分组学习统计通过学习历史的 `source`、`groupId` 和 `beijingDate` 区分。

## 4. IndexedDB 基本信息

| 项目 | 当前值 |
|---|---|
| 数据库名称 | `cet6-vocabulary-trainer` |
| 当前数据库版本 | `1` |
| 备份格式版本 | `1` |
| 时区 | `Asia/Shanghai` |
| 迁移入口 | `src/data/database.ts` 中的 `DATABASE_MIGRATIONS` |

打开数据库只执行缺失版本的迁移，不会清空或重建已有数据库。未来增加结构时，必须新增迁移版本，不能修改已经发布的旧迁移步骤。

### 4.1 备份文件结构

当前备份为 UTF-8 JSON，顶层字段如下：

```text
format: "cet6-vocabulary-trainer-backup"
backupVersion: 1
databaseVersion: 1
exportedAtMs: epoch 毫秒整数
data:
  words
  groups
  wordGroups
  reviewStates
  learningHistory
  dailyTasks
  settings
```

恢复只接受当前备份版本和数据库版本；未来版本及无法迁移的旧版本会被拒绝。活动关联必须有效：`wordGroups` 必须引用现有单词和分组，`reviewStates` 与 `learningHistory` 必须引用现有单词。分组学习历史允许保留已删除分组的来源 ID，因为删除分组规则要求历史事实继续存在。备份文件上限为 25 MiB。

## 5. Object Store

### 5.1 `words`

主键：`id`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定唯一 ID，由安全随机 UUID 生成 |
| `displayWord` | string | 首次录入的显示形式；主动编辑成功后采用新输入；最多 100 个字符 |
| `normalizedWord` | string | 去首尾空格、全角英文字母转半角、忽略大小写后的去重键 |
| `chineseMeaning` | string | 完整中文释义，可包含多个义项；最多 2000 个字符 |
| `createdAtMs` | number | 创建时刻，epoch 毫秒 |
| `updatedAtMs` | number | 最后修改时刻，epoch 毫秒 |

索引：

- `byNormalizedWord`：唯一索引，从根源阻止标准化形式重复。
- `byCreatedAtMs`：按创建时间查询。

不同词形不会被词形还原，例如 `study` 与 `studies` 是两条独立记录。

手动添加单词只创建 `Word`，不会提前创建复习状态或伪造学习历史；因此新词在详情中显示“尚未开始学习”。

### 5.2 `groups`

主键：`id`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定唯一 ID |
| `name` | string | 去除首尾空格后的非空名称；最多 50 个字符；内部和大小写保持不变 |
| `createdAtMs` | number | 创建时刻，epoch 毫秒 |
| `updatedAtMs` | number | 最后修改时刻，epoch 毫秒 |

索引：

- `byName`：唯一索引，名称比较区分大小写。
- `byCreatedAtMs`：按创建时间查询。

空名称和超过 50 个字符的名称由数据写入入口拒绝。

### 5.3 `wordGroups`

主键：`id`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 关联记录唯一 ID |
| `wordId` | string | 现有单词 ID |
| `groupId` | string | 现有分组 ID |
| `createdAtMs` | number | 建立关联时刻 |

索引：

- `byWordGroup`：`[wordId, groupId]` 唯一复合索引，阻止重复关联。
- `byWordId`：查询某单词的全部分组。
- `byGroupId`：查询某分组的全部单词。

新增关联时会校验单词和分组都存在。删除关联不影响两侧实体或复习状态。

### 5.4 `reviewStates`

主键：`wordId`

| 字段 | 类型 | 说明 |
|---|---|---|
| `wordId` | string | 单词 ID；主键保证每词仅一份状态 |
| `ef` | number | 初始 `2.5`，最低 `1.3`，存储数值不附加文本格式 |
| `consecutiveSuccesses` | number | 连续成功次数 |
| `consecutiveForgets` | number | 连续忘记次数 |
| `weakScore` | number | 全部历史累计薄弱分，不等于当前 EF 或连续状态 |
| `intervalMinutes` | number \| null | 上次间隔，分钟；未安排时为 `null` |
| `lastFeedbackAtMs` | number \| null | 上次反馈时刻；无记录时为 `null` |
| `nextReviewAtMs` | number \| null | 下次到期时刻；尚未安排时为 `null` |
| `createdAtMs` | number | 创建时刻 |
| `updatedAtMs` | number | 最后修改时刻 |

索引：

- `byNextReviewAtMs`：查询已有到期时间的复习状态。
- `byUpdatedAtMs`：按更新时间查询。

本数据模型只定义复习状态字段。EF 更新、连续次数转换、间隔和到期时间由 `src/features/review/reviewAlgorithm.ts` 的纯函数计算；学习页面通过 `LearningSessionService` 调用这些函数，再由数据层原子写入历史与状态。阶段 5 和阶段 6 没有改变数据库结构或版本。

薄弱词页面从全部 `learningHistory` 重新累计薄弱分，并以该词唯一 `ReviewState` 中的连续忘记次数、EF、上次反馈时间和到期时间参与排序。`weakScore` 字段继续由复习算法维护，便于后续备份覆盖最终状态；页面展示值以完整历史计算为准。

### 5.5 `learningHistory`

主键：`id`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 每次反馈的唯一历史 ID |
| `wordId` | string | 学习单词 ID |
| `mode` | `english-to-chinese` \| `chinese-to-english` | 学习模式 |
| `source` | `global` \| `group` \| `weak` | 学习来源 |
| `groupId` | string \| null | 分组学习的来源分组；其他来源为 `null` |
| `feedback` | `forgotten` \| `fuzzy` \| `remembered` | 对应忘记、模糊、记住 |
| `feedbackOccurredAtMs` | number | 用户点击反馈时的 epoch 毫秒 |
| `beijingDate` | string | 由反馈时间计算的北京时间日期 |
| `stateBefore` | ReviewStateSnapshot \| null | 本次反馈前关键值 |
| `stateAfter` | ReviewStateSnapshot \| null | 本次反馈后关键值 |

`ReviewStateSnapshot` 分别保存：

- `ef`
- `consecutiveSuccesses`
- `consecutiveForgets`
- `weakScore`
- `intervalMinutes`
- `lastFeedbackAtMs`
- `nextReviewAtMs`

其中每个字段均可为 `null`，用于表示该事实当时不存在或不适用；不使用 0 或虚构日期冒充真实值。

索引：

- `byWordId`：查询某词全部历史。
- `byWordAndFeedbackAt`：`[wordId, feedbackOccurredAtMs]`，按单词和时间查询。
- `byFeedbackAtMs`：按反馈时间查询。
- `byBeijingDate`：按北京日期查询。
- `bySourceAndBeijingDate`：按学习来源和北京日期查询。
- `byGroupId`：按来源分组查询历史。

历史记录只有新增和读取接口，不提供修改接口。更新当前复习状态不会改写既有历史。

### 5.6 `dailyTasks`

主键：`beijingDate`

| 字段 | 类型 | 说明 |
|---|---|---|
| `beijingDate` | string | `YYYY-MM-DD`，同时作为主键 |
| `baseGoal` | number | 当日基础目标，0–999 整数 |
| `carryoverTasks` | number | 当日开始时已有结转量 |
| `nominalTaskCount` | number | 名义任务量 |
| `effectiveTaskCount` | number | 有效任务量 |
| `completedCount` | number | 已完成量 |
| `completedGlobalNewWordIds` | string[] | 当日全局新词完成去重集合 |
| `completedGlobalReviewWordIds` | string[] | 当日全局复习完成去重集合 |
| `createdAtMs` | number | 创建时刻 |
| `updatedAtMs` | number | 更新时刻 |

索引：

- 主键 `beijingDate` 支持按日期直接查询。
- `byUpdatedAtMs`：按更新时间查询。

两个 ID 集合都只记录全局任务。分组学习不得加入这两个集合；其独立统计使用 `learningHistory` 的来源、分组 ID 和日期索引。

本阶段只保存输入快照，不计算任务数量。

### 5.7 `settings`

主键：`id`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 固定单例 ID `app-settings` |
| `dailyBaseGoal` | number | 每日基础目标，0–999 整数 |
| `timeZone` | `Asia/Shanghai` | 固定业务时区 |
| `createdAtMs` | number | 创建时刻 |
| `updatedAtMs` | number | 更新时刻 |

数据库不会自动写入默认目标，避免替用户决定初始值。第一次使用时由后续设置流程明确创建。

## 6. 数据访问接口

统一仓库入口为：

```ts
const repositories = createRepositories(database);
```

主要接口：

| 仓库 | 接口 |
|---|---|
| `words` | `create`、`getById`、`requireById`、`getByNormalizedWord`、`list`、`update`、`delete`、`applyImportBatch` |
| `groups` | `create`、`getById`、`getByName`、`list`、`update`、`delete` |
| `wordGroups` | `add`、`addMany`、`getById`、`getByPair`、`listForWord`、`listForGroup`、`listAll`、`getWordsForGroup`、`getGroupsForWord`、`remove` |
| `reviewStates` | `create`、`getByWordId`、`listDueAt`、`update` |
| `learningHistory` | `add`、`getById`、`listAll`、`listForWord`、`countForWord`、`listByBeijingDate`、`listBySourceAndDate`、`listForGroup` |
| `learningSessions` | `commitFeedback`：在同一事务中写入一条历史并更新对应复习状态 |
| `dailyTasks` | `create`、`getByDate`、`list`、`update` |
| `dailyProgress` | `saveTask`、`saveGoalAndTask` |
| `settings` | `get`、`create`、`updateDailyBaseGoal` |
| `backup` | `readSnapshot`、`replaceSnapshot` |

错误类型位于 `src/data/errors.ts`：

- `DataValidationError`：字段或格式无效。
- `DataConflictError`：唯一约束或重复关联。
- `DataNotFoundError`：更新或关联目标不存在。
- `DatabaseOpenError`：数据库打开或迁移失败。
- `DataOperationError`：事务或其他存储操作失败。

## 7. 事务规则

- 创建、修改、删除及关联校验在读写事务中完成。
- 删除单词在一个事务中清理单词、分组关联、复习状态和学习历史。
- 删除分组在一个事务中清理分组和关联。
- Excel/CSV 导入的最终新增与释义更新通过 `applyImportBatch` 在同一个 `words` 事务中提交；更新动作只改中文释义。
- 每次学习反馈通过 `learningSessions.commitFeedback` 在同一个事务中写入学习历史和复习状态；相同历史 ID 只允许幂等重放，不重复保存。
- 阶段 7 起，全局学习反馈还会在同一事务中写入当天 `DailyTask` 快照；每日目标与当天任务也通过同一事务保存。
- 阶段 8 的分组反馈在同一事务中检查分组和成员有效性；它不写 `DailyTask`，但仍更新共享复习状态和学习历史。
- 阶段 9 的薄弱反馈写 `source = weak`，不关联分组；历史、唯一复习状态和当天全局复习快照在同一事务中提交。
- 完整备份导出在覆盖 `words`、`groups`、`wordGroups`、`reviewStates`、`learningHistory`、`dailyTasks`、`settings` 的只读事务中读取一致快照。
- 完整覆盖恢复在同一组七个 store 的读写事务中先清空再写入，并逐表读回核对；任一错误中止事务，旧数据保持可用。
- 通用 `runTransaction` 在回调失败时请求回滚；测试会验证多个 store 都不留下部分数据。
- 写操作先读取现有记录再写入，同时仍由唯一索引提供数据库级兜底。

## 8. 测试

测试使用 Vitest、`fake-indexeddb` 和独立数据库名称。每个测试结束后关闭连接并删除测试数据库，不接触浏览器真实词库。

测试覆盖：

- 建库、全部 object store 和升级入口。
- 单词标准化、显示形式、去重和不同词形。
- 分组名称去空格、大小写敏感和唯一约束。
- 单词/分组关联唯一，以及关联删除不伤及实体。
- 复习状态唯一、初始 EF 和与单词修改隔离。
- 多条学习历史独立保存、日期索引和状态更新不改历史。
- 每日任务读写和 ID 集合校验。
- 北京时间跨日边界。
- 多 store 事务回滚。
- 关闭重开后数据持久化。
- 删除单词或分组的级联边界。
- `.xlsx`、`.xls`、UTF-8/UTF-16 CSV 和 Excel 多工作表解析。
- 导入冲突分类、逐项决策、重复导入和原子批次回滚。
- 薄弱分全历史累计、五级稳定排序、共享反馈、同日复习去重、幂等重试、并发冲突和北京时间跨日。
- 完整备份格式、空数据、特殊字符、非法文件、缺失字段、重复主键、关联错误、未来版本、文件大小和失败回滚。
- 统计时间范围、全局任务去重、分组隔离、反馈比例、薄弱词趋势、空数据和北京时间跨日。

运行：

```powershell
npm run test
```

## 9. 仍待确认

以下问题不由本数据模型擅自解决：

1. 旧版备份迁移范围。
2. 是否需要为超大数据文件增加固定大小上限或后台解析。

