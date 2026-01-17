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

// --- MEJL-MOTOR (Brevo API) ---
async function sendEmail(toEmail, subject, html) {
  try {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: "Budget Appen", email: process.env.SENDER_EMAIL },
        to: [{ email: toEmail }],
        subject: subject,
        htmlContent: html
      })
    });
  } catch (error) {
    console.error("Mejlfel:", error);
  }
}

// --- DATA SCHEMA ---
const transactionSchema = new mongoose.Schema({
  description: String,
  amount: Number,
  category: { type: String, default: "Övrigt" },
  isIncome: { type: Boolean, default: false }, // NYTT: Skiljer på utgift och inkomst
  timestamp: { type: Date, default: Date.now }
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
  fixedExpenses: [{ name: String, amount: Number }],
  transactions: [transactionSchema],
  streak: { type: Number, default: 0 },
  lastActive: { type: Date },
  milestones: { type: [String], default: [] }
});

const User = mongoose.model("User", userSchema);

// --- API ROUTES ---

app.post("/api/login", async (req, res) => {
  const { username, password, email } = req.body;
  let user = await User.findOne({ username });
  if (!user) {
    const hashedPassword = await bcrypt.hash(password, 10);
    user = await User.create({ username, password: hashedPassword, email });
    if (email && process.env.BREVO_API_KEY) {
      sendEmail(email, "Välkommen! 💰", `<h2>Hej ${username}!</h2><p>Ditt konto är redo.</p>`);
    }
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
  if (now >= payday.setHours(23, 59, 59)) payday = new Date(now.getFullYear(), now.getMonth() + 1, user.targetPayday);

  const daysLeft = Math.max(1, Math.ceil((payday - now) / (1000 * 60 * 60 * 24)));
  const totalFixed = user.fixedExpenses.reduce((sum, exp) => sum + exp.amount, 0);

  res.json({
    dailyLimit: Math.floor((user.remainingBudget - totalFixed) / daysLeft),
    daysLeft,
    paydayDate: payday.toLocaleDateString('sv-SE'),
    remainingBudget: user.remainingBudget,
    totalFixed,
    fixedExpenses: user.fixedExpenses,
    streak: user.streak || 0,
    milestones: user.milestones || [],
    usedPercent: Math.min(100, Math.max(0, ((user.initialBudget - user.remainingBudget) / user.initialBudget) * 100)),
    transactions: user.transactions,
    theme: user.theme || "light"
  });
});

// UPPDATERAD: Hanterar både utgift och inkomst (plus)
app.post("/api/spend/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    const amount = Number(req.body.amount);
    
    if (req.body.isIncome) {
      user.remainingBudget += amount; // Plussa på budgeten
    } else {
      user.remainingBudget -= amount; // Dra av från budgeten
    }

    user.transactions.push(req.body);

    // Streaks
    const today = new Date().toDateString();
    if (user.lastActive?.toDateString() !== today) {
      user.streak = (user.streak || 0) + 1;
      user.lastActive = new Date();
    }
    await user.save();
    res.json({ success: true });
  }
});

