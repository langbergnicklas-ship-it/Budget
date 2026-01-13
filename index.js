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

// 1. SCHEMA MED SPAR-STATISTIK
const transactionSchema = new mongoose.Schema({
  description: String,
  amount: Number,
  timestamp: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  totalSavings: { type: Number, default: 0 },
  monthsArchived: { type: Number, default: 0 }, // Nytt fält för att räkna snittet
  initialBudget: { type: Number, default: 12000 },
  remainingBudget: { type: Number, default: 12000 },
  targetPayday: { type: Number, default: 25 },
  transactions: [transactionSchema]
});

const User = mongoose.model("User", userSchema);

// 2. API ROUTES
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  let user = await User.findOne({ username });
  if (!user) {
    user = await User.create({ username, password });
    return res.json({ success: true });
  }
  if (user.password !== password) return res.status(401).json({ success: false, message: "Fel lösenord!" });
  res.json({ success: true });
});

app.get("/api/overview/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username, password: req.params.password });
  if (!user) return res.status(401).json({ error: "Obehörig" });

  const now = new Date();
  let payday = new Date(now.getFullYear(), now.getMonth(), user.targetPayday);
  if (payday.getDay() === 0) payday.setDate(payday.getDate() - 2);
  else if (payday.getDay() === 6) payday.setDate(payday.getDate() - 1);
  if (now >= payday.setHours(23, 59, 59)) {
    payday = new Date(now.getFullYear(), now.getMonth() + 1, user.targetPayday);
  }

  const daysLeft = Math.max(1, Math.ceil((payday - now) / (1000 * 60 * 60 * 24)));
  const usedPercent = Math.min(100, Math.max(0, ((user.initialBudget - user.remainingBudget) / user.initialBudget) * 100));
  
  // Räkna ut snittsparande
  const avgSavings = user.monthsArchived > 0 ? Math.floor(user.totalSavings / user.monthsArchived) : 0;

  res.json({
    dailyLimit: Math.floor(user.remainingBudget / daysLeft),
    daysLeft,
    paydayDate: payday.toLocaleDateString('sv-SE'),
    remainingBudget: user.remainingBudget,
    totalSavings: user.totalSavings,
    avgSavings, // Skickar med snittet till frontend
    usedPercent,
    transactions: user.transactions
  });
});

app.post("/api/archive-month/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username, password: req.params.password });
  if (user) {
    user.totalSavings += user.remainingBudget;
    user.monthsArchived += 1; // Öka antal månader när man sparar
    user.remainingBudget = user.initialBudget;
    user.transactions = [];
    await user.save();
    res.json({ success: true });
  }
});

