import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, Check, CircleDollarSign, ReceiptText, RotateCcw, Trash2, Users } from "lucide-react";
import "./styles.css";

type User = "T" | "A" | "C";
type SplitMode = "all" | "ta";

type Transaction = {
  id: string;
  type?: "transaction" | "settlement";
  amount: number;
  payer?: User;
  split?: SplitMode;
  note: string;
  date: string;
  createdAt?: string;
};

type PersonTotal = {
  paid: number;
  share: number;
  payable: number;
  receivable: number;
  net: number;
};

type WeekSummary = {
  weekStart: string;
  totals: Record<User, PersonTotal>;
};

const USERS: User[] = ["T", "A", "C"];
const EMPTY_TOTALS: Record<User, PersonTotal> = {
  T: { paid: 0, share: 0, payable: 0, receivable: 0, net: 0 },
  A: { paid: 0, share: 0, payable: 0, receivable: 0, net: 0 },
  C: { paid: 0, share: 0, payable: 0, receivable: 0, net: 0 }
};

const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2
});

function dateOnly(dateText: string) {
  return dateText.slice(0, 10);
}

function dateFromInputValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function getWeekStart(dateText: string) {
  const date = dateFromInputValue(dateOnly(dateText));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatWeek(start: string) {
  const begin = dateFromInputValue(start);
  const end = new Date(begin);
  end.setUTCDate(begin.getUTCDate() + 6);
  return `${start} 至 ${end.toISOString().slice(0, 10)}`;
}

function emptyTotals(): Record<User, PersonTotal> {
  return {
    T: { paid: 0, share: 0, payable: 0, receivable: 0, net: 0 },
    A: { paid: 0, share: 0, payable: 0, receivable: 0, net: 0 },
    C: { paid: 0, share: 0, payable: 0, receivable: 0, net: 0 }
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateWeeklySummaries(transactions: Transaction[]): WeekSummary[] {
  const weeks = new Map<string, Record<User, PersonTotal>>();

  for (const tx of transactions) {
    if (tx.type === "settlement") continue;
    if (!tx.payer || !tx.split || !Number.isFinite(tx.amount) || tx.amount <= 0) continue;

    const week = getWeekStart(tx.date);
    const totals = weeks.get(week) ?? emptyTotals();
    const participants = tx.split === "all" ? USERS : (["T", "A"] as User[]);
    const cents = Math.round(tx.amount * 100);
    const baseShare = Math.floor(cents / participants.length);
    const remainder = cents % participants.length;

    totals[tx.payer].paid += cents;
    participants.forEach((user, index) => {
      totals[user].share += baseShare + (index < remainder ? 1 : 0);
    });
    weeks.set(week, totals);
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([weekStart, rawTotals]) => ({
      weekStart,
      totals: Object.fromEntries(
        USERS.map((user) => {
          const paid = rawTotals[user].paid;
          const share = rawTotals[user].share;
          const net = share - paid;
          return [
            user,
            {
              paid: roundMoney(paid / 100),
              share: roundMoney(share / 100),
              payable: roundMoney(Math.max(net, 0) / 100),
              receivable: roundMoney(Math.max(-net, 0) / 100),
              net: roundMoney(net / 100)
            }
          ];
        })
      ) as Record<User, PersonTotal>
    }));
}

async function requestLedger(path = "/api/ledger", options?: RequestInit) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "账本同步失败");
  }
  return data as { transactions: Transaction[]; weeks: WeekSummary[]; currentTotals: Record<User, PersonTotal>; database: string };
}

