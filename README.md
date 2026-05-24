# 三人记账系统

一个面向 T、A、C 三个用户的简易记账系统。前端使用 React 19，后端使用 Vercel Python Serverless Function 计算每周汇总。

## 功能

- 录入金额、日期、付款人和备注
- 支持三人均分，或 T 与 A 均分
- 每次新增或删除交易后自动刷新本周每个人的应付款
- 首页展示历史每周每人的应付、应收情况
- 交易记录保存在浏览器 `localStorage`，无需数据库即可部署到 Vercel

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址即可使用。

## 部署到 Vercel

```bash
npm run build
vercel
```

Vercel 会构建 React 静态资源，并把 `api/ledger.py` 作为 Python API 部署。

## 数据说明

当前版本为了零配置部署，交易数据保存在使用者当前浏览器中。若需要多人共享同一份数据，需要接入 Vercel KV、Postgres 或其他数据库。