app.post("/api/spend/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username, password: req.params.password });
  if (user) {
    user.remainingBudget -= req.body.amount;
    user.transactions.push({ amount: req.body.amount, description: req.body.description });
    await user.save();
    res.json({ success: true });
  }
});

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <style>
          body { font-family: -apple-system, sans-serif; text-align: center; padding: 20px; background: #f0f2f5; margin: 0; }
          .card { background: white; padding: 25px; border-radius: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); max-width: 400px; margin: auto; }
          h1 { font-size: 50px; margin: 5px 0; color: #2ecc71; }
          .savings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
          .savings-card { background: #e8f5e9; color: #2e7d32; padding: 12px; border-radius: 15px; font-weight: bold; font-size: 13px; }
          .progress-container { background: #eee; border-radius: 10px; height: 10px; margin: 15px 0; overflow: hidden; }
          .progress-bar { height: 100%; width: 0%; transition: width 0.5s ease; }
          .section { margin-top: 25px; border-top: 1px solid #f0f0f0; padding-top: 20px; }
          input { padding: 15px; border: 1px solid #eee; border-radius: 12px; width: 100%; margin-bottom: 10px; box-sizing: border-box; font-size: 16px; }
          button { padding: 15px; background: #0084ff; color: white; border: none; border-radius: 12px; font-weight: bold; width: 100%; cursor: pointer; }
          #loginScreen { display: block; }
          #appScreen { display: none; }
          .history-item { font-size: 14px; border-bottom: 1px solid #eee; padding: 10px 0; text-align: left; }
        </style>
      </head>
      <body>
        <div id="loginScreen" class="card">
          <h2 style="margin-bottom:20px">Budget App</h2>
          <input type="text" id="userIn" placeholder="Användarnamn">
          <input type="password" id="passIn" placeholder="Lösenord">
          <button onclick="login()">Logga in / Skapa profil</button>
        </div>

        <div id="appScreen" class="card">
          <div class="savings-grid">
            <div class="savings-card">💰 Totalt sparat<br><span id="totalSavings" style="font-size:18px">0</span> kr</div>
            <div class="savings-card" style="background:#e3f2fd; color:#1565c0">📈 Snitt/månad<br><span id="avgSavings" style="font-size:18px">0</span> kr</div>
          </div>
          
          <p style="font-size: 11px; font-weight:bold; color:#888; letter-spacing:1px">IDAG KAN DU GÖRA AV MED</p>
          <h1 id="daily">...</h1>
          <div class="progress-container"><div id="bar" class="progress-bar"></div></div>
          <p id="stats" style="font-size: 13px; color: #666"></p>

          <div class="section">
            <input type="text" id="desc" placeholder="Vad har du köpt?">
            <input type="number" id="amt" inputmode="decimal" placeholder="Belopp i kr">
            <button onclick="action('spend')">Spara köp</button>
          </div>

          <div class="section">
            <button onclick="archive()" style="background:#27ae60">Avsluta månad & Spara</button>
          </div>
          
          <div id="list" style="margin-top: 20px;"></div>
          <button onclick="logout()" style="background:none; color:#999; font-size:12px; margin-top:30px">Logga ut från profil</button>
        </div>

        <script>
          let curUser = localStorage.getItem('budget_user');
          let curPass = localStorage.getItem('budget_pass');

          if(curUser && curPass) showApp();

          async function login() {
            const u = document.getElementById('userIn').value;
            const p = document.getElementById('passIn').value;
            const res = await fetch('/api/login', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ username: u, password: p })
            });
            if(res.ok) {
              localStorage.setItem('budget_user', u);
              localStorage.setItem('budget_pass', p);
              curUser = u; curPass = p;
              showApp();
            } else { alert("Fel lösenord eller problem med inloggning."); }
          }

          function showApp() {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('appScreen').style.display = 'block';
            update();
          }

          async function update() {
            const res = await fetch('/api/overview/' + curUser + '/' + curPass);
            const data = await res.json();
            document.getElementById('daily').innerText = data.dailyLimit + ':-';
            document.getElementById('totalSavings').innerText = data.totalSavings;
            document.getElementById('avgSavings').innerText = data.avgSavings;
            document.getElementById('stats').innerHTML = 'Kvar: <b>' + data.remainingBudget + ' kr</b> | Lön: ' + data.paydayDate;
            
            const bar = document.getElementById('bar');
            bar.style.width = data.usedPercent + '%';
            bar.style.backgroundColor = data.usedPercent < 50 ? '#2ecc71' : (data.usedPercent < 80 ? '#f1c40f' : '#e74c3c');
            
            document.getElementById('list').innerHTML = data.transactions.slice(-5).reverse().map(t => 
              '<div class="history-item">' + t.description + ' <span style="float:right; color:#ff4d4d">-' + t.amount + ' kr</span></div>'
            ).join('');
          }

          async function action(type) {
            const amt = document.getElementById('amt').value;
            const desc = document.getElementById('desc').value;
            if(!amt) return;
            await fetch('/api/' + type + '/' + curUser + '/' + curPass, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ amount: Number(amt), description: desc || 'Utgift' })
            });
            document.getElementById('amt').value = '';
            document.getElementById('desc').value = '';
            update();
          }

          async function archive() {
            if(confirm("Vill du flytta dina kvarvarande pengar till spargrisen och börja på en ny månad?")) {
              await fetch('/api/archive-month/' + curUser + '/' + curPass, { method: 'POST' });
              update();
            }
          }

          function logout() {
            localStorage.clear();
            location.reload();
          }
        </script>
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log("Server redo!"));
