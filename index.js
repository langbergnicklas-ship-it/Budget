const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cron = require("node-cron");
const webPush = require("web-push");
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "hemlig_nyckel_budget_kollen";

const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

if (publicVapidKey && privateVapidKey) {
  try {
    webPush.setVapidDetails('mailto:test@example.com', publicVapidKey, privateVapidKey);
  } catch (err) { console.error("Push error:", err); }
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log("LYCKAD: Ansluten till MongoDB!"))
  .catch(err => console.error("DATABASE ERROR:", err));

async function sendEmail(toEmail, subject, html) {
  try {
    if (!process.env.BREVO_API_KEY) return;
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "accept": "application/json", "api-key": process.env.BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ sender: { name: "Budget kollen", email: process.env.SENDER_EMAIL }, to: [{ email: toEmail }], subject: subject, htmlContent: html })
    });
  } catch (error) { console.error("Mejlfel:", error); }
}

const transactionSchema = new mongoose.Schema({ description: String, amount: Number, category: { type: String, default: "Övrigt" }, isIncome: { type: Boolean, default: false }, timestamp: { type: Date, default: Date.now } });
const userSchema = new mongoose.Schema({ 
  username: { type: String, required: true, unique: true }, 
  password: { type: String, required: true }, 
  email: String, 
  theme: { type: String, default: "light" }, 
  totalSavings: { type: Number, default: 0 }, 
  monthsArchived: { type: Number, default: 0 }, 
  initialBudget: { type: Number, default: 12000 }, 
  remainingBudget: { type: Number, default: 12000 }, 
  targetPayday: { type: Number, default: 25 }, 
  fixedExpenses: [{ name: String, amount: Number }], 
  transactions: [transactionSchema], 
  streak: { type: Number, default: 0 }, 
  lastActive: { type: Date, default: Date.now }, 
  milestones: { type: [String], default: [] },
  pushSubscription: { type: Object }
});
const User = mongoose.model("User", userSchema);

cron.schedule("0 9 * * *", async () => {
  if (!publicVapidKey || !privateVapidKey) return;
  const users = await User.find({});
  const today = new Date();
  
  users.forEach(async (user) => {
    if (!user.pushSubscription) return; 
    let title = ""; let body = "";
    if (today.getDate() === user.targetPayday) { title = "Lönedag! 💸"; body = "Pengarna har rullat in. Dags att budgetera!"; }
    
    if (user.lastActive) {
      const diffTime = Math.abs(today - user.lastActive);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      if (diffDays >= 2) { 
        title = "Rädda din streak! 🔥"; 
        body = "Gå in i appen idag för att inte tappa din streak."; 
      }
    }
    if (title) {
      try { await webPush.sendNotification(user.pushSubscription, JSON.stringify({ title, body })); } 
      catch (err) { console.error("Push fel", err); }
    }
  });
});

const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: "Ingen token" });
  jwt.verify(token, JWT_SECRET, (err, user) => { if (err) return res.status(403).json({ error: "Ogiltig token" }); req.user = user; next(); });
};

app.get('/manifest.json', (req, res) => {
  res.json({
    "name": "Budget kollen", "short_name": "Budget", "start_url": "/", "display": "standalone", "background_color": "#ffffff", "theme_color": "#0084ff",
    "icons": [{ "src": "https://cdn-icons-png.flaticon.com/512/2953/2953363.png", "sizes": "192x192", "type": "image/png" }, { "src": "https://cdn-icons-png.flaticon.com/512/2953/2953363.png", "sizes": "512x512", "type": "image/png" }]
  });
});
app.get('/service-worker.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(`self.addEventListener('install', (e) => { self.skipWaiting(); }); self.addEventListener('push', (e) => { const data = e.data.json(); self.registration.showNotification(data.title, { body: data.body, icon: 'https://cdn-icons-png.flaticon.com/512/2953/2953363.png' }); });`);
});

app.post("/api/auth", async (req, res) => {
  try {
    const { username, password, email } = req.body;
    let user = await User.findOne({ username });
    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await User.create({ username, password: hashedPassword, email, lastActive: new Date(), streak: 1 });
      if (email && process.env.BREVO_API_KEY) sendEmail(email, "Välkommen!", `<h2>Hej ${username}!</h2>`);
    } else { if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Fel lösenord" }); }
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, username: user.username });
  } catch (err) { res.status(500).json({ error: "Serverfel" }); }
});

