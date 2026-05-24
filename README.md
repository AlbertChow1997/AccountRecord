# 三人记账系统

一个面向 T、A、C 三个用户的简易记账系统。前端使用 React 19，后端使用 Vercel Python Serverless Function，并通过 Vercel KV 保存多人共享账本。

## 功能

- 录入金额、日期、付款人和备注
- 支持三人均分，或 T 与 A 均分
- 每次新增或删除交易后自动刷新本周每个人的应付款
- 首页展示历史每周每人的应付、应收情况
- 交易记录保存到 Vercel KV，多人打开同一个部署地址会看到同一份数据

## 本地运行

```bash
npm install
npm run dev
```

只运行 Vite 时，前端页面可以打开，但 `/api/ledger` 需要 Vercel 的 serverless 运行环境。完整本地调试推荐使用：

```bash
vercel dev
```

如果本地没有配置 KV 环境变量，后端会临时使用 `/tmp/account-record-transactions.json` 保存数据，方便调试。

## 部署到 Vercel

1. 在 Vercel 项目中进入 Storage，创建一个 KV 数据库并连接到当前项目。
2. Vercel 会自动注入 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN` 环境变量。
3. 部署项目：

```bash
npm run build
vercel
```

Vercel 会构建 React 静态资源，并把 `api/ledger.py` 作为 Python API 部署。

## 数据说明

线上环境使用 Vercel KV 存储交易记录。后端会使用 Redis Set 保存交易 ID，并用独立 key 保存每笔交易，新增和删除不会依赖浏览器本地数据。

可选环境变量：

- `KV_REST_API_URL`：Vercel KV REST 地址
- `KV_REST_API_TOKEN`：Vercel KV REST Token
- `ACCOUNT_RECORD_KEY_PREFIX`：账本 key 前缀，默认 `account-record`
