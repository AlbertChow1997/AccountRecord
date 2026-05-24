# 三人记账系统

一个面向 T、A、C 三个用户的简易记账系统。前端使用 React 19，后端使用 Vercel Node Serverless Function，并通过 Vercel Blob 保存多人共享账本。

## 功能

- 录入金额、日期、付款人和备注
- 支持三人均分，或 T 与 A 均分
- 每次新增或删除交易后自动刷新本周每个人的应付款
- 首页展示历史每周每人的应付、应收情况
- 交易记录保存到 Vercel Blob，多人打开同一个部署地址会看到同一份数据

## 本地运行

```bash
npm install
npm run dev
```

只运行 Vite 时，前端页面可以打开，但 `/api/ledger` 需要 Vercel 的 serverless 运行环境。完整本地调试推荐使用：

```bash
vercel dev
```

如果本地没有配置 Blob 环境变量，后端会临时使用 `/tmp/account-record-transactions.json` 保存数据，方便调试。

## 部署到 Vercel

1. 在 Vercel 项目中进入 Storage，创建一个 Blob Store，名称填 `AccountRecords`。
2. 将这个 Blob Store 连接到当前项目。
3. Vercel 会自动注入 `BLOB_READ_WRITE_TOKEN` 环境变量。
4. 如果 Vercel 给你的变量名是自定义前缀，也可以手动新增 `ACCOUNTRECORDS_BLOB_READ_WRITE_TOKEN`。
5. 部署项目：

```bash
npm run build
vercel
```

Vercel 会构建 React 静态资源，并把 `api/ledger.js` 作为 Serverless API 部署。

## 数据说明

线上环境使用 Vercel Blob 存储交易记录。后端会把所有交易保存到 `AccountRecords/transactions.json`，新增和删除都会覆盖更新这个共享 JSON 文件。

可选环境变量：

- `BLOB_READ_WRITE_TOKEN`：Vercel Blob 默认读写 Token
- `ACCOUNTRECORDS_BLOB_READ_WRITE_TOKEN`：可选，自定义的 AccountRecords Blob Store Token
- `BLOB_ACCESS`：Blob 访问级别，默认 `private`
