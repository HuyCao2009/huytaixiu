const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const fs = require("fs-extra");
const path = require("path");

app.use(express.static("public"));
app.use(bodyParser.json());

const DATA_FILE = path.join(__dirname, "history.json");
let users = {}; // { username: { balance: 0 } }
let bets = []; // { username, betType, betAmount }
let history = []; // { round, result, dice, total, bets: [{username, betType, betAmount, win, reward}] }
let round = 1;
let nextResult = null; // "tai" | "xiu" | null

// Load history & users từ file khi khởi động
if (fs.existsSync(DATA_FILE)) {
  const data = fs.readJsonSync(DATA_FILE, { throws: false }) || {};
  history = data.history || [];
  users = data.users || {};
  round = history.length ? history[history.length - 1].round + 1 : 1;
}
// Lưu lịch sử và users vào file
function saveData() {
  fs.writeJsonSync(DATA_FILE, { history, users });
}

// Đăng ký/đăng nhập
app.post("/register", (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ error: "Vui lòng nhập tên!" });
  if (!users[username]) users[username] = { balance: 0 };
  saveData();
  res.json({ success: true, balance: users[username].balance });
});

// Nạp tiền
app.post("/deposit", (req, res) => {
  const { username, amount } = req.body;
  if (!users[username]) return res.json({ error: "Chưa đăng ký tài khoản!" });
  if (isNaN(amount) || amount <= 0)
    return res.json({ error: "Số tiền không hợp lệ!" });
  users[username].balance += amount;
  saveData();
  res.json({ success: true, balance: users[username].balance });
});

// Đặt cược
app.post("/bet", (req, res) => {
  const { username, betType, betAmount } = req.body;
  if (!users[username]) return res.json({ error: "Chưa đăng ký tài khoản!" });
  if (!["tai", "xiu"].includes(betType) || isNaN(betAmount) || betAmount <= 0)
    return res.json({ error: "Dữ liệu không hợp lệ!" });
  if (users[username].balance < betAmount)
    return res.json({ error: "Số dư không đủ!" });
  // Kiểm tra đã đặt cược chưa
  if (bets.find((b) => b.username === username))
    return res.json({ error: "Bạn đã đặt cược ván này rồi!" });
  bets.push({ username, betType, betAmount });
  res.json({ success: true });
});

// Lấy lịch sử cầu
app.get("/history", (req, res) => {
  res.json({ history: history.slice(-20) }); // 20 ván gần nhất
});

// Lấy trạng thái ván hiện tại
app.get("/status", (req, res) => {
  res.json({
    round,
    timeLeft: nextRoundTime - Date.now(),
    bets: bets.map((b) => ({
      username: b.username,
      betType: b.betType,
      betAmount: b.betAmount,
    })),
    nextResult,
  });
});

// Admin điều chỉnh kết quả
app.post("/admin/set-result", (req, res) => {
  const { password, result } = req.body;
  if (password !== "123") return res.json({ error: "Sai mật khẩu admin!" });
  if (!["tai", "xiu", null].includes(result))
    return res.json({ error: "Kết quả không hợp lệ!" });
  nextResult = result;
  res.json({ success: true, nextResult });
});

// Tự động chạy ván mới mỗi 40 giây
let nextRoundTime = Date.now() + 40000;
setInterval(() => {
  if (bets.length === 0) {
    nextRoundTime = Date.now() + 40000;
    return;
  }
  // Xử lý ván
  let dice, total, result;
  if (nextResult) {
    // Admin chọn kết quả
    if (nextResult === "tai") {
      total = Math.floor(Math.random() * 7) + 11; // 11-17
    } else {
      total = Math.floor(Math.random() * 7) + 4; // 4-10
    }
    // Chia đều 3 viên xúc xắc
    let remain = total;
    dice = [];
    for (let i = 0; i < 2; i++) {
      let val = Math.max(1, Math.min(6, remain - (2 - i)));
      dice.push(val);
      remain -= val;
    }
    dice.push(remain);
    result = nextResult;
    nextResult = null;
  } else {
    dice = [
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
    ];
    total = dice.reduce((a, b) => a + b, 0);
    if (total >= 4 && total <= 10) result = "xiu";
    else if (total >= 11 && total <= 17) result = "tai";
    else result = "draw";
  }

  // Tính kết quả cho từng người chơi
  let betResults = [];
  for (let b of bets) {
    let win = result === b.betType;
    let reward = win ? b.betAmount : 0;
    if (win) users[b.username].balance += b.betAmount;
    else users[b.username].balance -= b.betAmount;
    betResults.push({
      username: b.username,
      betType: b.betType,
      betAmount: b.betAmount,
      win,
      reward,
    });
  }

  // Lưu lịch sử
  history.push({
    round,
    result,
    dice,
    total,
    bets: betResults,
    time: new Date().toISOString(),
  });
  if (history.length > 100) history = history.slice(-100); // Giới hạn 100 ván gần nhất
  saveData();

  // Reset cho ván mới
  bets = [];
  round++;
  nextRoundTime = Date.now() + 40000;
}, 40000);

const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + listener.address().port);
});
// API lấy lịch sử cá nhân
app.get("/user-history", (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ error: "Thiếu username!" });
  // Lọc lịch sử các ván mà user này có đặt cược
  const userHistory = history
    .filter((h) => h.bets.some((b) => b.username === username))
    .map((h) => {
      const bet = h.bets.find((b) => b.username === username);
      return {
        round: h.round,
        result: h.result,
        dice: h.dice,
        total: h.total,
        betType: bet.betType,
        betAmount: bet.betAmount,
        win: bet.win,
        reward: bet.reward,
        time: h.time,
      };
    });
  res.json({ userHistory });
});
