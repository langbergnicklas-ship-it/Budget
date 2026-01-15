const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
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
  category: { type: String, default: "Övrigt" },
  timestamp: { type: Date, default: Date.now }
});

const fixedExpenseSchema = new mongoose.Schema({
  name: String,
  amount: Number
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String },
  theme: { type: String, default: "light" },
  totalSavings: { type: Number, default: 0 },
  monthsArchived: { type: Number, default: 0 },
  initialBudget: { type: Number, default: 12000 },
  remainingBudget: { type: Number, default: 12000 },
  targetPayday: { type: Number, default: 25 },
  fixedExpenses: [fixedExpenseSchema],
  transactions: [transactionSchema]
});

const User = mongoose.model("User", userSchema);

// --- API ROUTES ---
app.post("/api/login", async (req, res) => {
  const { username, password, email } = req.body;
  let user = await User.findOne({ username });
  if (!user) {
    const hashedPassword = await bcrypt.hash(password, 10);
    user = await User.create({ username, password: hashedPassword, email });
    if (email && process.env.BREVO_API_KEY) sendWelcomeEmail(email, username, password);
    return res.json({ success: true });
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(401).json({ success: false });
  res.json({ success: true });
});

app.get("/api/overview/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (!user || !(await bcrypt.compare(req.params.password, user.password))) return res.status(401).json({ error: "Obehörig" });

  const now = new Date();
  let payday = new Date(now.getFullYear(), now.getMonth(), user.targetPayday);
  if (payday.getDay() === 0) payday.setDate(payday.getDate() - 2);
  else if (payday.getDay() === 6) payday.setDate(payday.getDate() - 1);
  if (now >= payday.setHours(23, 59, 59)) {
    payday = new Date(now.getFullYear(), now.getMonth() + 1, user.targetPayday);
    if (payday.getDay() === 0) payday.setDate(payday.getDate() - 2);
    else if (payday.getDay() === 6) payday.setDate(payday.getDate() - 1);
  }

  const daysLeft = Math.max(1, Math.ceil((payday - now) / (1000 * 60 * 60 * 24)));
  const totalFixed = user.fixedExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  
  res.json({
    dailyLimit: Math.floor((user.remainingBudget - totalFixed) / daysLeft),
    daysLeft,
    paydayDate: payday.toLocaleDateString('sv-SE'),
    remainingBudget: user.remainingBudget,
    initialBudget: user.initialBudget,
    totalSavings: user.totalSavings,
    totalFixed,
    fixedExpenses: user.fixedExpenses,
    avgSavings: user.monthsArchived > 0 ? Math.floor(user.totalSavings / user.monthsArchived) : 0,
    usedPercent: Math.min(100, Math.max(0, ((user.initialBudget - user.remainingBudget) / user.initialBudget) * 100)),
    transactions: user.transactions,
    theme: user.theme || "light"
  });
});

app.post("/api/add-fixed/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    user.fixedExpenses.push(req.body);
    await user.save();
    res.json({ success: true });
  }
});

app.delete("/api/delete-fixed/:username/:password/:id", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    user.fixedExpenses.pull(req.params.id);
    await user.save();
    res.json({ success: true });
  }
});

app.post("/api/spend/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    user.remainingBudget -= req.body.amount;
    user.transactions.push(req.body);
    await user.save();
    res.json({ success: true });
  }
});

app.post("/api/set-theme/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    user.theme = req.body.theme;
    await user.save();
    res.json({ success: true });
  }
});

app.post("/api/set-budget/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    user.initialBudget = req.body.budget;
    user.remainingBudget = req.body.budget;
    user.transactions = [];
    await user.save();
    res.json({ success: true });
  }
});

app.post("/api/set-payday/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    user.targetPayday = req.body.payday;
    await user.save();
    res.json({ success: true });
  }
});

