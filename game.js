const suits = [
    { symbol: "♠", name: "پیک", red: false },
    { symbol: "♥", name: "دل", red: true },
    { symbol: "♦", name: "خشت", red: true },
    { symbol: "♣", name: "گشنیز", red: false }
];

const ranks = [
    { label: "2", value: 2 },
    { label: "3", value: 3 },
    { label: "4", value: 4 },
    { label: "5", value: 5 },
    { label: "6", value: 6 },
    { label: "7", value: 7 },
    { label: "8", value: 8 },
    { label: "9", value: 9 },
    { label: "10", value: 10 },
    { label: "J", value: 11 },
    { label: "Q", value: 12 },
    { label: "K", value: 13 },
    { label: "A", value: 14 }
];

const cardsElement = document.getElementById("cards");
const resultElement = document.getElementById("result");
const descriptionElement = document.getElementById("description");
const newGameButton = document.getElementById("newGame");
const exchangeButton = document.getElementById("exchange");

let deck = [];
let hand = [];
let selected = new Set();
let gameStarted = false;

function createDeck() {
    const newDeck = [];

    for (const suit of suits) {
        for (const rank of ranks) {
            newDeck.push({
                ...rank,
                suit: suit.symbol,
                red: suit.red
            });
        }
    }

    return newDeck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
}

function startGame() {
    deck = shuffle(createDeck());
    hand = deck.splice(0, 5);
    selected.clear();
    gameStarted = true;

    resultElement.textContent = "کارت‌هات رو بررسی کن!";
    descriptionElement.textContent =
        "روی کارت‌هایی که می‌خواهی عوض کنی کلیک کن.";

    exchangeButton.disabled = false;

    renderCards();
}

function renderCards() {
    cardsElement.innerHTML = "";

    hand.forEach((card, index) => {
        const element = document.createElement("div");

        element.className =
            "card" +
            (card.red ? " red" : "") +
            (selected.has(index) ? " selected" : "");

        element.innerHTML = `
            <span class="rank">${card.label}</span>
            <span class="suit">${card.suit}</span>
            <span class="bottom">${card.label} ${card.suit}</span>
        `;

        element.addEventListener("click", () => {
            if (!gameStarted) return;

            if (selected.has(index)) {
                selected.delete(index);
            } else {
                selected.add(index);
            }

            renderCards();
        });

        cardsElement.appendChild(element);
    });
}

function evaluateHand(cards) {
    const values = cards
        .map(card => card.value)
        .sort((a, b) => a - b);

    const counts = {};

    for (const value of values) {
        counts[value] = (counts[value] || 0) + 1;
    }

    const groups = Object.values(counts).sort((a, b) => b - a);

    const flush = cards.every(card => card.suit === cards[0].suit);

    let straight = values.every(
        (value, index) =>
            index === 0 || value === values[index - 1] + 1
    );

    // حالت ویژه: آس، 2، 3، 4، 5
    if (values.join(",") === "2,3,4,5,14") {
        straight = true;
    }

    if (straight && flush) {
        return {
            score: 8,
            name: "استریت فلاش",
            message: "پنج کارت پشت سر هم با یک خال!"
        };
    }

    if (groups[0] === 4) {
        return {
            score: 7,
            name: "چهارتایی",
            message: "چهار کارت با یک ارزش!"
        };
    }

    if (groups[0] === 3 && groups[1] === 2) {
        return {
            score: 6,
            name: "فول هاوس",
            message: "سه کارت مشابه به‌علاوه یک جفت!"
        };
    }

    if (flush) {
        return {
            score: 5,
            name: "فلاش",
            message: "هر پنج کارت از یک خال هستند!"
        };
    }

    if (straight) {
        return {
            score: 4,
            name: "استریت",
            message: "پنج کارت پشت سر هم!"
        };
    }

    if (groups[0] === 3) {
        return {
            score: 3,
            name: "سه‌تایی",
            message: "سه کارت با یک ارزش!"
        };
    }

    if (groups[0] === 2 && groups[1] === 2) {
        return {
            score: 2,
            name: "دو جفت",
            message: "دو جفت کارت مشابه!"
        };
    }

    if (groups[0] === 2) {
        return {
            score: 1,
            name: "یک جفت",
            message: "دو کارت با یک ارزش!"
        };
    }

    return {
        score: 0,
        name: "کارت بالا",
        message: "هنوز ترکیب ویژه‌ای نداری."
    };
}

function exchangeCards() {
    if (!gameStarted) return;

    const indexes = [...selected].sort((a, b) => a - b);

    for (const index of indexes) {
        if (deck.length > 0) {
            hand[index] = deck.pop();
        }
    }

    selected.clear();
    gameStarted = false;
    exchangeButton.disabled = true;

    renderCards();

    const result = evaluateHand(hand);

    resultElement.textContent = result.name;
    descriptionElement.textContent = result.message;
}

newGameButton.addEventListener("click", startGame);
exchangeButton.addEventListener("click", exchangeCards);

startGame();