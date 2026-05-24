from http.server import BaseHTTPRequestHandler
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

USERS = ("T", "A", "C")
SPLITS = ("all", "ta")
KEY_PREFIX = os.getenv("ACCOUNT_RECORD_KEY_PREFIX", "account-record")
IDS_KEY = f"{KEY_PREFIX}:transaction-ids"
LOCAL_STORE = Path("/tmp/account-record-transactions.json")


def money(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def week_start(date_text):
    parsed = datetime.fromisoformat(date_text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    monday = parsed.date() - timedelta(days=parsed.weekday())
    return monday.isoformat()


def empty_person_totals():
    return {user: {"paid": Decimal("0"), "share": Decimal("0"), "receivable": Decimal("0"), "payable": Decimal("0")} for user in USERS}


def normalize_transaction(tx):
    amount = money(tx.get("amount", 0))
    payer = tx.get("payer")
    split = tx.get("split")
    date = tx.get("date")
    tx_id = str(tx.get("id", "")).strip()
    note = str(tx.get("note", "")).strip()

    if not tx_id:
        raise ValueError("交易缺少 id")
    if payer not in USERS:
        raise ValueError("付款人只能是 T、A 或 C")
    if split not in SPLITS:
        raise ValueError("分摊方式只能是 all 或 ta")
    if amount <= 0:
        raise ValueError("金额必须大于 0")
    if not date:
        raise ValueError("交易日期不能为空")

    datetime.fromisoformat(date.replace("Z", "+00:00"))
    return {
        "id": tx_id,
        "amount": float(amount),
        "payer": payer,
        "split": split,
        "note": note,
        "date": date,
    }


def calculate(transactions):
    weeks = defaultdict(empty_person_totals)

    for tx in transactions:
        try:
            normalized = normalize_transaction(tx)
        except Exception:
            continue

        amount = money(normalized["amount"])
        participants = USERS if normalized["split"] == "all" else ("T", "A")
        per_person = (amount / Decimal(len(participants))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        current_week = weeks[week_start(normalized["date"])]
        current_week[normalized["payer"]]["paid"] += amount

        for user in participants:
            current_week[user]["share"] += per_person

    result = []
    for week, totals in sorted(weeks.items(), reverse=True):
        rounded_totals = {}
        for user in USERS:
            paid = money(totals[user]["paid"])
            share = money(totals[user]["share"])
            balance = money(share - paid)
            rounded_totals[user] = {
                "paid": float(paid),
                "share": float(share),
                "payable": float(balance if balance > 0 else Decimal("0")),
                "receivable": float(-balance if balance < 0 else Decimal("0")),
                "net": float(balance),
            }
        result.append({"weekStart": week, "totals": rounded_totals})

    return result


def kv_configured():
    return bool(os.getenv("KV_REST_API_URL") and os.getenv("KV_REST_API_TOKEN"))


def kv_command(*args):
    url = os.environ["KV_REST_API_URL"].rstrip("/")
    token = os.environ["KV_REST_API_TOKEN"]
    body = json.dumps(list(args)).encode("utf-8")
    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if "error" in payload:
        raise RuntimeError(payload["error"])
    return payload.get("result")


def transaction_key(tx_id):
    return f"{KEY_PREFIX}:transaction:{tx_id}"


def read_local_transactions():
    if not LOCAL_STORE.exists():
        return []
    return json.loads(LOCAL_STORE.read_text("utf-8"))


def write_local_transactions(transactions):
    LOCAL_STORE.write_text(json.dumps(transactions, ensure_ascii=False), "utf-8")


def list_transactions():
    if not kv_configured():
        return read_local_transactions()

    ids = kv_command("SMEMBERS", IDS_KEY) or []
    if not ids:
        return []

    raw_values = kv_command("MGET", *[transaction_key(tx_id) for tx_id in ids]) or []
    transactions = [json.loads(value) for value in raw_values if value]
    return sorted(transactions, key=lambda tx: tx.get("date", ""), reverse=True)


def add_transaction(tx):
    normalized = normalize_transaction(tx)
    if not kv_configured():
        transactions = [item for item in read_local_transactions() if item.get("id") != normalized["id"]]
        transactions.insert(0, normalized)
        write_local_transactions(transactions)
        return normalized

    kv_command("SET", transaction_key(normalized["id"]), json.dumps(normalized, ensure_ascii=False))
    kv_command("SADD", IDS_KEY, normalized["id"])
    return normalized


def delete_transaction(tx_id):
    tx_id = str(tx_id or "").strip()
    if not tx_id:
        raise ValueError("缺少要删除的交易 id")

    if not kv_configured():
        transactions = [item for item in read_local_transactions() if item.get("id") != tx_id]
        write_local_transactions(transactions)
        return

    kv_command("DEL", transaction_key(tx_id))
    kv_command("SREM", IDS_KEY, tx_id)


def ledger_payload():
    transactions = list_transactions()
    return {"transactions": transactions, "weeks": calculate(transactions), "database": "vercel-kv" if kv_configured() else "local-file"}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        try:
            self._send(200, ledger_payload())
        except Exception as exc:
            self._send(500, {"error": str(exc)})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw)
            add_transaction(payload.get("transaction", payload))
            self._send(200, ledger_payload())
        except Exception as exc:
            self._send(400, {"error": str(exc)})

    def do_DELETE(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            delete_transaction((query.get("id") or [""])[0])
            self._send(200, ledger_payload())
        except Exception as exc:
            self._send(400, {"error": str(exc)})