function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState<User>("T");
  const [split, setSplit] = useState<SplitMode>("all");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayInputValue());
  const [summaries, setSummaries] = useState<WeekSummary[]>([]);
  const [currentTotals, setCurrentTotals] = useState<Record<User, PersonTotal>>(EMPTY_TOTALS);
  const [database, setDatabase] = useState("loading");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [showSettleConfirm, setShowSettleConfirm] = useState(false);

  async function refreshLedger(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setIsLoading(true);
    }
    try {
      const data = await requestLedger();
      setTransactions(data.transactions);
      setSummaries(data.weeks);
      setCurrentTotals(data.currentTotals);
      setDatabase(data.database);
      setError("");
    } catch (err) {
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : "账本同步失败");
      }
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    refreshLedger();
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        refreshLedger({ silent: true });
      }
    }, 8000);

    return () => window.clearInterval(timer);
  }, []);

  const transactionsByWeek = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      if (tx.type === "settlement") continue;
      const week = getWeekStart(tx.date);
      groups.set(week, [...(groups.get(week) ?? []), tx]);
    }
    for (const [week, items] of groups.entries()) {
      groups.set(
        week,
        [...items].sort((a, b) => dateOnly(b.date).localeCompare(dateOnly(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      );
    }
    return groups;
  }, [transactions]);
  const historySummaries = useMemo(() => calculateWeeklySummaries(transactions), [transactions]);
  const recentTransactions = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))
        .slice(0, 12),
    [transactions]
  );
  const hasCurrentBalance = USERS.some((user) => currentTotals[user].payable > 0 || currentTotals[user].receivable > 0);

  async function addTransaction(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;

    setIsSaving(true);
    setError("");
    try {
      const transaction: Transaction = {
        id: crypto.randomUUID(),
        type: "transaction",
        amount: Number(value.toFixed(2)),
        payer,
        split,
        note: note.trim(),
        date: `${date}T00:00:00.000Z`,
        createdAt: new Date().toISOString()
      };
      const data = await requestLedger("/api/ledger", {
        method: "POST",
        body: JSON.stringify({ transaction })
      });
      setTransactions(data.transactions);
      setSummaries(data.weeks);
      setCurrentTotals(data.currentTotals);
      setDatabase(data.database);
      setAmount("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存交易失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeTransaction(id: string) {
    setIsSaving(true);
    setError("");
    try {
      const data = await requestLedger(`/api/ledger?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setTransactions(data.transactions);
      setSummaries(data.weeks);
      setCurrentTotals(data.currentTotals);
      setDatabase(data.database);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除交易失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function settleCurrentBalance() {
    setIsSaving(true);
    setError("");
    try {
      const now = new Date().toISOString();
      const settlement: Transaction = {
        id: crypto.randomUUID(),
        type: "settlement",
        amount: 0,
        note: "结算",
        date: `${todayInputValue()}T00:00:00.000Z`,
        createdAt: now
      };
      const data = await requestLedger("/api/ledger", {
        method: "POST",
        body: JSON.stringify({ transaction: settlement })
      });
      setTransactions(data.transactions);
      setSummaries(data.weeks);
      setCurrentTotals(data.currentTotals);
      setDatabase(data.database);
      setShowSettleConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "结算失败");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">T / A / C</p>
          <h1>三人记账</h1>
        </div>
        <div className="total-chip">
          <ReceiptText size={18} />
          <span>{isLoading ? "同步中" : `${transactions.length} 笔记录`}</span>
        </div>
      </section>

      <section className="sync-bar">
        <span>数据源：{database === "vercel-blob" ? "Vercel Blob 共享存储" : database === "local-file" ? "本地临时文件" : "连接中"}</span>
        {isSaving && <strong>正在同步...</strong>}
        {error && <strong className="sync-error">{error}</strong>}
      </section>

      <section className="workspace">
        <form className="entry-panel" onSubmit={addTransaction}>
          <div className="panel-title">
            <CircleDollarSign size={22} />
            <h2>新增交易</h2>
          </div>

          <label>
            金额
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              required
            />
          </label>

          <label>
            日期
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>

          <div className="field-group">
            <span>付款人</span>
            <div className="segmented">
              {USERS.map((user) => (
                <button type="button" className={payer === user ? "active" : ""} onClick={() => setPayer(user)} key={user}>
                  {user}
                </button>
              ))}
            </div>
          </div>

          <div className="field-group">
            <span>分摊方式</span>
            <div className="split-options">
              <button type="button" className={split === "all" ? "selected" : ""} onClick={() => setSplit("all")}>
                <Users size={18} />
                三人均分
              </button>
              <button type="button" className={split === "ta" ? "selected" : ""} onClick={() => setSplit("ta")}>
                <Users size={18} />
                T 与 A 均分
              </button>
            </div>
          </div>

          <label>
            备注
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="餐饮、房租、水电..." rows={3} />
          </label>

          <button className="submit-button" type="submit" disabled={isSaving || isLoading}>
            <Check size={18} />
            {isSaving ? "同步中" : "记录交易"}
          </button>
        </form>

        <section className="summary-panel">
          <div className="panel-title summary-title">
            <div>
              <CalendarDays size={22} />
              <h2>当前应付款</h2>
            </div>
            <button type="button" className="settle-button" onClick={() => setShowSettleConfirm(true)} disabled={isSaving || isLoading || !hasCurrentBalance}>
              <RotateCcw size={17} />
              结算
            </button>
          </div>
          <div className="people-grid">
            {USERS.map((user) => {
              const total = currentTotals[user] ?? EMPTY_TOTALS[user];
              return (
                <article className="person-card" key={user}>
                  <strong>{user}</strong>
                  <span>应付 {currency.format(total.payable)}</span>
                  <em>应收 {currency.format(total.receivable)}</em>
                  <small>已付 {currency.format(total.paid)} / 应分摊 {currency.format(total.share)}</small>
                </article>
              );
            })}
          </div>
        </section>
      </section>

      <section className="history-layout">
        <section>
          <div className="section-heading">
            <h2>每周历史</h2>
            <span>{historySummaries.length} 周</span>
          </div>
          <div className="week-list">
            {historySummaries.length === 0 && <div className="empty-state">还没有交易记录</div>}
            {historySummaries.map((week) => (
              <article className="week-card" key={week.weekStart}>
                <header>
                  <strong>{formatWeek(week.weekStart)}</strong>
                  <span>{transactionsByWeek.get(week.weekStart)?.length ?? 0} 笔</span>
                </header>
                <div className="week-table">
                  {USERS.map((user) => (
                    <div className="week-row" key={user}>
                      <span>{user}</span>
                      <span>应付 {currency.format(week.totals[user].payable)}</span>
                      <span>应收 {currency.format(week.totals[user].receivable)}</span>
                    </div>
                  ))}
                </div>
                <div className="week-transactions">
                  {(transactionsByWeek.get(week.weekStart) ?? []).map((tx) => (
                    <div className="week-transaction" key={tx.id}>
                      <span>{dateOnly(tx.date)}</span>
                      <strong>{currency.format(tx.amount)}</strong>
                      <small>
                        {tx.payer} 付款 · {tx.split === "all" ? "三人均分" : "T 与 A 均分"} · {tx.note || "无备注"}
                      </small>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="section-heading">
            <h2>最近交易</h2>
            <span>{recentTransactions.length} 条</span>
          </div>
          <div className="transaction-list">
            {recentTransactions.length === 0 && <div className="empty-state">添加第一笔账单后会显示在这里</div>}
            {recentTransactions.map((tx) => (
              <article className="transaction-item" key={tx.id}>
                <div>
                  {tx.type === "settlement" ? (
                    <>
                      <strong>结算</strong>
                      <span>{tx.note || "结算"}</span>
                      <small>当前应付款已重置 · {dateOnly(tx.date)}</small>
                    </>
                  ) : (
                    <>
                      <strong>{currency.format(tx.amount)}</strong>
                      <span>{tx.note || "无备注"}</span>
                      <small>
                        {tx.payer} 付款 · {tx.split === "all" ? "三人均分" : "T 与 A 均分"} · {dateOnly(tx.date)}
                      </small>
                    </>
                  )}
                </div>
                <button type="button" onClick={() => removeTransaction(tx.id)} aria-label="删除交易" disabled={isSaving}>
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>

      {showSettleConfirm && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="settle-title">
            <h2 id="settle-title">确认结算</h2>
            <p>结算后当前应付款会重置为 0，并在最近交易中生成一条结算记录。</p>
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setShowSettleConfirm(false)} disabled={isSaving}>
                取消
              </button>
              <button type="button" className="confirm-button" onClick={settleCurrentBalance} disabled={isSaving}>
                {isSaving ? "结算中" : "确定结算"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
