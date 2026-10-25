
# 家庭共享记账

基于微信小程序 + 微信云开发的多人共用记账工具。一个账本多人共享，邀请家人加入后共同记录、共同查看，无自建服务器。

## 功能

**记一笔（首页）**
- 收入 / 支出切换，数字键盘，分类网格，日期与备注
- 离线可用：无网时先落本地队列，联网后自动补写（按 `clientTxnId` 幂等，重放不会产生重复账单）
- 金额遮罩：可一键隐藏页面上的金额

**账单**
- 按日分组，按月切换，上拉分页加载
- 月度合计（收入 / 支出 / 结余）与月度预算进度
- 单笔编辑、删除

**统计**
- 当月分类占比环形图（与账本图标共用一套 10 色莫兰迪色板）
- 近 6 个月收支趋势柱状图
- 支持切换月份查看

**分类管理**
- 内置 12 个分类 + 自定义（上限 30）
- 名称、图标、类型可改；已记过账的分类不可删除
- 可一键恢复默认分类

**账本与成员**
- 多账本（上限 10），随时切换
- 邀请码加入：6 位，7 天有效，可随时刷新；支持扫码或手动输入
- 成员上限 5 人；房主可移除成员，成员可自行退出
- 删除账本会连带删除该账本下的全部账单，且至少保留一个账本
- 房主可清空本账本全部账单（账本与分类保留）

**设置**
- 货币符号（6 选一）
- 月度支出预算
- 导出 CSV：可选日期范围，单次上限 10000 笔，Excel / WPS 可直接打开，含合计行
- 导出文件存于云存储，通过临时链接下载或发送到微信

## 技术架构

- 前端：微信小程序原生（无框架），7 个页面，底部 3 个 tab（记一笔 / 账单 / 统计）
- 后端：4 个云开发云函数（ledger / bill / member / export）
- 数据：云数据库 3 个集合（ledgers / members / bills）
- 文件：云存储，导出 CSV 存放于 `exports/{openid}/`，**私有权限**，由云函数签发临时链接下载

```
miniprogram-1/
├── app.js / app.json / app.wxss      全局（app.wxss 定义全站设计 token）
├── pages/
│   ├── record/      记一笔（tab）
│   ├── list/        账单（tab）
│   ├── stats/       统计（tab）
│   ├── category/    分类管理
│   ├── member/      成员与邀请
│   ├── ledger/      账本管理
│   └── settings/    设置
├── utils/
│   ├── api.js       云函数调用封装 + 错误码转人话提示
│   ├── store.js     本地缓存（仅用于离线可用与首屏，不作权限依据）
│   ├── fen.js       分 / 元转换（金额一律以「分」存储）
│   ├── shanghai.js  北京时间工具（月区间、日期换算）
│   ├── colors.js    色板单一数据源（账本图标与统计环形图共用）
│   ├── emoji.js     分类图标白名单（与服务端保持一致）
│   ├── currency.js  货币符号
│   ├── queue.js     离线队列
│   ├── bus.js       页面间事件（账单变更后刷新）
│   └── tip.js       「!」辅助说明的统一弹窗
├── components/privacy-mask/          金额遮罩组件
└── cloudfunctions/
    ├── ledger/      账本、分类、货币、预算、清空账单
    ├── bill/        账单增删改查、汇总、趋势、离线同步
    ├── member/      加入 / 移除 / 退出 / 邀请码
    └── export/      CSV 导出
```

## 数据模型

**ledgers** 账本

| 字段 | 说明 |
|---|---|
| `name` / `ownerOpenid` / `iconColor` | 名称、房主 openid、图标颜色 |
| `inviteCode` / `inviteCodeUpdatedAt` | 6 位邀请码及其签发时间（7 天有效） |
| `currency` / `monthlyBudgetFen` | 货币符号、月度预算（分，null 表示未设置） |
| `categories` | 分类数组（id / 名称 / 图标 / 类型 / 是否内置） |

**members** 成员（一人一账本一条记录）

| 字段 | 说明 |
|---|---|
| `ledgerId` / `openid` / `role` | 账本、用户、角色（owner / member） |
| `isCurrent` | 是否为该用户当前使用的账本 |
| `status` | active / removed——退出与被移除只改状态，文档保留 |
| `nickname` / `joinedAt` | 昵称、加入时间 |

