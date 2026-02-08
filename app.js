// ====== Elementos ======
const logoutBtn = document.getElementById("logoutBtn");
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

// ====== Helpers ======
function formatBRL(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// Espera o Supabase aparecer no window (evita "undefined" em cache/ordem de script)
async function waitForSupabaseClient({ tries = 50, delayMs = 80 } = {}) {
  for (let i = 0; i < tries; i++) {
    const sb = window.supabaseClient || window.supabase;
    if (sb && sb.auth) return sb;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

// Pega headers auth (Bearer token)
async function authHeaders() {
  const sb = await waitForSupabaseClient();
  if (!sb) return {}; // vai falhar em requireAuthOrRedirect mesmo

  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Wrapper fetch com auth
async function fetchAuth(url, opts = {}) {
  const headers = await authHeaders();
  const mergedHeaders = { ...(opts.headers || {}), ...headers };
  const res = await fetch(url, { ...opts, headers: mergedHeaders });
  return res;
}

// ====== Auth Gate (impede abrir o app sem sessão) ======
async function requireAuthOrRedirect() {
  const sb = await waitForSupabaseClient();

  if (!sb || !sb.auth) {
    console.warn("Supabase client não encontrado ainda.");
    return false; // não quebra a página
  }

  const { data } = await sb.auth.getSession();
  const session = data?.session;

  if (!session) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login.html?next=${next}`);
    return false;
  }

  return true;
}

// ===== Logout =====
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  const sb = window.supabaseClient || window.supabase;

  const btn = document.getElementById("logoutBtn");
  const oldText = btn?.textContent || "Sair";

  if (!sb?.auth) {
    alert("Supabase não carregou ainda. Recarrega a página e tenta de novo.");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saindo...";
  }

  try {
    const { error } = await sb.auth.signOut();
    if (error) throw error;

    window.location.href = "/login.html";
  } catch (e) {
    console.error(e);
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldText;
    }
    alert("Não consegui sair agora. Tenta de novo rapidinho.");
  }
});

// ====== App ======
function animateNumber(el, toCents) {
  const fromText = el.getAttribute("data-cents");
  const from = fromText ? Number(fromText) : 0;
  const to = Number(toCents);

  const start = performance.now();
  const dur = 420;

  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(from + (to - from) * eased);
    el.textContent = formatBRL(value);
    if (t < 1) requestAnimationFrame(step);
    else el.setAttribute("data-cents", String(to));
  }

  requestAnimationFrame(step);
}

async function load() {
  const month = monthInput.value || currentMonth();
  const cat = categoryFilter?.value || "";

  const [sumRes, txRes] = await Promise.all([
    fetchAuth(`/api/summary?month=${encodeURIComponent(month)}`),
    fetchAuth(`/api/transactions?month=${encodeURIComponent(month)}&category=${encodeURIComponent(cat)}`),
  ]);

  if (!sumRes.ok) {
    const err = await sumRes.json().catch(() => ({}));
    hint.textContent = err?.error || "Erro ao carregar resumo";
    return;
  }

  if (!txRes.ok) {
    const err = await txRes.json().catch(() => ({}));
    hint.textContent = err?.error || "Erro ao carregar transações";
    return;
  }

  const summary = await sumRes.json();
  const txs = await txRes.json();

  animateNumber(incomeValue, summary.income);
  animateNumber(expenseValue, summary.expense);
  animateNumber(balanceValue, summary.balance);

  listEl.innerHTML = "";

  if (!txs || txs.length === 0) {
    listEl.innerHTML = `<div class="item"><span class="meta">Sem lançamentos neste mês. Bora começar? 😄</span></div>`;
    return;
  }

  for (const tx of txs) {
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
      const delRes = await fetchAuth(`/api/transactions/${tx.id}`, { method: "DELETE" });
      if (!delRes.ok) {
        const err = await delRes.json().catch(() => ({}));
        alert(err?.error || "Não consegui apagar agora.");
        return;
      }
      load();
    });

    listEl.appendChild(div);
  }
}

async function loadCategories() {
  // categorias são globais (não precisam auth)
  const type = typeEl.value; // income/expense
  const res = await fetch(`/api/categories?type=${encodeURIComponent(type)}`);
  const cats = await res.json();

  // select de lançamento
  categorySelect.innerHTML = "";
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = `${c.emoji} ${c.name}`;
    categorySelect.appendChild(opt);
  }

  // filtro (todas categorias)
  const allRes = await fetch(`/api/categories`);
  const allCats = await allRes.json();

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

// ====== Eventos ======
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hint.textContent = "";

  const payload = {
    type: typeEl.value,
    amount: amountEl.value.replace(",", "."),
    category: categorySelect.value,
    description: descriptionEl.value,
    date: dateEl.value,
  };

  const res = await fetchAuth("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
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

typeEl.addEventListener("change", async () => {
  await loadCategories();
});

categoryFilter?.addEventListener("change", load);

// ===== Export (com auth via blob) =====
exportBtn.addEventListener("click", async () => {
  try {
    const month = monthInput.value || currentMonth();
    const cat = categoryFilter?.value || "";
    const url = `/export.xlsx?month=${encodeURIComponent(month)}&category=${encodeURIComponent(cat)}`;

    const res = await fetchAuth(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err?.error || "Não consegui exportar agora.");
      return;
    }

    const blob = await res.blob();
    const a = document.createElement("a");
    const safeCat = cat ? `_${String(cat).replace(/[^\w\-]+/g, "_")}` : "";
    a.download = `contabils_extrato_${month}${safeCat}.xlsx`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  } catch (e) {
    console.error(e);
    alert("Erro ao exportar. Tenta de novo.");
  }
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

// ===== INIT =====
(async function init() {
  // init inputs
  monthInput.value = currentMonth();
  dateEl.value = todayISO();

  // trava o app se não tiver logado
  const ok = await requireAuthOrRedirect();
  if (!ok) return;

  await loadCategories();
  await load();
})();
