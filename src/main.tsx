import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, Check, CircleDollarSign, ReceiptText, Trash2, Users } from "lucide-react";
import "./styles.css";

type User = "T" | "A" | "C";
type SplitMode = "all" | "ta";

type Transaction = {
  id: string;
  amount: number;
  payer: User;
  split: SplitMode;
  note: string;
  date: string;
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
const STORAGE_KEY = "account-record-transactions-v1";

const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2
});

function getWeekStart(dateText: string) {
  const date = new Date(dateText);
  const day = date.getDay() || 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function localSummaries(transactions: Transaction[]): WeekSummary[] {
  const weeks = new Map<string, WeekSummary>();

  for (const tx of transactions) {
    const weekStart = getWeekStart(tx.date);
    if (!weeks.has(weekStart)) {
      weeks.set(weekStart, {
        weekStart,
        totals: Object.fromEntries(
          USERS.map((user) => [user, { paid: 0, share: 0, payable: 0, receivable: 0, net: 0 }])
        ) as Record<User, PersonTotal>
      });
    }

    const week = weeks.get(weekStart)!;
    const participants = tx.split === "all" ? USERS : (["T", "A"] as User[]);
    const perPerson = Number((tx.amount / participants.length).toFixed(2));
    week.totals[tx.payer].paid += tx.amount;
    for (const user of participants) {
      week.totals[user].share += perPerson;
    }
  }

  const summaries = Array.from(weeks.values()).map((week) => {
    for (const user of USERS) {
      const total = week.totals[user];
      const net = Number((total.share - total.paid).toFixed(2));
      total.paid = Number(total.paid.toFixed(2));
      total.share = Number(total.share.toFixed(2));
      total.net = net;
      total.payable = net > 0 ? net : 0;
      total.receivable = net < 0 ? -net : 0;
    }
    return week;
  });

  return summaries.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

function loadTransactions() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Transaction[]) : [];
  } catch {
    return [];
  }
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatWeek(start: string) {
  const begin = new Date(`${start}T00:00:00`);
  const end = new Date(begin);
  end.setDate(begin.getDate() + 6);
  return `${start} 至 ${end.toISOString().slice(0, 10)}`;
}

function App() {
  const [transactions, setTransactions] = useState<Transaction[]>(loadTransactions);
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState<User>("T");
  const [split, setSplit] = useState<SplitMode>("all");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayInputValue());
  const [summaries, setSummaries] = useState<WeekSummary[]>(() => localSummaries(transactions));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    const controller = new AbortController();

    fetch("/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions }),
      signal: controller.signal
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((data: { weeks: WeekSummary[] }) => setSummaries(data.weeks))
      .catch(() => setSummaries(localSummaries(transactions)));

    return () => controller.abort();
  }, [transactions]);

  const currentWeek = useMemo(() => summaries.find((week) => week.weekStart === getWeekStart(new Date().toISOString())), [summaries]);
  const recentTransactions = useMemo(
    () => [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
    [transactions]
  );

  function addTransaction(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;

    setTransactions((current) => [
      {
        id: crypto.randomUUID(),
        amount: Number(value.toFixed(2)),
        payer,
        split,
        note: note.trim(),
        date: new Date(`${date}T12:00:00`).toISOString()
      },
      ...current
    ]);
    setAmount("");
    setNote("");
  }

  function removeTransaction(id: string) {
    setTransactions((current) => current.filter((tx) => tx.id !== id));
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
          <span>{transactions.length} 笔记录</span>
        </div>
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

          <button className="submit-button" type="submit">
            <Check size={18} />
            记录交易
          </button>
        </form>

        <section className="summary-panel">
          <div className="panel-title">
            <CalendarDays size={22} />
            <h2>本周应付款</h2>
          </div>
          <div className="people-grid">
            {USERS.map((user) => {
              const total = currentWeek?.totals[user] ?? { paid: 0, share: 0, payable: 0, receivable: 0, net: 0 };
              return (
                <article className="person-card" key={user}>
                  <strong>{user}</strong>
                  <span>应付 {currency.format(total.payable)}</span>
                  <small>已付 {currency.format(total.paid)} / 应分摊 {currency.format(total.share)}</small>
                  {total.receivable > 0 && <em>应收 {currency.format(total.receivable)}</em>}
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
            <span>{summaries.length} 周</span>
          </div>
          <div className="week-list">
            {summaries.length === 0 && <div className="empty-state">还没有交易记录</div>}
            {summaries.map((week) => (
              <article className="week-card" key={week.weekStart}>
                <header>
                  <strong>{formatWeek(week.weekStart)}</strong>
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
                  <strong>{currency.format(tx.amount)}</strong>
                  <span>{tx.note || "无备注"}</span>
                  <small>
                    {tx.payer} 付款 · {tx.split === "all" ? "三人均分" : "T 与 A 均分"} · {tx.date.slice(0, 10)}
                  </small>
                </div>
                <button type="button" onClick={() => removeTransaction(tx.id)} aria-label="删除交易">
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