**bills** 账单

| 字段 | 说明 |
|---|---|
| `ledgerId` / `occuredAt` | 所属账本、发生时间（UTC 存储，按北京时间换算） |
| `type` / `amountFen` / `categoryId` | 收 / 支、金额（分）、分类 |
| `note` / `clientTxnId` | 备注（≤100 字）、客户端幂等 ID（可为空） |

## 云函数接口

| 云函数 | action | 权限 | 说明 |
|---|---|---|---|
| ledger | `initUser` | 公开 | 首次进入初始化默认账本 |
| | `listMyLedgers` | 本人 | 我的账本列表 |
| | `createLedger` / `switchLedger` / `deleteLedger` | 本人 / 本人 / 房主 | 建、切、删（删账本连带删账单，至少保留一个） |
| | `addCategory` / `updateCategory` / `deleteCategory` / `restoreDefaults` | 成员 | 分类增删改、恢复默认 |
| | `updateSettings` | 成员 | 货币符号、月度预算 |
| | `clearBills` | 房主 | 清空本账本全部账单 |
| bill | `addBill` / `updateBill` / `deleteBill` | 成员 | 账单增删改（含幂等） |
| | `listBills` / `monthSummary` | 成员 | 账单分页、月度合计 |
| | `categoryStats` / `monthlyTrends` | 成员 | 分类占比、月度趋势 |
| | `syncPending` | 成员 | 离线队列批量补写 |
| member | `joinLedger` | 本人 | 邀请码加入（复用历史记录，重复加入只做切换） |
| | `listMembers` | 成员 | 成员列表（不返回他人 openid） |
| | `removeMember` / `leaveLedger` | 房主 / 本人 | 移除成员、退出账本 |
| | `rotateInvite` | 房主 | 刷新邀请码 |
| export | `exportLedger` | 成员 | 生成 CSV 上传云存储，返回临时下载链接 |

四个云函数均提供 `ping` 用于环境自检。

## 部署

1. 开发者工具打开项目，在 `app.js` 的 `CLOUD_ENV` 填入云环境 ID
2. 四个云函数各自右键「上传并部署：云端安装依赖」（`ledger` 与 `export` 带 `config.json`，超时设为 60 秒）
3. 数据库建索引——**全部为普通索引，不要勾唯一**：
   - members：`(ledgerId, openid, status)`、`(openid, status)`、`(ledgerId, status)`
   - bills：`(ledgerId, occuredAt)`、`(ledgerId, clientTxnId)`、`(ledgerId, categoryId)`
   - ledgers：`inviteCode`
4. 云存储权限设为「所有用户不可读写（仅管理端可读写）」，导出文件由云函数签发临时链接下载

## 开发约定

- **金额一律以「分」存整数**，只在展示层用 `fen.js` 转成元，避免浮点误差
- **时间一律按北京时间**处理，`shanghai.js` 负责本地时间与 UTC 的换算。账单字段写作 `occuredAt`（少一个 r，已入库，**不要顺手改成 occurredAt**）
- **权限只在云函数校验**：`assertMember`（账本成员）/ `assertOwner`（房主）。前端 `store.js` 的缓存仅用于离线与首屏秒开，不能作为权限依据
- **颜色单一数据源**：`utils/colors.js`，账本图标与统计环形图共用同一套色板；服务端 `LEDGER_COLORS` 白名单必须与之同步
- **错误提示面向用户**：`utils/api.js` 的 `CODE_HINT` / `FAIL_HINT` 把错误码翻译成人话，不暴露云环境、集合、日志等开发者细节；排查真实原因看云函数日志
- 上限常量在云函数内：成员 5 人、账本 10 个、分类 30 个、单次导出 10000 笔

## 上架须知

需先完成小程序备案；服务类目选「工具 - 记账」；**用户隐私保护指引必须勾选「剪贴板」**——成员页使用 `wx.getClipboardData` 粘贴邀请码。位置、相册、麦克风、摄像头、用户信息等接口均未使用，无需勾选。
