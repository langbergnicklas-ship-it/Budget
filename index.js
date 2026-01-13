const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log("LYCKAD: Ansluten till MongoDB!"))
  .catch(err => console.error("DATABASE ERROR:", err));

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

app.get("/api/overview", async (req, res) => {
  let user = await User.findOne();
  if (!user) user = await User.create({});
  const payday = getActualPayday(user.targetPayday);
  const daysLeft = Math.max(1, Math.ceil((payday - new Date()) / (1000 * 60 * 60 * 24)));
  res.json({
    dailyLimit: Math.floor(user.remainingBudget / daysLeft),
    daysLeft,
    paydayDate: payday.toLocaleDateString('sv-SE'),
    remainingBudget: user.remainingBudget,
    targetPayday: user.targetPayday,
    transactions: user.transactions
  });
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

app.post("/api/set-payday", async (req, res) => {
  const user = await User.findOne();
  user.targetPayday = req.body.payday;
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

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Budget</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
        <link rel="apple-touch-icon" href="https://cdn-icons-png.flaticon.com/512/2489/2489756.png">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 20px; background: #f0f2f5; margin: 0; }
          .card { background: white; padding: 25px; border-radius: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); max-width: 400px; margin: auto; }
          h1 { font-size: 55px; margin: 10px 0; color: #2ecc71; letter-spacing: -2px; }
          .label { color: #8a8d91; text-transform: uppercase; font-size: 11px; font-weight: bold; letter-spacing: 1px; }
          .section { margin-top: 25px; border-top: 1px solid #f0f0f0; padding-top: 20px; }
          input { padding: 15px; border: 1px solid #eee; border-radius: 12px; width: 100%; margin-bottom: 10px; box-sizing: border-box; font-size: 16px; background: #fafafa; }
          button { padding: 15px; background: #0084ff; color: white; border: none; border-radius: 12px; font-weight: bold; width: 100%; cursor: pointer; transition: 0.2s; }
          button:active { transform: scale(0.98); opacity: 0.9; }
          .history-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f9f9f9; text-align: left; }
          .undo-btn { background: #ffe5e5; color: #ff4d4d; padding: 8px 12px; font-size: 11px; width: auto; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <p class="label">Kvar att spendera idag</p>
          <h1 id="daily">...</h1>
          <p id="stats" style="font-size: 14px; color: #4b4b4b; margin-bottom: 10px;"></p>

          <div class="section">
            <p class="label">Ny utgift</p>
            <input type="text" id="desc" placeholder="Vad köpte du?">
            <input type="number" id="amt" inputmode="decimal" placeholder="Belopp (kr)">
            <button onclick="saveAction('/api/spend', 'amount')">Spara köp</button>
          </div>

          <div class="section">
            <p class="label">Inställningar</p>
            <input type="number" id="newBudget" placeholder="Totalbudget">
            <button onclick="saveAction('/api/set-budget', 'budget')" style="background:#27ae60; margin-bottom: 10px;">Uppdatera budget</button>
            <input type="number" id="newPayday" placeholder="Lönedag (t.ex. 25)">
            <button onclick="saveAction('/api/set-payday', 'payday')" style="background:#8e44ad">Sätt lönedag</button>
          </div>

          <div class="section" style="text-align: left;">
            <p class="label">Historik</p>
            <div id="list"></div>
          </div>
        </div>

        <script>
          async function update() {
            const res = await fetch('/api/overview');
            const data = await res.json();
            document.getElementById('daily').innerText = data.dailyLimit + ':-';
            document.getElementById('stats').innerHTML = '<b>' + data.remainingBudget + ' kr</b> kvar totalt<br>Lön: ' + data.paydayDate;
            
            const list = document.getElementById('list');
            list.innerHTML = '';
            data.transactions.slice().reverse().forEach(t => {
              const item = document.createElement('div');
              item.className = 'history-item';
              item.innerHTML = '<div>' + t.description + ' (-' + t.amount + ' kr)<br><small style="color:#aaa">' + new Date(t.timestamp).toLocaleDateString() + '</small></div>' +
                                '<button class="undo-btn" onclick="deleteItem(\\'' + t._id + '\\')">Ångra</button>';
              list.appendChild(item);
            });
          }

          async function deleteItem(id) {
            await fetch('/api/delete-transaction/' + id, { method: 'DELETE' });
            update();
          }

          async function saveAction(route, key) {
            const inputId = key === 'amount' ? 'amt' : (key === 'budget' ? 'newBudget' : 'newPayday');
            const val = document.getElementById(inputId).value;
            const desc = document.getElementById('desc').value;
            if(!val) return;
            await fetch(route, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ [key]: Number(val), description: desc || 'Utgift' })
            });
            document.getElementById(inputId).value = '';
            if(key === 'amount') document.getElementById('desc').value = '';
            update();
          }
          update();
        </script>
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log("Server redo på port " + PORT));
