"use strict";

/** Modelo: concentra o estado e todas as regras do jogo, sem acessar o DOM. */
class GameModel {
  constructor() {
    this.winningLines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];
    this.scores = { X: 0, O: 0, draws: 0 };
    this.startNewGame();
  }

  startNewGame() {
    this.board = Array(9).fill(null);
    this.currentPlayer = "X";
    this.history = [];
    this.isFinished = false;
    this.winner = null;
    this.winningLine = [];
  }

  play(index) {
    if (this.isFinished || this.board[index] !== null) return null;

    const player = this.currentPlayer;
    this.board[index] = player;
    this.history.push({ index, player });
    const line = this.getWinningLine();

    if (line) {
      this.isFinished = true;
      this.winner = player;
      this.winningLine = line;
      this.scores[player] += 1;
      return { type: "win", player, line };
    }
    if (this.board.every((cell) => cell !== null)) {
      this.isFinished = true;
      this.scores.draws += 1;
      return { type: "draw" };
    }

    this.currentPlayer = player === "X" ? "O" : "X";
    return { type: "move", player };
  }

  getWinningLine() {
    return this.winningLines.find(([a, b, c]) =>
      this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]
    ) || null;
  }

  resetScores() {
    this.scores = { X: 0, O: 0, draws: 0 };
  }

  getReplayBoard(moveCount) {
    const replayBoard = Array(9).fill(null);
    this.history.slice(0, moveCount).forEach(({ index, player }) => {
      replayBoard[index] = player;
    });
    return replayBoard;
  }

  loadState(state) {
    this.board = [...state.board];
    this.scores = { ...state.scores };
    this.currentPlayer = state.currentPlayer;
    this.history = state.history.map((move) => ({ ...move }));
    this.isFinished = state.isFinished;
    this.winner = state.winner;
    this.winningLine = [...state.winningLine];
  }
}

/** Visão: cria apenas a apresentação e atributos de acessibilidade no DOM. */
class GameView {
  constructor() {
    this.board = document.querySelector("#game-board");
    this.cells = Array.from(document.querySelectorAll(".cell"));
    this.status = document.querySelector("#game-status");
    this.scoreX = document.querySelector("#score-x");
    this.scoreO = document.querySelector("#score-o");
    this.scoreDraw = document.querySelector("#score-draw");
    this.newGameButton = document.querySelector("#new-game");
    this.resetScoreButton = document.querySelector("#reset-score");
    this.dialog = document.querySelector("#reset-dialog");
    this.confirmResetButton = document.querySelector("#confirm-reset");
    this.replayControls = document.querySelector("#replay-controls");
    this.replayDescription = document.querySelector("#replay-description");
    this.previousButton = document.querySelector("#previous-move");
    this.nextButton = document.querySelector("#next-move");
    this.networkButton = document.querySelector("#network-toggle");
    this.networkStatus = document.querySelector("#network-status");
  }

  renderBoard(board, { locked = false, winningLine = [], replaying = false } = {}) {
    this.board.classList.toggle("is-replaying", replaying);
    this.cells.forEach((cell, index) => {
      const mark = board[index];
      const row = Math.floor(index / 3) + 1;
      const column = (index % 3) + 1;
      cell.textContent = mark || "";
      cell.disabled = locked || replaying || mark !== null;
      cell.classList.toggle("cell-x", mark === "X");
      cell.classList.toggle("cell-o", mark === "O");
      cell.classList.toggle("is-winner", winningLine.includes(index));
      cell.setAttribute("aria-label", `Linha ${row}, coluna ${column}, ${mark ? `ocupada por ${mark}` : "vazia"}`);
    });
  }

  renderScores(scores) {
    this.scoreX.textContent = String(scores.X);
    this.scoreO.textContent = String(scores.O);
    this.scoreDraw.textContent = String(scores.draws);
  }

  setStatus(message) { this.status.textContent = message; }

  showReplay(move, total) {
    this.replayControls.hidden = false;
    this.replayDescription.textContent = `Jogada ${move} de ${total}.`;
    this.previousButton.disabled = move === 0;
    this.nextButton.disabled = move === total;
  }

  hideReplay() { this.replayControls.hidden = true; }
}

/** Controlador: conecta eventos de interface às transições do modelo. */
class GameController {
  constructor(model, view) {
    this.model = model;
    this.view = view;
    this.replayPosition = 0;
    this.networkConnected = false;
    this.lastRevision = -1;
    this.pollTimer = null;
    this.bindEvents();
    this.renderGame();
  }

  bindEvents() {
    this.view.cells.forEach((cell) => cell.addEventListener("click", () => this.handleCellClick(Number(cell.dataset.index))));
    this.view.newGameButton.addEventListener("click", () => this.startNewGame());
    this.view.resetScoreButton.addEventListener("click", () => this.view.dialog.showModal());
    this.view.confirmResetButton.addEventListener("click", () => this.resetScores());
    this.view.previousButton.addEventListener("click", () => this.changeReplay(-1));
    this.view.nextButton.addEventListener("click", () => this.changeReplay(1));
    this.view.networkButton.addEventListener("click", () => this.toggleNetwork());
  }