// --- STANDARD RUTINER ---
app.post("/api/add-fixed/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    user.fixedExpenses.push(req.body); await user.save(); res.json({ success: true });
  }
});
app.post("/api/set-theme/:username/:password", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    user.theme = req.body.theme; await user.save(); res.json({ success: true });
  }
});
app.delete("/api/delete-transaction/:username/:password/:id", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (user && await bcrypt.compare(req.params.password, user.password)) {
    const tx = user.transactions.id(req.params.id);
    if (tx) {
      if (tx.isIncome) user.remainingBudget -= tx.amount;
      else user.remainingBudget += tx.amount;
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
          :root { --bg: #f0f2f5; --card: white; --text: #333; --sub: #666; --border: #eee; --input: #f9f9f9; --primary: #0084ff; --plus: #2ecc71; }
          body.dark-mode { --bg: #121212; --card: #1e1e1e; --text: #e0e0e0; --sub: #aaa; --border: #333; --input: #2a2a2a; }
          body { font-family: -apple-system, sans-serif; text-align: center; background: var(--bg); color: var(--text); margin: 0; padding-bottom: 80px; }
          .card { background: var(--card); padding: 25px; border-radius: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); max-width: 400px; margin: 15px auto; }
          h1 { font-size: 50px; margin: 5px 0; color: var(--plus); letter-spacing: -2px; }
          .streak-box { background: #fff3e0; color: #e65100; padding: 5px 15px; border-radius: 20px; font-size: 13px; font-weight: bold; display: inline-block; margin-bottom: 10px; }
          .progress-container { background: var(--border); border-radius: 10px; height: 10px; margin: 15px 0; overflow: hidden; }
          .progress-bar { height: 100%; width: 0%; transition: width 0.5s ease; background: var(--plus); }
          input, select { padding: 15px; border: 1px solid var(--border); border-radius: 12px; width: 100%; margin-bottom: 10px; box-sizing: border-box; font-size: 16px; background: var(--input); color: var(--text); }
          .btn-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          button { padding: 15px; background: var(--primary); color: white; border: none; border-radius: 12px; font-weight: bold; width: 100%; cursor: pointer; }
          button.plus-btn { background: var(--plus); }
          .tab-bar { position: fixed; bottom: 0; left: 0; right: 0; background: var(--card); display: flex; border-top: 1px solid var(--border); padding: 10px 0; }
          .tab-btn { flex: 1; background: none; color: var(--sub); border: none; font-size: 12px; font-weight: bold; }
          .history-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
          .income-text { color: var(--plus); font-weight: bold; }
          .view { display: none; } .view.active { display: block; }
        </style>
      </head>
      <body>
        <div id="loginScreen" class="card" style="margin-top:50px">
          <h2>Budget App</h2>
          <input type="text" id="userIn" placeholder="Användarnamn">
          <input type="password" id="passIn" placeholder="Lösenord">
          <input type="email" id="emailIn" placeholder="E-post">
          <button onclick="login()">Logga in / Skapa profil</button>
        </div>

        <div id="mainContent" style="display:none">
          <div id="view-home" class="view active">
            <div class="card">
              <div id="streakDisplay" class="streak-box">🔥 0 dagars streak</div>
              <p style="font-size:11px; font-weight:bold; color:var(--sub)">DAGSBUDGET JUST NU</p>
              <h1 id="daily">...</h1>
              <div class="progress-container"><div id="bar" class="progress-bar"></div></div>
              <p id="stats" style="font-size: 13px; color: var(--sub); margin-bottom: 20px;"></p>
              
              <div class="section" style="border-top:1px solid var(--border); padding-top:20px">
                <select id="cat">
                  <option value="Mat">🍔 Mat</option>
                  <option value="Hushåll">🧼 Hushåll</option>
                  <option value="Swish/Plus">💸 Insättning/Swish</option>
                  <option value="Övrigt">Övrigt</option>
                </select>
                <input type="text" id="desc" placeholder="Vad? (t.ex. Swish från mamma)">
                <input type="number" id="amt" inputmode="decimal" placeholder="Belopp (kr)">
                <div class="btn-group">
                  <button onclick="saveTx(false)">Spara köp</button>
                  <button class="plus-btn" onclick="saveTx(true)">+ Lägg till</button>
                </div>
              </div>
              <div id="list" style="margin-top: 20px;"></div>
            </div>
          </div>

          <div id="view-settings" class="view">
            <div class="card">
              <h2>Inställningar</h2>
              <button onclick="toggleTheme()" style="margin-bottom:10px">🌙 Ändra tema</button>
              <button onclick="logout()" style="background:#888">Logga ut</button>
            </div>
          </div>

          <div class="tab-bar">
            <button class="tab-btn" onclick="showTab('home')">🏠 Hem</button>
            <button class="tab-btn" onclick="showTab('settings')">⚙️ Inställningar</button>
          </div>
        </div>

        <script>
          let curUser = localStorage.getItem('budget_user'), curPass = localStorage.getItem('budget_pass');
          if(curUser && curPass) showApp();

          async function login() {
            const u = document.getElementById('userIn').value, p = document.getElementById('passIn').value, e = document.getElementById('emailIn').value;
            const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u, password:p, email:e}) });
            if(res.ok) { localStorage.setItem('budget_user', u); localStorage.setItem('budget_pass', p); curUser=u; curPass=p; showApp(); }
          }

          function showApp() { document.getElementById('loginScreen').style.display='none'; document.getElementById('mainContent').style.display='block'; update(); }
          function showTab(t) { document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); document.getElementById('view-'+t).classList.add('active'); }

          async function update() {
            const res = await fetch('/api/overview/'+curUser+'/'+curPass);
            const data = await res.json();
            document.body.classList.toggle('dark-mode', data.theme === 'dark');
            document.getElementById('daily').innerText = data.dailyLimit + ':-';
            document.getElementById('streakDisplay').innerText = "🔥 " + data.streak + " dagars streak";
            document.getElementById('stats').innerHTML = "Kvar att använda: <b>" + (data.remainingBudget - data.totalFixed) + " kr</b>";
            document.getElementById('bar').style.width = data.usedPercent + '%';
            document.getElementById('list').innerHTML = data.transactions.slice(-10).reverse().map(t => \`
              <div class="history-item">
                <span class="\${t.isIncome ? 'income-text' : ''}">\${t.isIncome ? '+' : '-'}\${t.amount} kr (\${t.category})</span>
                <button onclick="deleteTx('\${t._id}')" style="width:auto; background:none; color:red; padding:0">✕</button>
              </div>\`).join('');
          }

          async function saveTx(isIncome) {
            const amt = document.getElementById('amt').value, cat = document.getElementById('cat').value, desc = document.getElementById('desc').value;
            await fetch('/api/spend/'+curUser+'/'+curPass, {
              method:'POST', headers:{'Content-Type':'application/json'},
              body:JSON.stringify({amount:Number(amt), category:cat, description:desc, isIncome})
            });
            document.getElementById('amt').value=''; update();
          }

          async function deleteTx(id) { await fetch('/api/delete-transaction/'+curUser+'/'+curPass+'/'+id, {method:'DELETE'}); update(); }
          async function toggleTheme() {
            const theme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
            await fetch('/api/set-theme/'+curUser+'/'+curPass, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({theme})});
            update();
          }
          function logout() { localStorage.clear(); location.reload(); }
        </script>
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log("Server redo!"));
