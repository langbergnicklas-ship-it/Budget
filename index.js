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

// --- BREVO API MEJL-FUNKTION ---
async function sendWelcomeEmail(toEmail, username, password) {
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: "Budget Appen", email: process.env.SENDER_EMAIL },
        to: [{ email: toEmail }],
        subject: "Välkommen till din Budget App! 💰",
        htmlContent: `<h2>Hej ${username}!</h2><p>Här är dina uppgifter:</p><ul><li><b>Användarnamn:</b> ${username}</li><li><b>Lösenord:</b> ${password}</li></ul><p><a href="https://budget-epew.onrender.com/">Öppna appen här</a></p>`
      })
    });
    const result = await response.json();
    console.log("Brevo API svar:", result);
  } catch (error) {
    console.error("API Mejlfel:", error);
  }
}

// --- DATA SCHEMA ---
const transactionSchema = new mongoose.Schema({
  description: String,
  amount: Number,
  timestamp: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String },
  totalSavings: { type: Number, default: 0 },
  monthsArchived: { type: Number, default: 0 },
  initialBudget: { type: Number, default: 12000 },
  remainingBudget: { type: Number, default: 12000 },
  targetPayday: { type: Number, default: 25 },
  transactions: [transactionSchema]
});

const User = mongoose.model("User", userSchema);

// --- API ROUTES ---
app.post("/api/login", async (req, res) => {
  const { username, password, email } = req.body;
  let user = await User.findOne({ username });
  if (!user) {
    user = await User.create({ username, password, email });
    if (email && process.env.BREVO_API_KEY) {
      sendWelcomeEmail(email, username, password);
    }
    return res.json({ success: true });
  }
  if (user.password !== password) return res.status(401).json({ success: false });
  res.json({ success: true });
});

app.get("/api/overview/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username, password: req.params.password });
  if (!user) return res.status(401).json({ error: "Obehörig" });

  const now = new Date();
  let payday = new Date(now.getFullYear(), now.getMonth(), user.targetPayday);
  
  // Justera om lönedag är helg
  if (payday.getDay() === 0) payday.setDate(payday.getDate() - 2);
  else if (payday.getDay() === 6) payday.setDate(payday.getDate() - 1);
  
  // Om lönedagen redan varit denna månad, titta på nästa månad
  if (now >= payday.setHours(23, 59, 59)) {
    payday = new Date(now.getFullYear(), now.getMonth() + 1, user.targetPayday);
    if (payday.getDay() === 0) payday.setDate(payday.getDate() - 2);
    else if (payday.getDay() === 6) payday.setDate(payday.getDate() - 1);
  }

  const daysLeft = Math.max(1, Math.ceil((payday - now) / (1000 * 60 * 60 * 24)));
  res.json({
    dailyLimit: Math.floor(user.remainingBudget / daysLeft),
    daysLeft,
    paydayDate: payday.toLocaleDateString('sv-SE'),
    remainingBudget: user.remainingBudget,
    initialBudget: user.initialBudget,
    totalSavings: user.totalSavings,
    avgSavings: user.monthsArchived > 0 ? Math.floor(user.totalSavings / user.monthsArchived) : 0,
    usedPercent: Math.min(100, Math.max(0, ((user.initialBudget - user.remainingBudget) / user.initialBudget) * 100)),
    transactions: user.transactions
  });
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

app.post("/api/set-budget/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username, password: req.params.password });
  if (user) {
    user.initialBudget = req.body.budget;
    user.remainingBudget = req.body.budget;
    user.transactions = [];
    await user.save();
    res.json({ success: true });
  }
});

app.post("/api/set-payday/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username, password: req.params.password });
  if (user) {
    user.targetPayday = req.body.payday;
    await user.save();
    res.json({ success: true });
  }
});

app.post("/api/archive-month/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username, password: req.params.password });
  if (user) {
    user.totalSavings += user.remainingBudget;
    user.monthsArchived += 1;
    user.remainingBudget = user.initialBudget;
    user.transactions = [];
    await user.save();
    res.json({ success: true });
  }
});

