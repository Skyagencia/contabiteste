const exportBtn = document.getElementById("exportBtn");
const categorySelect = document.getElementById("category");
const categoryFilter = document.getElementById("categoryFilter");
const monthInput = document.getElementById("monthInput");
const incomeValue = document.getElementById("incomeValue");
const expenseValue = document.getElementById("expenseValue");
const balanceValue = document.getElementById("balanceValue");
const listEl = document.getElementById("list");
const hint = document.getElementById("hint");

const form = document.getElementById("txForm");
const typeEl = document.getElementById("type");
const amountEl = document.getElementById("amount");
const categoryEl = document.getElementById("category");
const descriptionEl = document.getElementById("description");
const dateEl = document.getElementById("date");

function formatBRL(cents){
  return (cents / 100).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

function todayISO(){
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function currentMonth(){
  return new Date().toISOString().slice(0,7);
}

async function load(){
  const month = monthInput.value || currentMonth();
  const cat = categoryFilter?.value || "";

  const [sumRes, txRes] = await Promise.all([
    fetch(`/api/summary?month=${month}`),
    fetch(`/api/transactions?month=${month}&category=${encodeURIComponent(cat)}`)
  ]);

  const summary = await sumRes.json();
  const txs = await txRes.json();

  animateNumber(incomeValue, summary.income);
animateNumber(expenseValue, summary.expense);
animateNumber(balanceValue, summary.balance);


  listEl.innerHTML = "";

  if (txs.length === 0){
    listEl.innerHTML = `<div class="item"><span class="meta">Sem lançamentos neste mês. Bora começar? 😄</span></div>`;
    return;
  }

  for (const tx of txs){
    const amountClass = tx.type === "income" ? "income" : "expense";
    const sign = tx.type === "income" ? "+" : "-";

    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <span class="badge">${tx.date_iso}</span>
      <span class="badge">${tx.category}</span>
      <div>
        <div class="meta">${tx.description || "—"}</div>
      </div>
      <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center;">
        <span class="amount ${amountClass}">${sign} ${formatBRL(tx.amount_cents)}</span>
        <button class="del" data-id="${tx.id}">Apagar</button>
      </div>
    `;

    div.querySelector(".del").addEventListener("click", async () => {
      await fetch(`/api/transactions/${tx.id}`, { method:"DELETE" });
      load();
    });

    listEl.appendChild(div);
  }
}

form.addEventListener("submit", async (e)=>{
  e.preventDefault();
  hint.textContent = "";

  const payload = {
  type: typeEl.value,
  amount: amountEl.value.replace(",", "."),
  category: categorySelect.value,
  description: descriptionEl.value,
  date: dateEl.value
};


  const res = await fetch("/api/transactions", {
    method:"POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok){
    hint.textContent = data.error || "Erro ao salvar";
    return;
  }

  amountEl.value = "";
  descriptionEl.value = "";
  categoryEl.value = "";
  hint.textContent = "Salvo ✅";
  load();
});

monthInput.addEventListener("change", load);

// init
monthInput.value = currentMonth();
dateEl.value = todayISO();

loadCategories().then(load);


function animateNumber(el, toCents){
  const fromText = el.getAttribute("data-cents");
  const from = fromText ? Number(fromText) : 0;
  const to = Number(toCents);

  const start = performance.now();
  const dur = 420;

  function step(now){
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(from + (to - from) * eased);
    el.textContent = formatBRL(value);
    if (t < 1) requestAnimationFrame(step);
    else el.setAttribute("data-cents", String(to));
  }

  requestAnimationFrame(step);
}

async function loadCategories() {
  const type = typeEl.value; // income/expense
  const res = await fetch(`/api/categories?type=${type}`);
  const cats = await res.json();

  typeEl.addEventListener("change", async () => {
  await loadCategories();
});

categoryFilter.addEventListener("change", load);


  // select de lançamento
  categorySelect.innerHTML = "";
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = `${c.emoji} ${c.name}`;
    categorySelect.appendChild(opt);
  }

  // filtro (todas categorias, independente do tipo)
  const allRes = await fetch(`/api/categories`);
  const allCats = await allRes.json();

  // mantém seleção atual se existir
  const current = categoryFilter.value || "";
  categoryFilter.innerHTML = `<option value="">Todas</option>`;
  for (const c of allCats) {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = `${c.emoji} ${c.name}`;
    categoryFilter.appendChild(opt);
  }
  categoryFilter.value = current;
}

exportBtn.addEventListener("click", () => {
  const month = monthInput.value || currentMonth();
  const cat = (typeof categoryFilter !== "undefined" && categoryFilter) ? categoryFilter.value : "";
  const url = `/export.xlsx?month=${encodeURIComponent(month)}&category=${encodeURIComponent(cat)}`;
  window.location.href = url; // baixa o arquivo
});

// ===== PWA: registra o Service Worker =====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/sw.js");
      console.log("✅ Contabils PWA: Service Worker registrado");
    } catch (e) {
      console.warn("⚠️ Contabils PWA: falha ao registrar Service Worker", e);
    }
  });
}
