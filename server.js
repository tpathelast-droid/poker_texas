
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));

const suits = ["♠", "♥", "♦", "♣"];
const ranks = "23456789TJQKA".split("").map((label, i) => ({
  label: label === "T" ? "10" : label,
  value: i + 2
}));

const rooms = new Map();
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        ...rank,
        suit,
        red: suit === "♥" || suit === "♦"
      });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createRoom() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 7).toUpperCase();
  } while (rooms.has(code));

  rooms.set(code, {
    players: [],
    chips: new Map(),
    deck: [],
    hands: new Map(),
    board: [],
    pot: 0,
    bets: new Map(),
    currentBet: 0,
    acted: new Set(),
    turn: null,
    button: 0,
    stage: "waiting",
    finished: false,
    result: null,
    message: "منتظر بازیکن دوم..."
  });

  return code;
}

// Evaluate five cards. The vector includes kickers,
// so equal categories are compared correctly.
function evaluateFive(cards) {
  const values = cards.map(c => c.value).sort((a, b) => b - a);
  const counts = new Map();

  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);

  const groups = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0]
  );

  const flush = cards.every(c => c.suit === cards[0].suit);
  const unique = [...new Set(values)].sort((a, b) => b - a);

  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) straightHigh = unique[0];
    else if (unique.join(",") === "14,5,4,3,2") straightHigh = 5;
  }

  if (flush && straightHigh === 14) {
    // Royal flush is the highest straight flush.
    return { score: 8, vector: [8, 14], name: "رویال فلاش" };
  }
  if (flush && straightHigh) {
    return { score: 8, vector: [8, straightHigh], name: "استریت فلاش" };
  }
  if (groups[0][1] === 4) {
    return {
      score: 7,
      vector: [7, groups[0][0], groups[1][0]],
      name: "چهارتایی"
    };
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return {
      score: 6,
      vector: [6, groups[0][0], groups[1][0]],
      name: "فول هاوس"
    };
  }
  if (flush) return { score: 5, vector: [5, ...values], name: "فلاش" };
  if (straightHigh) {
    return { score: 4, vector: [4, straightHigh], name: "استریت" };
  }
  if (groups[0][1] === 3) {
    return {
      score: 3,
      vector: [3, groups[0][0], ...groups.slice(1).map(g => g[0]).sort((a,b) => b-a)],
      name: "سه‌تایی"
    };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return {
      score: 2,
      vector: [2, ...pairs, groups[2][0]],
      name: "دو جفت"
    };
  }
  if (groups[0][1] === 2) {
    return {
      score: 1,
      vector: [1, groups[0][0], ...groups.slice(1).map(g => g[0]).sort((a,b) => b-a)],
      name: "یک جفت"
    };
  }
  return { score: 0, vector: [0, ...values], name: "کارت بالا" };
}