app.post("/api/subscribe", authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  user.pushSubscription = req.body; await user.save(); res.json({ success: true });
});

app.get("/api/overview", authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  const now = new Date();
  
  const todayStr = now.toDateString();
  const lastActiveStr = user.lastActive ? user.lastActive.toDateString() : null;

  if (lastActiveStr !== todayStr) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (user.lastActive && user.lastActive.toDateString() === yesterday.toDateString()) {
      user.streak = (user.streak || 0) + 1;
    } else {
      user.streak = 1;
    }
    user.lastActive = now;
    if (user.streak === 3 && !user.milestones.includes("3-dagars streak!")) user.milestones.push("3-dagars streak!");
    if (user.streak === 7 && !user.milestones.includes("1 vecka!")) user.milestones.push("1 vecka!");
    await user.save();
  }

  let payday = new Date(now.getFullYear(), now.getMonth(), user.targetPayday);
  if (payday.getDay() === 0) payday.setDate(payday.getDate() - 2); else if (payday.getDay() === 6) payday.setDate(payday.getDate() - 1);
  if (now >= payday.setHours(23, 59, 59)) payday = new Date(now.getFullYear(), now.getMonth() + 1, user.targetPayday);
  const daysLeft = Math.max(1, Math.ceil((payday - now) / (1000 * 60 * 60 * 24)));
  const totalFixed = user.fixedExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  const avgSavings = user.monthsArchived > 0 ? Math.floor(user.totalSavings / user.monthsArchived) : 0;
  
  res.json({ dailyLimit: Math.floor((user.remainingBudget - totalFixed) / daysLeft), daysLeft, paydayDate: payday.toLocaleDateString('sv-SE'), remainingBudget: user.remainingBudget, initialBudget: user.initialBudget, totalSavings: user.totalSavings, avgSavings, totalFixed, fixedExpenses: user.fixedExpenses, streak: user.streak || 1, milestones: user.milestones || [], usedPercent: Math.min(100, Math.max(0, ((user.initialBudget - user.remainingBudget) / user.initialBudget) * 100)), transactions: user.transactions, theme: user.theme || "light", publicVapidKey: process.env.VAPID_PUBLIC_KEY || "" });
});

app.post("/api/spend", authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  const amount = Number(req.body.amount);
  if (req.body.isIncome) user.remainingBudget += amount; else user.remainingBudget -= amount;
  user.transactions.push(req.body);
  if (user.totalSavings >= 5000 && !user.milestones.includes("Spar-kung")) user.milestones.push("Spar-kung");
  await user.save(); res.json({ success: true });
});

app.post("/api/send-summary", authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (user.email) {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weeklyTx = user.transactions.filter(t => t.timestamp > weekAgo);
    const totalSpent = weeklyTx.reduce((sum, t) => sum + (t.isIncome ? 0 : t.amount), 0);
    const html = `<h2>Budget kollen: Veckosummering 📊</h2><p>Spenderat: <b>${totalSpent} kr</b></p><p>Streak: 🔥 <b>${user.streak}</b></p>`;
    await sendEmail(user.email, "Sammanfattning av din vecka!", html);
  }
  res.json({ success: true });
});

