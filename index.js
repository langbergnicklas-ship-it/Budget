const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

// 1. DATABASE CONNECTION WITH ERROR LOGGING
mongoose.connect(MONGODB_URI)
  .then(() => console.log("SUCCESS: Connected to MongoDB!"))
  .catch(err => {
    console.error("DATABASE ERROR:", err.message);
    process.exit(1); // Force exit if DB fails
  });

// 2. DATA MODELS
const transactionSchema = new mongoose.Schema({
  description: String,
  amount: Number,
  timestamp: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  remainingBudget: { type: Number, default: 12000 },
  targetPayday: { type: Number, default: 25 },
  transactions: [transactionSchema]
});

const User = mongoose.model("User", userSchema);

// Payday logic
function getActualPayday(targetDay) {
  let now = new Date();
  let payday = new Date(now.getFullYear(), now.getMonth(), targetDay);
  if (payday.getDay() === 0) payday.setDate(payday.getDate() - 2);
  else if (payday.getDay() === 6) payday.setDate(payday.getDate() - 1);
  if (new Date() >= payday.setHours(23, 59, 59)) {
    payday = new Date(now.getFullYear(), now.getMonth() + 1, targetDay);
    if (payday.getDay() === 0) payday.setDate(payday.getDate() - 2);
    else if (payday.getDay() === 6) payday.setDate(payday.getDate() - 1);
  }
  return payday;
}

// 3. API ROUTES
app.get("/api/overview", async (req, res) => {
  try {
    let user = await User.findOne();
    if (!user) user = await User.create({});
    const payday = getActualPayday(user.targetPayday);
    const daysLeft = Math.max(1, Math.ceil((payday - new Date()) / (1000 * 60 * 60 * 24)));
    res.json({
      dailyLimit: Math.floor(user.remainingBudget / daysLeft),
      daysLeft,
      paydayDate: payday.toLocaleDateString('sv-SE'),
      remainingBudget: user.remainingBudget,
      transactions: user.transactions
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/spend", async (req, res) => {
  const { amount, description } = req.body;
  const user = await User.findOne();
  user.remainingBudget -= amount;
  user.transactions.push({ amount, description });
  await user.save();
  res.json({ success: true });
});

app.post("/api/set-budget", async (req, res) => {
  const user = await User.findOne();
  user.remainingBudget = req.body.budget;
  user.transactions = []; 
  await user.save();
  res.json({ success: true });
});

app.delete("/api/delete-transaction/:id", async (req, res) => {
  const user = await User.findOne();
  const tx = user.transactions.id(req.params.id);
  if (tx) {
    user.remainingBudget += tx.amount;
    tx.deleteOne();
    await user.save();
  }
  res.json({ success: true });
});

// 4. FRONTEND UI
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 20px; background: #f0f2f5; }
          .card { background: white; padding: 25px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); max-width: 400px; margin: auto; }
          h1 { font-size: 50px; margin: 10px 0; color: #2ecc71; }
          .label { color: #8a8d91; text-transform: uppercase; font-size: 10px; font-weight: bold; }
          .section { margin-top: 20px; border-top: 1px solid #eee; padding-top: 15px; }
          input { padding: 12px; border: 1px solid #ddd; border-radius: 10px; width: 100%; margin-bottom: 8px; box-sizing: border-box; font-size: 16px; }
          button { padding: 12px; background: #0084ff; color: white; border: none; border-radius: 10px; font-weight: bold; width: 100%; cursor: pointer; }
          .undo-btn { background: #ff4d4d; color: white; padding: 5px 10px; font-size: 10px; width: auto; border-radius: 5px; border: none; }
          .history-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #eee; text-align: left; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <p class="label">Du kan spendera</p>
          <h1 id="daily">...</h1>
          <p id="stats" style="font-size: 14px; color: #4b4b4b;"></p>
          <div class="section">
            <p class="label">Ny utgift</p>
            <input type="text" id="desc" placeholder="Vad?">
            <input type="number" id="amt" placeholder="Kr">
            <button onclick="saveAction('/api/spend', 'amount')">Spara</button>
          </div>
          <div class="section">
            <p class="label">Inställningar</p>
            <input type="number" id="newBudget" placeholder="Ny totalbudget">
            <button onclick="saveAction('/api/set-budget', 'budget')" style="background:#27ae60">Sätt budget</button>
          </div>
          <div class="section" style="text-align: left;"><p class="label">Historik</p><div id="list"></div></div>
        </div>
        <script>
          async function update() {
            const res = await fetch('/api/overview');
            const data = await res.json();
            document.getElementById('daily').innerText = data.dailyLimit + ':-';
            document.getElementById('stats').innerHTML = '<b>' + data.remainingBudget + ' kr</b> kvar<br>Lön: ' + data.paydayDate;
            const list = document.getElementById('list');
            list.innerHTML = '';
            data.transactions.slice().reverse().forEach(t => {
              const item = document.createElement('div');
              item.className = 'history-item';
              item.innerHTML = '<div>' + t.description + ' (-' + t.amount + ' kr)</div>' +
                                '<button class="undo-btn" onclick="deleteItem(\\'' + t._id + '\\')">Ångra</button>';
              list.appendChild(item);
            });
          }
          async function deleteItem(id) { await fetch('/api/delete-transaction/' + id, { method: 'DELETE' }); update(); }
          async function saveAction(route, key) {
            const val = document.getElementById(key === 'amount' ? 'amt' : 'newBudget').value;
            const desc = document.getElementById('desc').value;
            if(!val) return;
            await fetch(route, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ [key]: Number(val), description: desc || 'Utgift' })
            });
            update();
          }
          update();
        </script>
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log("Server ready on port " + PORT));