function compareVectors(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function evaluateSeven(cards) {
  let best = null;

  for (let a = 0; a < cards.length - 4; a++) {
    for (let b = a + 1; b < cards.length - 3; b++) {
      for (let c = b + 1; c < cards.length - 2; c++) {
        for (let d = c + 1; d < cards.length - 1; d++) {
          for (let e = d + 1; e < cards.length; e++) {
            const result = evaluateFive([
              cards[a], cards[b], cards[c], cards[d], cards[e]
            ]);
            if (!best || compareVectors(result.vector, best.vector) > 0) {
              best = result;
            }
          }
        }
      }
    }
  }
  return best;
}

function playerIndex(room, id) {
  return room.players.indexOf(id);
}

function startRound(room) {
  room.deck = createDeck();
  room.hands = new Map();
  room.board = [];
  room.pot = 0;
  room.bets = new Map(room.players.map(id => [id, 0]));
  room.currentBet = BIG_BLIND;
  room.acted.clear();
  room.finished = false;
  room.result = null;
  room.stage = "preflop";

  for (const id of room.players) {
    room.hands.set(id, [room.deck.pop(), room.deck.pop()]);
  }

  const smallId = room.players[room.button];
  const bigId = room.players[1 - room.button];

  room.chips.set(smallId, room.chips.get(smallId) - SMALL_BLIND);
  room.chips.set(bigId, room.chips.get(bigId) - BIG_BLIND);
  room.bets.set(smallId, SMALL_BLIND);
  room.bets.set(bigId, BIG_BLIND);
  room.turn = smallId;
  room.message = "مرحله پیش‌فلاپ: نوبت شرط‌بندی است.";
}

function publicCard(card) {
  return {
    label: card.label,
    value: card.value,
    suit: card.suit,
    red: card.red
  };
}

function sendState(code) {
  const room = rooms.get(code);
  if (!room) return;

  for (const id of room.players) {
    const playerSocket = io.sockets.sockets.get(id);
    if (!playerSocket) continue;

    const index = playerIndex(room, id);
    playerSocket.emit("roomState", {
      code,
      playerNumber: index + 1,
      playerCount: room.players.length,
      hand: (room.hands.get(id) || []).map(publicCard),
      board: room.board.map(publicCard),
      chips: room.chips.get(id) || 0,
      pot: room.pot + [...room.bets.values()].reduce((a, b) => a + b, 0),
      ownBet: room.bets.get(id) || 0,
      currentBet: room.currentBet,
      turnPlayerNumber: room.turn === null ? 0 : playerIndex(room, room.turn) + 1,
      stage: room.stage,
      finished: room.finished,
      message: room.message,
      result: room.result
    });
  }
}

function settleBets(room) {
  room.pot += [...room.bets.values()].reduce((a, b) => a + b, 0);
  for (const id of room.players) room.bets.set(id, 0);
  room.currentBet = 0;
}

function finishByFold(room, winnerId) {
  room.pot += [...room.bets.values()].reduce((a, b) => a + b, 0);
  room.bets = new Map(room.players.map(id => [id, 0]));

  room.chips.set(winnerId, room.chips.get(winnerId) + room.pot);
  room.result = {
    winner: playerIndex(room, winnerId) + 1,
    reason: "fold",
    hand1: "مخفی",
    hand2: "مخفی",
    handName1: "",
    handName2: "",
    pot: room.pot
  };
  room.finished = true;
  room.stage = "showdown";
  room.turn = null;
  room.message = "یک بازیکن فولد کرد.";
}

function finishShowdown(room) {
  settleBets(room);

  const id1 = room.players[0];
  const id2 = room.players[1];
  const result1 = evaluateSeven([...room.hands.get(id1), ...room.board]);
  const result2 = evaluateSeven([...room.hands.get(id2), ...room.board]);
  const comparison = compareVectors(result1.vector, result2.vector);

  let winner = 0;
  if (comparison > 0) winner = 1;
  if (comparison < 0) winner = 2;

  if (winner === 0) {
    const half = Math.floor(room.pot / 2);
    room.chips.set(id1, room.chips.get(id1) + half);
    room.chips.set(id2, room.chips.get(id2) + (room.pot - half));
  } else {
    const winnerId = winner === 1 ? id1 : id2;
    room.chips.set(winnerId, room.chips.get(winnerId) + room.pot);
  }

  room.result = {
    winner,
    reason: "showdown",
    hand1: room.hands.get(id1).map(publicCard),
    hand2: room.hands.get(id2).map(publicCard),
    handName1: result1.name,
    handName2: result2.name,
    pot: room.pot
  };
  room.finished = true;
  room.stage = "showdown";
  room.turn = null;
  room.message = winner === 0 ? "دست مساوی شد!" : `بازیکن ${winner} برنده شد!`;
}

function advanceStreet(room) {
  settleBets(room);
  room.acted.clear();

  if (room.stage === "preflop") {
    room.deck.pop(); // burn card
    room.board.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    room.stage = "flop";
  } else if (room.stage === "flop") {
    room.deck.pop();
    room.board.push(room.deck.pop());
    room.stage = "turn";
  } else if (room.stage === "turn") {
    room.deck.pop();
    room.board.push(room.deck.pop());
    room.stage = "river";
  } else if (room.stage === "river") {
    finishShowdown(room);
    return;
  }

  // Heads-up: the button/small blind acts first after the flop.
  room.turn = room.players[room.button];
  room.message = `مرحله ${room.stage}: نوبت شرط‌بندی است.`;
}

function handleAction(socket, data) {
  const room = rooms.get(socket.data.roomCode);
  if (!room || room.finished || room.players.length !== 2) return;
  if (room.turn !== socket.id) {
    socket.emit("errorMessage", "الان نوبت تو نیست.");
    return;
  }

  const type = data && data.type;
  const ownBet = room.bets.get(socket.id) || 0;
  const toCall = room.currentBet - ownBet;
  const chips = room.chips.get(socket.id) || 0;

  if (type === "fold") {
    finishByFold(room, room.players.find(id => id !== socket.id));
    sendState(socket.data.roomCode);
    return;
  }

  if (type === "check") {
    if (toCall !== 0) {
      socket.emit("errorMessage", "برای Check باید ابتدا شرط حریف را برابر کنی.");
      return;
    }
    room.acted.add(socket.id);
  } else if (type === "call") {
    if (toCall <= 0) {
      socket.emit("errorMessage", "شرطی برای برابر کردن وجود ندارد؛ از Check استفاده کن.");
      return;
    }
    if (chips < toCall) {
      socket.emit("errorMessage", "ژتون کافی برای Call نداری. حالت All-in هنوز فعال نیست.");
      return;
    }
    room.chips.set(socket.id, chips - toCall);
    room.bets.set(socket.id, ownBet + toCall);
    room.acted.add(socket.id);
  } else if (type === "raise") {
    const raiseBy = Number(data.amount);
    if (!Number.isInteger(raiseBy) || raiseBy < BIG_BLIND) {
      socket.emit("errorMessage", `حداقل افزایش شرط ${BIG_BLIND} ژتون است.`);
      return;
    }
    const cost = toCall + raiseBy;
    if (chips < cost) {
      socket.emit("errorMessage", "برای این افزایش شرط ژتون کافی نداری.");
      return;
    }
    room.chips.set(socket.id, chips - cost);
    room.bets.set(socket.id, ownBet + cost);
    room.currentBet = ownBet + cost;
    room.acted = new Set([socket.id]);
  } else {
    return;
  }

  if (room.acted.size === 2 &&
      room.players.every(id => room.bets.get(id) === room.currentBet)) {
    advanceStreet(room);
  } else {
    room.turn = room.players.find(id => id !== socket.id);
  }

  sendState(socket.data.roomCode);
}

io.on("connection", socket => {
  socket.on("createRoom", () => {
    if (socket.data.roomCode) return;

    const code = createRoom();
    const room = rooms.get(code);
    room.players.push(socket.id);
    room.chips.set(socket.id, STARTING_CHIPS);
    socket.data.roomCode = code;
    socket.join(code);
    socket.emit("roomCreated", { code });
    sendState(code);
  });

  socket.on("joinRoom", rawCode => {
    if (socket.data.roomCode) {
      socket.emit("errorMessage", "ابتدا از اتاق فعلی خارج شو یا صفحه را دوباره باز کن.");
      return;
    }

    const code = String(rawCode || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit("errorMessage", "اتاق پیدا نشد.");
      return;
    }
    if (room.players.length >= 2 || room.stage !== "waiting") {
      socket.emit("errorMessage", "این اتاق در دسترس نیست.");
      return;
    }

    room.players.push(socket.id);
    room.chips.set(socket.id, STARTING_CHIPS);
    socket.data.roomCode = code;
    socket.join(code);

    room.button = 0;
    startRound(room);
    io.to(code).emit("gameStarted");
    sendState(code);
  });

  socket.on("playerAction", data => handleAction(socket, data));

  socket.on("newRound", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.players.length !== 2 || !room.finished) return;

    if (room.players.some(id => (room.chips.get(id) || 0) <= 0)) {
      room.message = "یکی از بازیکنان ژتون کافی ندارد. اتاق جدید بسازید.";
      sendState(socket.data.roomCode);
      return;
    }

    room.button = 1 - room.button;
    startRound(room);
    io.to(socket.data.roomCode).emit("gameStarted");
    sendState(socket.data.roomCode);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    room.players = room.players.filter(id => id !== socket.id);
    room.chips.delete(socket.id);
    room.hands.delete(socket.id);
    room.bets.delete(socket.id);

    if (room.players.length === 0) {
      rooms.delete(code);
    } else {
      io.to(code).emit("opponentLeft");
      room.stage = "waiting";
      room.finished = false;
      room.turn = null;
      room.message = "حریف خارج شد. برای بازی دوباره اتاق جدید بسازید.";
      sendState(code);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Royal Poker listening on port ${PORT}`);
});