app.post("/api/add-fixed", authenticateToken, async (req, res) => { const user = await User.findById(req.user.id); user.fixedExpenses.push(req.body); await user.save(); res.json({ success: true }); });
app.delete("/api/delete-fixed/:id", authenticateToken, async (req, res) => { const user = await User.findById(req.user.id); user.fixedExpenses.pull(req.params.id); await user.save(); res.json({ success: true }); });
app.post("/api/set-theme", authenticateToken, async (req, res) => { const user = await User.findById(req.user.id); user.theme = req.body.theme; await user.save(); res.json({ success: true }); });
app.post("/api/set-budget", authenticateToken, async (req, res) => { const user = await User.findById(req.user.id); user.initialBudget = req.body.budget; user.remainingBudget = req.body.budget; user.transactions = []; await user.save(); res.json({ success: true }); });
app.post("/api/set-payday", authenticateToken, async (req, res) => { const user = await User.findById(req.user.id); user.targetPayday = req.body.payday; await user.save(); res.json({ success: true }); });
app.post("/api/archive-month", authenticateToken, async (req, res) => { const user = await User.findById(req.user.id); user.totalSavings += user.remainingBudget; user.monthsArchived += 1; user.remainingBudget = user.initialBudget; user.transactions = []; await user.save(); res.json({ success: true }); });
app.delete("/api/delete-transaction/:id", authenticateToken, async (req, res) => { const user = await User.findById(req.user.id); const tx = user.transactions.id(req.params.id); if (tx) { if (tx.isIncome) user.remainingBudget -= tx.amount; else user.remainingBudget += tx.amount; tx.deleteOne(); await user.save(); } res.json({ success: true }); });

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="sv">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
        <title>Budget kollen</title>
        <link rel="manifest" href="/manifest.json">
        <meta name="theme-color" content="#0084ff">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
        <link rel="apple-touch-icon" href="https://cdn-icons-png.flaticon.com/512/2953/2953363.png">
        <style>
          :root { --bg: #f0f2f5; --card: white; --text: #333; --sub: #666; --border: #eee; --input: #f9f9f9; --primary: #0084ff; --plus: #2ecc71; }
          body.dark-mode { --bg: #121212; --card: #1e1e1e; --text: #e0e0e0; --sub: #aaa; --border: #333; --input: #2a2a2a; }
          body { font-family: -apple-system, sans-serif; text-align: center; background: var(--bg); color: var(--text); margin: 0; padding-bottom: 80px; transition: 0.3s; }
          .card { background: var(--card); padding: 25px; border-radius: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); max-width: 400px; margin: 15px auto; overflow: hidden; }
          h1 { font-size: 50px; margin: 5px 0; color: var(--plus); letter-spacing: -2px; }
          .streak-box { background: #fff3e0; color: #e65100; padding: 5px 15px; border-radius: 20px; font-size: 13px; font-weight: bold; display: inline-block; margin-bottom: 10px; }
          .milestone-tag { background: #f3e5f5; color: #7b1fa2; padding: 4px 10px; border-radius: 8px; font-size: 11px; margin: 2px; display: inline-block; }
          .savings-card { background: #e8f5e9; color: #2e7d32; padding: 12px; border-radius: 15px; font-weight: bold; font-size: 13px; }
          .progress-container { background: var(--border); border-radius: 10px; height: 10px; margin: 15px 0; overflow: hidden; }
          .progress-bar { height: 100%; width: 0%; transition: width 0.5s ease; background: var(--plus); }
          input, select { padding: 15px; border: 1px solid var(--border); border-radius: 12px; width: 100%; margin-bottom: 10px; box-sizing: border-box; font-size: 16px; background: var(--input); color: var(--text); }
          .btn-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          button { padding: 15px; background: var(--primary); color: white; border: none; border-radius: 12px; font-weight: bold; width: 100%; cursor: pointer; }
          button.plus-btn { background: var(--plus); }
          button.affiliate-btn { background: #8e44ad; color: white; margin-bottom: 8px; }
          .tab-bar { position: fixed; bottom: 0; left: 0; right: 0; background: var(--card); display: flex; border-top: 1px solid var(--border); padding: 10px 0; z-index: 999; }
          .tab-btn { flex: 1; background: none; color: var(--sub); border: none; font-size: 12px; font-weight: bold; }
          .tab-btn.active { color: var(--primary); }
          .history-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); text-align: left; font-size: 14px; }
          .cat-tag { font-size: 10px; background: var(--border); padding: 2px 6px; border-radius: 4px; color: var(--sub); margin-right: 5px; }
          .income-text { color: var(--plus); font-weight: bold; }
          .view { display: none; } .view.active { display: block; }
          #loginScreen { padding-top: 50px; }
        </style>
      </head>
      <body>
        <div id="toast" style="position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#333; color:white; padding:12px 25px; border-radius:30px; display:none; z-index:1000;">Sparat!</div>
        <div id="loginScreen">
          <div class="card">
            <h2 style="margin-bottom:20px">Budget kollen</h2>
            <input type="text" id="userIn" placeholder="Användarnamn">
            <input type="password" id="passIn" placeholder="Lösenord">
            <input type="email" id="emailIn" placeholder="E-post (Viktigt för notiser!)">
            <button onclick="login()">Logga in / Skapa profil</button>
          </div>
        </div>
        <div id="mainContent" style="display:none">
          <div id="view-home" class="view active">
            <div class="card">
              <div id="streakDisplay" class="streak-box">🔥 0 dagars streak</div>
              <div id="milestonesList"></div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:15px">
                <div class="savings-card">💰 Totalt sparat<br><span id="totalSavings">0</span> kr</div>
                <div class="savings-card" style="background:#e3f2fd; color:#1565c0">📈 Snitt/mån<br><span id="avgSavings">0</span> kr</div>
              </div>
              <p style="font-size:11px; font-weight:bold; color:var(--sub)">REKOMMENDERAD DAGSBUDGET</p>
              
              <h1 id="daily">...</h1>
              
              <div class="progress-container"><div id="bar" class="progress-bar"></div></div>
              <p id="stats" style="font-size: 13px; color: var(--sub); margin-bottom: 20px;"></p>
              <div class="section">
                <select id="cat">
                  <option value="Mat">🍔 Mat</option><option value="Hushåll">🧼 Hushåll</option>
                  <option value="Shopping">🛍️ Shopping</option><option value="Transport">🚗 Transport</option>
                  <option value="Inkomst">💸 Inkomst</option><option value="Övrigt">Övrigt</option>
                </select>
                <input type="text" id="desc" placeholder="Vad?">
                <input type="number" id="amt" inputmode="decimal" placeholder="Belopp (kr)">
                <div class="btn-group">
                  <button onclick="saveTx(false)">Spara köp</button>
                  <button class="plus-btn" onclick="saveTx(true)">+ Inkomst</button>
                </div>
              </div>
              <div id="list" style="margin-top: 20px;"></div>
            </div>
          </div>
          <div id="view-fixed" class="view">
            <div class="card">
              <h2>Fasta utgifter</h2>
              <input type="text" id="fixName" placeholder="T.ex. Netflix">
              <input type="number" id="fixAmt" placeholder="Kostnad (kr)">
              <button onclick="addFixed()">Lägg till</button>
              <div id="fixedList" style="margin-top: 20px;"></div>
            </div>
          </div>
          <div id="view-settings" class="view">
            <div class="card">
              <h2>Inställningar</h2>
              <div style="background:var(--input); padding:15px; border-radius:15px; margin-bottom:20px;">
                <p style="font-weight:bold; font-size:12px; margin-top:0;">SPARA PENGAR & STÖTTA</p>
                <button class="affiliate-btn" onclick="window.open('https://www.compricer.se', '_blank')">⚡ Jämför elavtal</button>
                <button class="affiliate-btn" onclick="window.open('https://buymeacoffee.com/northernsuccess', '_blank')" style="background:#FF813F">☕ Bjud på en kaffe</button>
              </div>
              
              <div id="pushSection" style="margin-bottom:15px;">
                <button onclick="enableNotifs()" style="background:#27ae60; margin-bottom:10px;">🔔 Aktivera Push-notiser</button>
              </div>

              <button onclick="sendSummary()" style="background:#f39c12; margin-bottom: 20px;">📧 Veckosummering till mejl</button>
              <button onclick="toggleTheme()" id="themeBtn" style="background:#444; margin-bottom: 20px;">🌙 Mörkt läge</button>
              <input type="number" id="newBudget" placeholder="Ny månadsbudget (kr)">
              <button onclick="action('set-budget', 'budget')" style="background:#27ae60; margin-bottom:15px">Uppdatera budget</button>
              <input type="number" id="newPayday" placeholder="Ny lönedag (t.ex. 25)">
              <button onclick="action('set-payday', 'payday')" style="background:#8e44ad; margin-bottom:25px">Sätt lönedag</button>
              <button onclick="archive()" style="background:#f39c12; margin-bottom:10px">Avsluta månad & spara</button>
              <button onclick="logout()" style="background:#888; margin-top:20px">Logga ut</button>
            </div>
          </div>
          <div class="tab-bar">
            <button class="tab-btn active" id="btn-home" onclick="showTab('home')">🏠 Hem</button>
            <button class="tab-btn" id="btn-fixed" onclick="showTab('fixed')">📜 Fasta</button>
            <button class="tab-btn" id="btn-settings" onclick="showTab('settings')">⚙️ Inställningar</button>
          </div>
        </div>
        <script>
          if('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js');
          let token = localStorage.getItem('budget_token'); 
          let publicVapidKey = ""; 

          async function initApp() {
            if(token) await update();
          }
          if(token) initApp();

          function api(url, method='GET', body=null) { const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': token } }; if(body) opts.body = JSON.stringify(body); return fetch(url, opts); }
          async function login() { const u = document.getElementById('userIn').value, p = document.getElementById('passIn').value, e = document.getElementById('emailIn').value; const res = await fetch('/api/auth', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: u, password: p, email: e }) }); const data = await res.json(); if(res.ok) { localStorage.setItem('budget_token', data.token); token = data.token; showApp(); } else alert(data.error || "Fel!"); }
          function showApp() { document.getElementById('loginScreen').style.display='none'; document.getElementById('mainContent').style.display='block'; update(); }
          function showTab(t) { document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active')); document.getElementById('view-'+t).classList.add('active'); document.getElementById('btn-'+t).classList.add('active'); }
          async function update() { 
            const res = await api('/api/overview'); 
            if(!res.ok) return logout(); 
            const data = await res.json(); 
            publicVapidKey = data.publicVapidKey;
            
            if(!publicVapidKey) document.getElementById('pushSection').style.display = 'none';

            document.body.classList.toggle('dark-mode', data.theme === 'dark'); 
            
            // HÄR ÄR ÄNDRINGEN (MARGIN-TOP 15px istället för 5px)
            document.getElementById('daily').innerHTML = data.dailyLimit + ':- <span style="font-size:16px; color:var(--sub); font-weight:normal; vertical-align:middle; display:block; margin-top:15px;">(' + data.daysLeft + ' dagar till lön)</span>';
            
            document.getElementById('totalSavings').innerText = data.totalSavings; 
            document.getElementById('avgSavings').innerText = data.avgSavings; 
            document.getElementById('streakDisplay').innerText = "🔥 " + data.streak + " dagars streak"; 
            document.getElementById('bar').style.width = data.usedPercent + '%'; 
            document.getElementById('stats').innerHTML = "Kvar: <b>" + (data.remainingBudget - data.totalFixed) + " kr</b> | Lön: " + data.paydayDate; 
            document.getElementById('milestonesList').innerHTML = data.milestones.map(m=>'<span class="milestone-tag">🏆 '+m+'</span>').join(''); 
            document.getElementById('fixedList').innerHTML = data.fixedExpenses.map(f => \`<div class="history-item">\${f.name} (\${f.amount} kr) <button onclick="deleteFixed('\${f._id}')" style="background:none;color:red;width:auto;padding:0">✕</button></div>\`).join(''); 
            document.getElementById('list').innerHTML = data.transactions.slice(-10).reverse().map(t => \`<div class="history-item"><div><span class="cat-tag">\${t.category}</span>\${t.description} (<span class="\${t.isIncome?'income-text':''}">\${t.isIncome?'+':'-'}\${t.amount} kr</span>)</div><button onclick="deleteItem('\${t._id}')" style="background:none;color:red;width:auto;padding:0">✕</button></div>\`).join(''); 
          }
          async function saveTx(isIncome) { const amt = document.getElementById('amt').value, cat = document.getElementById('cat').value, desc = document.getElementById('desc').value; await api('/api/spend', 'POST', {amount:Number(amt), category:cat, description:desc, isIncome}); document.getElementById('amt').value=''; update(); showToast("Sparat!"); }
          async function addFixed() { const name = document.getElementById('fixName').value, amount = Number(document.getElementById('fixAmt').value); await api('/api/add-fixed', 'POST', {name, amount}); update(); showToast("Fast utgift tillagd!"); }
          async function action(type, key) { const val = document.getElementById(key === 'budget' ? 'newBudget' : 'newPayday').value; if(!val) return; const body = {}; body[key] = Number(val); await api('/api/set-'+type, 'POST', body); document.getElementById(key === 'budget' ? 'newBudget' : 'newPayday').value = ''; update(); showToast("Uppdaterat!"); }
          async function deleteFixed(id) { await api('/api/delete-fixed/'+id, 'DELETE'); update(); }
          async function deleteItem(id) { await api('/api/delete-transaction/'+id, 'DELETE'); update(); }
          async function sendSummary() { await api('/api/send-summary', 'POST'); showToast("Skickat!"); }
          async function toggleTheme() { const theme = document.body.classList.contains('dark-mode') ? 'light' : 'dark'; await api('/api/set-theme', 'POST', {theme}); update(); }
          async function archive() { if(confirm("Spara månaden?")) { await api('/api/archive-month', 'POST'); update(); } }
          
          async function enableNotifs() {
            if(!publicVapidKey) return alert("VAPID-nyckel saknas i Render! Lägg till den i Environment Variables.");
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicVapidKey });
            await api('/api/subscribe', 'POST', sub);
            showToast("Notiser påslagna!");
          }

          function logout() { localStorage.removeItem('budget_token'); location.reload(); }
          function showToast(msg) { const t = document.getElementById('toast'); t.innerText = msg; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 2500); }
        </script>
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log("Server redo!"));