  async handleCellClick(index) {
    if (this.networkConnected) {
      await this.sendNetworkAction("/api/move", { index });
      return;
    }
    const result = this.model.play(index);
    if (!result) return;
    this.renderGame();
    if (result.type === "win") {
      this.replayPosition = this.model.history.length;
      this.view.setStatus(`Jogador ${result.player} venceu! Use a Máquina do Tempo para rever a partida.`);
      this.view.showReplay(this.replayPosition, this.model.history.length);
    } else if (result.type === "draw") {
      this.replayPosition = this.model.history.length;
      this.view.setStatus("Empate! Use a Máquina do Tempo para rever a partida.");
      this.view.showReplay(this.replayPosition, this.model.history.length);
    } else {
      this.view.setStatus(`Vez do jogador ${this.model.currentPlayer}.`);
    }
  }

  async startNewGame() {
    if (this.networkConnected) {
      await this.sendNetworkAction("/api/new-game", {});
      return;
    }
    this.model.startNewGame();
    this.replayPosition = 0;
    this.view.hideReplay();
    this.renderGame();
    this.view.setStatus("Vez do jogador X.");
  }

  resetScores() {
    if (this.networkConnected) {
      this.sendNetworkAction("/api/reset-scores", {});
      return;
    }
    this.model.resetScores();
    this.view.renderScores(this.model.scores);
    this.view.setStatus("Placar zerado. A partida atual continua em andamento.");
  }

  changeReplay(direction) {
    this.replayPosition = Math.max(0, Math.min(this.model.history.length, this.replayPosition + direction));
    const replayBoard = this.model.getReplayBoard(this.replayPosition);
    const showWinner = this.replayPosition === this.model.history.length ? this.model.winningLine : [];
    this.view.renderBoard(replayBoard, { locked: true, replaying: true, winningLine: showWinner });
    this.view.showReplay(this.replayPosition, this.model.history.length);
    this.view.setStatus(`Reprodução: jogada ${this.replayPosition} de ${this.model.history.length}.`);
  }

  renderGame() {
    this.view.renderBoard(this.model.board, { locked: this.model.isFinished, winningLine: this.model.winningLine });
    this.view.renderScores(this.model.scores);
  }

  async toggleNetwork() {
    if (this.networkConnected) {
      this.networkConnected = false;
      window.clearInterval(this.pollTimer);
      this.view.networkButton.textContent = "Conectar à partida compartilhada";
      this.view.networkStatus.textContent = "Modo local: partida somente neste navegador.";
      this.view.networkStatus.classList.remove("is-connected");
      this.renderGame();
      return;
    }

    this.view.networkButton.disabled = true;
    this.view.networkStatus.textContent = "Conectando ao servidor…";
    try {
      const state = await this.fetchNetworkState();
      this.applyNetworkState(state);
      this.networkConnected = true;
      this.view.networkButton.textContent = "Desconectar da partida compartilhada";
      this.view.networkStatus.textContent = "Conectado: partida sincronizada pela rede.";
      this.view.networkStatus.classList.add("is-connected");
      this.pollTimer = window.setInterval(() => this.pollNetworkState(), 800);
    } catch (error) {
      this.view.networkStatus.textContent = `Não foi possível conectar: ${error.message}`;
    } finally {
      this.view.networkButton.disabled = false;
    }
  }

  async fetchNetworkState() {
    const response = await fetch("/api/state", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "servidor indisponível");
    return payload;
  }

  async sendNetworkAction(path, body) {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "ação recusada");
      this.applyNetworkState(payload);
    } catch (error) {
      this.view.networkStatus.textContent = `Falha na comunicação: ${error.message}`;
    }
  }

  async pollNetworkState() {
    try {
      const state = await this.fetchNetworkState();
      if (state.revision !== this.lastRevision) this.applyNetworkState(state);
      this.view.networkStatus.textContent = "Conectado: partida sincronizada pela rede.";
    } catch (error) {
      this.view.networkStatus.textContent = `Servidor desconectado: ${error.message}`;
    }
  }

  applyNetworkState(state) {
    this.model.loadState(state);
    this.lastRevision = state.revision;
    this.replayPosition = this.model.history.length;
    this.renderGame();
    if (this.model.isFinished) {
      this.view.showReplay(this.replayPosition, this.model.history.length);
      this.view.setStatus(this.model.winner
        ? `Jogador ${this.model.winner} venceu! Use a Máquina do Tempo para rever a partida.`
        : "Empate! Use a Máquina do Tempo para rever a partida.");
    } else {
      this.view.hideReplay();
      this.view.setStatus(`Vez do jogador ${this.model.currentPlayer}.`);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new GameController(new GameModel(), new GameView());
});