app.post("/api/archive-month/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    user.totalSavings += user.remainingBudget;
    user.monthsArchived += 1;
    user.remainingBudget = user.initialBudget;
    user.transactions = [];
    await user.save();
    res.json({ success: true });
  }
});

app.delete("/api/delete-transaction/:username/:password/:id", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    const tx = user.transactions.id(req.params.id);
    if (tx) {
      user.remainingBudget += tx.amount;
      tx.deleteOne();
      await user.save();
    }
    res.json({ success: true });
  }
});

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="sv">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
        <style>
          :root { --bg: #f0f2f5; --card: white; --text: #333; --sub: #666; --border: #eee; --input: #f9f9f9; --primary: #0084ff; }
          body.dark-mode { --bg: #121212; --card: #1e1e1e; --text: #e0e0e0; --sub: #aaa; --border: #333; --input: #2a2a2a; }
          body { font-family: -apple-system, sans-serif; text-align: center; background: var(--bg); color: var(--text); margin: 0; padding-bottom: 80px; transition: 0.3s; }
          .card { background: var(--card); padding: 25px; border-radius: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); max-width: 400px; margin: 15px auto; overflow: hidden; }
          h1 { font-size: 50px; margin: 5px 0; color: #2ecc71; letter-spacing: -2px; }
          .savings-card { background: #e8f5e9; color: #2e7d32; padding: 12px; border-radius: 15px; font-weight: bold; font-size: 13px; }
          .progress-container { background: var(--border); border-radius: 10px; height: 10px; margin: 15px 0; overflow: hidden; }
          .progress-bar { height: 100%; width: 0%; transition: width 0.5s ease; background: #2ecc71; }
          .section { margin-top: 25px; border-top: 1px solid var(--border); padding-top: 20px; }
          input, select { padding: 15px; border: 1px solid var(--border); border-radius: 12px; width: 100%; margin-bottom: 10px; box-sizing: border-box; font-size: 16px; background: var(--input); color: var(--text); }
          button { padding: 15px; background: var(--primary); color: white; border: none; border-radius: 12px; font-weight: bold; width: 100%; cursor: pointer; }
          #toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #333; color: white; padding: 12px 25px; border-radius: 30px; font-size: 14px; font-weight: bold; display: none; z-index: 1000; }
          .tab-bar { position: fixed; bottom: 0; left: 0; right: 0; background: var(--card); display: flex; border-top: 1px solid var(--border); padding: 10px 0; z-index: 999; }
          .tab-btn { flex: 1; background: none; color: var(--sub); border: none; font-size: 12px; font-weight: bold; }
          .tab-btn.active { color: var(--primary); }
          .history-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); text-align: left; font-size: 14px; }
          .cat-tag { font-size: 10px; background: var(--border); padding: 2px 6px; border-radius: 4px; color: var(--sub); margin-right: 5px; }
          .cat-row { margin-bottom: 8px; }
          .cat-bar-bg { background: var(--border); height: 6px; border-radius: 3px; margin-top: 4px; overflow: hidden; }
          .cat-bar-fill { height: 100%; background: var(--primary); border-radius: 3px; transition: 0.5s; }
          .undo-btn { background: #ffe5e5; color: #ff4d4d; padding: 6px 10px; font-size: 11px; border-radius: 8px; border: none; font-weight: bold; }
          .fixed-item { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; border-bottom: 1px dashed var(--border); }
          #loginScreen { display: block; padding-top: 50px; }
          #mainContent { display: none; }
          .view { display: none; }
          .view.active { display: block; }
        </style>
      </head>
      <body>
        <div id="toast">Sparat!</div>
        <div id="loginScreen">
          <div class="card">
            <h2 style="margin-bottom:20px">Budget App</h2>
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
              <p style="font-size:11px; font-weight:bold; color:var(--sub)">REKOMMENDERAD DAGSBUDGET</p>
              <h1 id="daily">...</h1>
              <div class="progress-container"><div id="bar" class="progress-bar"></div></div>
              <p id="stats" style="font-size: 13px; color: var(--sub); margin-bottom: 20px;"></p>
              
              <div id="visualSummary" style="text-align: left; background: var(--input); padding: 15px; border-radius: 15px; margin-bottom: 20px;">
                <p style="font-size: 11px; font-weight: bold; margin-bottom: 12px; color: var(--sub)">UTGIFTER PER KATEGORI</p>
                <div id="catVisualList"></div>
              </div>

              <div class="section">
                <select id="cat">
                  <option value="Övrigt">Välj kategori...</option>
                  <option value="Hushåll">🧼 Hushåll</option>
                  <option value="Mat">🍔 Mat & Dryck</option>
                  <option value="Shopping">🛍️ Shopping</option>
                  <option value="Transport">🚗 Transport</option>
                  <option value="Hyra">🏠 Hem & Hyra</option>
                  <option value="Nöje">🎉 Nöje</option>
                </select>
                <input type="text" id="desc" placeholder="Vad?">
                <input type="number" id="amt" inputmode="decimal" placeholder="Belopp (kr)">
                <button onclick="action('spend', 'amount')">Spara köp</button>
              </div>
              <div id="list" style="margin-top: 20px;"></div>
            </div>
          </div>
          
          <div id="view-fixed" class="view">
            <div class="card">
              <h2>Fasta utgifter</h2>
              <p style="font-size: 12px; color: var(--sub); margin-bottom: 20px;">Dessa dras automatiskt av från din dagsbudget.</p>
              <input type="text" id="fixName" placeholder="T.ex. Netflix">
              <input type="number" id="fixAmt" placeholder="Månadskostnad (kr)">
              <button onclick="addFixed()">Lägg till fast utgift</button>
              <div id="fixedList" style="margin-top: 20px;"></div>
              <div style="margin-top: 15px; font-weight: bold; border-top: 2px solid var(--border); padding-top: 10px;">
                Totalt fasta: <span id="totalFixedDisplay">0</span> kr/mån
              </div>
            </div>
          </div>

          <div id="view-settings" class="view">
            <div class="card">
              <h2>Inställningar</h2>
              <button onclick="toggleTheme()" id="themeBtn" style="background:#444; margin-bottom: 20px;">🌙 Mörkt läge</button>
              <input type="number" id="newBudget" placeholder="Ny budget">
              <button onclick="action('set-budget', 'budget')" style="background:#27ae60; margin-bottom:15px">Uppdatera budget</button>
              <input type="number" id="newPayday" placeholder="Lönedag">
              <button onclick="action('set-payday', 'payday')" style="background:#8e44ad; margin-bottom:25px">Sätt lönedag</button>
              <button onclick="archive()" style="background:#f39c12; margin-bottom:10px">Avsluta månad & spara</button>
              <button onclick="logout()" style="background:#888">Logga ut</button>
            </div>
          </div>

          <div class="tab-bar">
            <button class="tab-btn active" id="btn-home" onclick="showTab('home')">🏠 Hem</button>
            <button class="tab-btn" id="btn-fixed" onclick="showTab('fixed')">📜 Fasta</button>
            <button class="tab-btn" id="btn-settings" onclick="showTab('settings')">⚙️ Inställningar</button>
          </div>
        </div>
        <script>
          let curUser = localStorage.getItem('budget_user');
          let curPass = localStorage.getItem('budget_pass');
          let currentTheme = "light";

          if(curUser && curPass) showApp();

          function applyTheme(theme) {
            currentTheme = theme;
            document.body.classList.toggle('dark-mode', theme === "dark");
            document.getElementById('themeBtn').innerText = theme === "dark" ? "☀️ Ljust läge" : "🌙 Mörkt läge";
          }

          async function toggleTheme() {
            const newTheme = currentTheme === "light" ? "dark" : "light";
            applyTheme(newTheme);
            await fetch('/api/set-theme/' + curUser + '/' + curPass, {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ theme: newTheme })
            });
          }

          function showToast(msg) {
            const t = document.getElementById('toast');
            t.innerText = msg; t.style.display = 'block';
            setTimeout(() => t.style.display = 'none', 2500);
          }

          async function login() {
            const u = document.getElementById('userIn').value, p = document.getElementById('passIn').value, e = document.getElementById('emailIn').value;
            const res = await fetch('/api/login', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ username: u, password: p, email: e })
            });
            if(res.ok) {
              localStorage.setItem('budget_user', u); localStorage.setItem('budget_pass', p);
              curUser = u; curPass = p; showApp();
            } else alert("Fel inloggning.");
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
            if(!res.ok) return logout();
            const data = await res.json();
            applyTheme(data.theme);
            document.getElementById('daily').innerText = data.dailyLimit + ':-';
            document.getElementById('totalSavings').innerText = data.totalSavings;
            document.getElementById('avgSavings').innerText = data.avgSavings;
            document.getElementById('totalFixedDisplay').innerText = data.totalFixed;
            document.getElementById('stats').innerHTML = 'Kvar (efter fasta): <b>' + (data.remainingBudget - data.totalFixed) + ' kr</b> | Lön: ' + data.paydayDate;
            document.getElementById('bar').style.width = data.usedPercent + '%';
            
            const cats = {};
            data.transactions.forEach(t => { const c = t.category || "Övrigt"; cats[c] = (cats[c] || 0) + t.amount; });
            const maxVal = Math.max(...Object.values(cats), 1);
            document.getElementById('catVisualList').innerHTML = Object.entries(cats).map(([name, sum]) => \`
              <div class="cat-row">
                <div style="display:flex; justify-content:space-between; font-size:12px">
                  <span>\${name}</span><b>\${sum} kr</b>
                </div>
                <div class="cat-bar-bg"><div class="cat-bar-fill" style="width: \${(sum/maxVal)*100}%"></div></div>
              </div>
            \`).join('');

            document.getElementById('fixedList').innerHTML = data.fixedExpenses.map(f => \`
              <div class="fixed-item">
                <span>\${f.name}</span>
                <span><b>\${f.amount} kr</b> <button onclick="deleteFixed('\${f._id}')" style="background:none; color:red; width:auto; padding:0; margin-left:10px">✕</button></span>
              </div>
            \`).join('');

            document.getElementById('list').innerHTML = data.transactions.slice(-10).reverse().map(t => \`
              <div class="history-item">
                <div><span class="cat-tag">\${t.category || "Övrigt"}</span>\${t.description || "Utgift"} (-\${t.amount} kr)</div>
                <button class="undo-btn" onclick="deleteItem('\${t._id}')">Ångra</button>
              </div>
            \`).join('');
          }

          async function addFixed() {
            const name = document.getElementById('fixName').value, amount = Number(document.getElementById('fixAmt').value);
            if(!name || !amount) return;
            await fetch('/api/add-fixed/' + curUser + '/' + curPass, {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ name, amount })
            });
            document.getElementById('fixName').value = ''; document.getElementById('fixAmt').value = '';
            update(); showToast("Fast utgift tillagd!");
          }

          async function deleteFixed(id) {
            await fetch('/api/delete-fixed/' + curUser + '/' + curPass + '/' + id, { method: 'DELETE' });
            update();
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
            const body = {};
            if(key === 'amount') {
              body.amount = Number(val);
              body.description = document.getElementById('desc').value;
              body.category = document.getElementById('cat').value;
            } else if(key === 'budget') body.budget = Number(val);
            else if(key === 'payday') body.payday = Number(val);
            
            await fetch('/api/' + type + '/' + curUser + '/' + curPass, {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify(body)
            });
            document.getElementById(inputId).value = ''; 
            if(key === 'amount') document.getElementById('desc').value = '';
            update(); showToast("Sparat!"); if(key !== 'amount') showTab('home');
          }

          async function archive() {
            if(confirm("Spara månaden?")) {
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
