#!/usr/bin/env python3
"""Servidor simples de partida compartilhada para a demonstração em rede."""

from __future__ import annotations

import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "partida.json"
HOST = "0.0.0.0"
PORT = 8080
WINNING_LINES = (
    (0, 1, 2), (3, 4, 5), (6, 7, 8),
    (0, 3, 6), (1, 4, 7), (2, 5, 8),
    (0, 4, 8), (2, 4, 6),
)
STATE_LOCK = threading.Lock()


def new_state() -> dict:
    return {
        "board": [None] * 9,
        "scores": {"X": 0, "O": 0, "draws": 0},
        "currentPlayer": "X",
        "history": [],
        "isFinished": False,
        "winner": None,
        "winningLine": [],
        "revision": 0,
    }


def load_state() -> dict:
    if not STATE_FILE.exists():
        state = new_state()
        save_state(state)
        return state
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if len(state["board"]) != 9 or set(state["scores"]) != {"X", "O", "draws"}:
            raise ValueError("formato inválido")
        return state
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        state = new_state()
        save_state(state)
        return state


def save_state(state: dict) -> None:
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(STATE_FILE)


class GameRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format_string, *args):
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def send_json(self, status: int, payload: dict, *, download: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if download:
            self.send_header("Content-Disposition", 'attachment; filename="partida.json"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = urlparse(self.path).path
        if route in ("/api/state", "/api/partida.json"):
            with STATE_LOCK:
                state = load_state()
                payload = dict(state)
            self.send_json(200, payload, download=(route == "/api/partida.json"))
            return
        if route == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        route = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 4096:
                self.send_json(413, {"error": "requisição muito grande"})
                return
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("corpo da requisição inválido")
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "JSON inválido"})
            return

        with STATE_LOCK:
            state = load_state()
            error = self.apply_action(route, body, state)
            if error:
                self.send_json(409, {"error": error, **state})
                return
            state["revision"] += 1
            save_state(state)
            payload = dict(state)
        self.send_json(200, payload)

    @staticmethod
    def apply_action(route: str, body: dict, state: dict) -> Optional[str]:
        if route == "/api/move":
            index = body.get("index")
            if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < 9:
                return "casa inválida"
            if state["isFinished"]:
                return "a partida já terminou"
            if state["board"][index] is not None:
                return "essa casa já está ocupada"

            player = state["currentPlayer"]
            state["board"][index] = player
            state["history"].append({"index": index, "player": player})
            line = next((line for line in WINNING_LINES if all(state["board"][cell] == player for cell in line)), None)
            if line:
                state["isFinished"] = True
                state["winner"] = player
                state["winningLine"] = list(line)
                state["scores"][player] += 1
            elif all(cell is not None for cell in state["board"]):
                state["isFinished"] = True
                state["scores"]["draws"] += 1
            else:
                state["currentPlayer"] = "O" if player == "X" else "X"
            return None

        if route == "/api/new-game":
            scores = state["scores"]
            revision = state["revision"]
            state.update(new_state())
            state["scores"] = scores
            state["revision"] = revision
            return None

        if route == "/api/reset-scores":
            state["scores"] = {"X": 0, "O": 0, "draws": 0}
            return None

        return "operação desconhecida"


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), GameRequestHandler)
    print(f"Jogo disponível em http://<IP-DA-MAQUINA>:{PORT}")
    print(f"Estado compartilhado e baixável em http://<IP-DA-MAQUINA>:{PORT}/api/partida.json")
    print(f"Arquivo persistido em {STATE_FILE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando servidor.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
