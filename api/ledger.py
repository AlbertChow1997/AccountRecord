from http.server import BaseHTTPRequestHandler
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

USERS = ("T", "A", "C")


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


def calculate(transactions):
    weeks = defaultdict(empty_person_totals)

    for tx in transactions:
        amount = money(tx.get("amount", 0))
        payer = tx.get("payer")
        split = tx.get("split")
        date = tx.get("date")

        if payer not in USERS or split not in ("all", "ta") or amount <= 0 or not date:
            continue

        participants = USERS if split == "all" else ("T", "A")
        per_person = (amount / Decimal(len(participants))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        current_week = weeks[week_start(date)]
        current_week[payer]["paid"] += amount

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


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw)
            transactions = payload.get("transactions", [])
            self._send(200, {"weeks": calculate(transactions)})
        except Exception as exc:
            self._send(400, {"error": str(exc)})