app.delete("/api/delete-transaction/:username/:password/:id", async (req, res) => {
  const user = await User.findOne({ username: req.params.username, password: req.params.password });
  if (user) {
    const tx = user.transactions.id(req.params.id);
    if (tx) {
      user.remainingBudget += tx.amount;
      tx.deleteOne();
      await user.save();
    }
    res.json({ success: true });
  }
});

// --- FRONTEND ---
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
        <style>
          body { font-family: -apple-system, sans-serif; text-align: center; background: #f0f2f5; margin: 0; padding-bottom: 80px; }
          .card { background: white; padding: 25px; border-radius: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); max-width: 400px; margin: 20px auto; }
          h1 { font-size: 50px; margin: 5px 0; color: #2ecc71; letter-spacing: -2px; }
          .savings-card { background: #e8f5e9; color: #2e7d32; padding: 12px; border-radius: 15px; font-weight: bold; font-size: 13px; }
          .progress-container { background: #eee; border-radius: 10px; height: 10px; margin: 15px 0; overflow: hidden; }
          .progress-bar { height: 100%; width: 0%; transition: width 0.5s ease; }
          .section { margin-top: 25px; border-top: 1px solid #f0f0f0; padding-top: 20px; }
          input { padding: 15px; border: 1px solid #eee; border-radius: 12px; width: 100%; margin-bottom: 10px; box-sizing: border-box; font-size: 16px; background:#f9f9f9; }
          button { padding: 15px; background: #0084ff; color: white; border: none; border-radius: 12px; font-weight: bold; width: 100%; cursor: pointer; }
          #toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #333; color: white; padding: 12px 25px; border-radius: 30px; font-size: 14px; font-weight: bold; display: none; z-index: 1000; }
          .tab-bar { position: fixed; bottom: 0; left: 0; right: 0; background: white; display: flex; border-top: 1px solid #eee; padding: 10px 0; }
          .tab-btn { flex: 1; background: none; color: #888; border: none; font-size: 12px; font-weight: bold; }
          .tab-btn.active { color: #0084ff; }
          #loginScreen { display: block; padding-top: 50px; }
          #mainContent { display: none; }
          .view { display: none; }
          .view.active { display: block; }
          .history-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f9f9f9; text-align: left; font-size: 14px; }
          .undo-btn { background: #ffe5e5; color: #ff4d4d; padding: 6px 10px; font-size: 11px; border-radius: 8px; border: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div id="toast">Sparat!</div>
        <div id="loginScreen">
          <div class="card">
            <h2>Budget App</h2>
            <input type="text" id="userIn" placeholder="Användarnamn">
            <input type="password" id="passIn" placeholder="Lösenord">
            <input type="email" id="emailIn" placeholder="Din e-post">
            <button onclick="login()">Logga in / Skapa profil</button>
          </div>
        </div>
        <div id="mainContent">
          <div id="view-home" class="view active">
            <div class="card">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:15px">
                <div class="savings-card">💰 Totalt sparat<br><span id="totalSavings">0</span> kr</div>
                <div class="savings-card" style="background:#e3f2fd; color:#1565c0">📈 Snitt/mån<br><span id="avgSavings">0</span> kr</div>
              </div>
              <p style="font-size:11px; font-weight:bold; color:#888">DAGSBUDGET</p>
              <h1 id="daily">...</h1>
              <div class="progress-container"><div id="bar" class="progress-bar"></div></div>
              <p id="stats" style="font-size: 13px; color: #666"></p>
              <div class="section">
                <input type="text" id="desc" placeholder="Vad?">
                <input type="number" id="amt" inputmode="decimal" placeholder="Belopp">
                <button onclick="action('spend', 'amount')">Spara köp</button>
              </div>
              <div id="list" style="margin-top: 20px;"></div>
            </div>
          </div>
          <div id="view-settings" class="view">
            <div class="card">
              <h2>Inställningar</h2>
              <input type="number" id="newBudget" placeholder="Ny månadsbudget">
              <button onclick="action('set-budget', 'budget')" style="background:#27ae60; margin-bottom:15px">Sätt budget</button>
              <input type="number" id="newPayday" placeholder="Lönedag (t.ex. 25)">
              <button onclick="action('set-payday', 'payday')" style="background:#8e44ad; margin-bottom:20px">Sätt lönedag</button>
              <button onclick="archive()" style="background:#f39c12; margin-bottom:10px">Avsluta månad & spara</button>
              <button onclick="logout()" style="background:#888">Logga ut</button>
            </div>
          </div>
          <div class="tab-bar">
            <button class="tab-btn active" id="btn-home" onclick="showTab('home')">🏠 Översikt</button>
            <button class="tab-btn" id="btn-settings" onclick="showTab('settings')">⚙️ Inställningar</button>
          </div>
        </div>
        <script>
          let curUser = localStorage.getItem('budget_user');
          let curPass = localStorage.getItem('budget_pass');
          if(curUser && curPass) showApp();

          function showToast(msg) {
            const t = document.getElementById('toast');
            t.innerText = msg; t.style.display = 'block';
            setTimeout(() => { t.style.display = 'none'; }, 2500);
          }

          async function login() {
            const u = document.getElementById('userIn').value;
            const p = document.getElementById('passIn').value;
            const e = document.getElementById('emailIn').value;
            const res = await fetch('/api/login', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ username: u, password: p, email: e })
            });
            if(res.ok) {
              localStorage.setItem('budget_user', u); localStorage.setItem('budget_pass', p);
              curUser = u; curPass = p; showApp();
            } else { alert("Fel inloggning."); }
          }

          function showApp() {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('mainContent').style.display = 'block';
            update();
          }

          function showTab(tab) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('view-' + tab).classList.add('active');
            document.getElementById('btn-' + tab).classList.add('active');
          }

          async function update() {
            const res = await fetch('/api/overview/' + curUser + '/' + curPass);
            const data = await res.json();
            document.getElementById('daily').innerText = data.dailyLimit + ':-';
            document.getElementById('totalSavings').innerText = data.totalSavings;
            document.getElementById('avgSavings').innerText = data.avgSavings;
            document.getElementById('stats').innerHTML = 'Kvar: <b>' + data.remainingBudget + ' kr</b> | Lön: ' + data.paydayDate;
            document.getElementById('bar').style.width = data.usedPercent + '%';
            document.getElementById('list').innerHTML = data.transactions.slice(-10).reverse().map(t => 
              '<div class="history-item"><div>' + t.description + ' (-' + t.amount + ' kr)</div>' +
              '<button class="undo-btn" onclick="deleteItem(\\'' + t._id + '\\')">Ångra</button></div>'
            ).join('');
          }

          async function deleteItem(id) {
            if(confirm("Ta bort köpet?")) {
              await fetch('/api/delete-transaction/' + curUser + '/' + curPass + '/' + id, { method: 'DELETE' });
              update(); showToast("Borttaget!");
            }
          }

          async function action(type, key) {
            const inputId = key === 'amount' ? 'amt' : (key === 'budget' ? 'newBudget' : 'newPayday');
            const val = document.getElementById(inputId).value;
            if(!val) return;
            const body = { description: document.getElementById('desc').value || 'Utgift' };
            if(key === 'amount') body.amount = Number(val);
            if(key === 'budget') body.budget = Number(val);
            if(key === 'payday') body.payday = Number(val);
            await fetch('/api/' + type + '/' + curUser + '/' + curPass, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify(body)
            });
            document.getElementById(inputId).value = ''; update();
            showToast("Sparat!"); if(key !== 'amount') showTab('home');
          }

          async function archive() {
            if(confirm("Spara överskottet till nästa månad?")) {
              await fetch('/api/archive-month/' + curUser + '/' + curPass, { method: 'POST' });
              update(); showToast("Månaden klar!"); showTab('home');
            }
          }

          function logout() { localStorage.clear(); location.reload(); }
        </script>
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log("Server redo!"));
