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

function setHint(msg) {
  if (hint) hint.textContent = msg || "";
}

function redirectToLogin() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login.html?next=${next}`);
}

// ===== Supabase Client (SEM CONFUSÃO) =====
// A gente SEMPRE usa o client criado no index.html: window.supabaseClient
async function waitForSupabaseClient({ tries = 50, delayMs = 80 } = {}) {
  for (let i = 0; i < tries; i++) {
    const sb = window.supabaseClient;
    if (sb && sb.auth) return sb;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

// Pega headers auth (Bearer token)
async function authHeaders() {
  const sb = await waitForSupabaseClient();
  if (!sb) return {};

  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Wrapper fetch com auth + TRATA 401
async function fetchAuth(url, opts = {}) {
  const headers = await authHeaders();
  const mergedHeaders = { ...(opts.headers || {}), ...headers };
  const res = await fetch(url, { ...opts, headers: mergedHeaders });

  // ✅ se deu 401, sessão morreu → manda pro login sem quebrar o app
  if (res.status === 401) {
    try {
      const sb = await waitForSupabaseClient();
      if (sb?.auth) await sb.auth.signOut();
    } catch (e) {
      console.warn("signOut falhou no 401:", e);
    } finally {
      localStorage.clear();
      sessionStorage.clear();
      redirectToLogin();
    }
  }

  return res;
}

// ====== Auth Gate (impede abrir o app sem sessão) ======
async function requireAuthOrRedirect() {
  const sb = await waitForSupabaseClient();

  if (!sb || !sb.auth) {
    console.warn("Supabase client não encontrado ainda.");
    // não quebra a página, mas também não deixa seguir
    setHint("Carregando...");
    return false;
  }

  const { data } = await sb.auth.getSession();
  const session = data?.session;

  if (!session) {
    redirectToLogin();
    return false;
  }

  return true;
}

// ===== PWA: estado de instalação (some com prompts quando já está instalado) =====
function isAppInstalled() {
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
}

/**
 * ✅ Se houver algum UI de "instalar" na página (ex: #installPrompt),
 * isso garante que:
 * - Se já estiver instalado: esconde
 * - Se instalar agora: esconde na hora (evento appinstalled)
 *
 * Obs: Mesmo que o app não tenha esse elemento, não dá erro.
 */
function setupInstallStateWatcher() {
  const DISMISS_KEY = "contabils_install_dismissed_at";

  function markInstalledAndHide() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    const el = document.getElementById("installPrompt");
    if (el) el.hidden = true;
  }

  // Se já está instalado, some com qualquer prompt
  if (isAppInstalled()) markInstalledAndHide();

  // Se instalar durante o uso, some na hora
  window.addEventListener("appinstalled", () => {
    markInstalledAndHide();
  });
}

// ===== Logout =====
logoutBtn?.addEventListener("click", async () => {
  const sb = await waitForSupabaseClient();

  const oldText = logoutBtn?.textContent || "Sair";

  if (!sb?.auth) {
    alert("Supabase não carregou ainda. Recarrega a página e tenta de novo.");
    return;
  }

  if (logoutBtn) {
    logoutBtn.disabled = true;
    logoutBtn.textContent = "Saindo...";
  }

  try {
    const { error } = await sb.auth.signOut();
    if (error) throw error;

    localStorage.clear();
    sessionStorage.clear();
    window.location.href = "/login.html";
  } catch (e) {
    console.error(e);
    if (logoutBtn) {
      logoutBtn.disabled = false;
      logoutBtn.textContent = oldText;
    }
    alert("Não consegui sair agora. Tenta de novo rapidinho.");
  }
});

// ====== App ======
function animateNumber(el, toCents) {
  if (!el) return;

  const fromText = el.getAttribute("data-cents");
  const from = fromText ? Number(fromText) : 0;

  // ✅ garante número válido (evita NaN)
  const to = Number.isFinite(Number(toCents)) ? Number(toCents) : 0;

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
  setHint("");

  const month = monthInput?.value || currentMonth();
  const cat = categoryFilter?.value || "";

  const [sumRes, txRes] = await Promise.all([
    fetchAuth(`/api/summary?month=${encodeURIComponent(month)}`),
    fetchAuth(`/api/transactions?month=${encodeURIComponent(month)}&category=${encodeURIComponent(cat)}`),
  ]);

  // Se rolou 401, fetchAuth já redirecionou. Só para por aqui.
  if (!sumRes || !txRes) return;

  if (!sumRes.ok) {
    const err = await sumRes.json().catch(() => ({}));
    setHint(err?.error || "Erro ao carregar resumo");
    return;
  }

  if (!txRes.ok) {
    const err = await txRes.json().catch(() => ({}));
    setHint(err?.error || "Erro ao carregar transações");
    return;
  }

  const summary = await sumRes.json().catch(() => ({}));
  const txsRaw = await txRes.json().catch(() => []);

  // ✅ txs SEMPRE array (mata o “txs is not iterable”)
  const txs = Array.isArray(txsRaw) ? txsRaw : [];

  animateNumber(incomeValue, summary.income);
  animateNumber(expenseValue, summary.expense);
  animateNumber(balanceValue, summary.balance);

  if (listEl) listEl.innerHTML = "";

  if (!txs || txs.length === 0) {
    if (listEl) {
      listEl.innerHTML = `<div class="item"><span class="meta">Sem lançamentos neste mês. Bora começar? 😄</span></div>`;
    }
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

      // 401 já redirecionou
      if (!delRes) return;

      if (!delRes.ok) {
        const err = await delRes.json().catch(() => ({}));
        alert(err?.error || "Não consegui apagar agora.");
        return;
      }
      load();
    });

    listEl?.appendChild(div);
  }
}

async function loadCategories() {
  try {
    // categorias são globais (não precisam auth)
    const type = typeEl?.value || "income"; // income/expense

    const res = await fetch(`/api/categories?type=${encodeURIComponent(type)}`);
    const catsRaw = await res.json().catch(() => []);
    const cats = Array.isArray(catsRaw) ? catsRaw : [];

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
    const allCatsRaw = await allRes.json().catch(() => []);
    const allCats = Array.isArray(allCatsRaw) ? allCatsRaw : [];

    const current = categoryFilter?.value || "";
    categoryFilter.innerHTML = `<option value="">Todas</option>`;
    for (const c of allCats) {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `${c.emoji} ${c.name}`;
      categoryFilter.appendChild(opt);
    }
    categoryFilter.value = current;
  } catch (e) {
    console.error("Erro ao carregar categorias:", e);
    setHint("Erro ao carregar categorias");
  }
}

// ====== Eventos ======
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setHint("");

  const payload = {
    type: typeEl.value,
    amount: (amountEl.value || "").replace(",", "."),
    category: categorySelect.value,
    description: descriptionEl.value,
    date: dateEl.value,
  };

  const res = await fetchAuth("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // 401 já redirecionou
  if (!res) return;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    setHint(data.error || "Erro ao salvar");
    return;
  }

  amountEl.value = "";
  descriptionEl.value = "";
  categoryEl.value = "";
  setHint("Salvo ✅");
  load();
});

monthInput?.addEventListener("change", load);

typeEl?.addEventListener("change", async () => {
  await loadCategories();
});

categoryFilter?.addEventListener("change", load);

// ===== Export (com auth via blob) =====
exportBtn?.addEventListener("click", async () => {
  try {
    const month = monthInput?.value || currentMonth();
    const cat = categoryFilter?.value || "";
    const url = `/export.xlsx?month=${encodeURIComponent(month)}&category=${encodeURIComponent(cat)}`;

    const res = await fetchAuth(url);

    // 401 já redirecionou
    if (!res) return;

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
// ===== PWA: registra o Service Worker + banner de atualização =====
function ensureUpdateBanner() {
  if (document.getElementById("pwaUpdateBanner")) return;

  const banner = document.createElement("div");
  banner.id = "pwaUpdateBanner";
  banner.style.cssText = `
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 16px;
    z-index: 9999;
    background: rgba(11,18,32,.98);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 14px;
    padding: 14px;
    display: none;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    box-shadow: 0 18px 50px rgba(0,0,0,.35);
    color: #fff;
  `;

  banner.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:2px;">
      <strong style="font-size:14px;">Atualização disponível 🚀</strong>
      <span style="font-size:12px; opacity:.85;">Tem versão nova do Contabils. Quer atualizar agora?</span>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <button id="pwaLaterBtn" type="button"
        style="background:transparent; border:1px solid rgba(255,255,255,.18); color:#fff; padding:9px 12px; border-radius:10px; cursor:pointer;">
        Depois
      </button>
      <button id="pwaUpdateBtn" type="button"
        style="background:#fff; border:none; color:#0b1220; padding:9px 12px; border-radius:10px; cursor:pointer; font-weight:700;">
        Atualizar
      </button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById("pwaLaterBtn").addEventListener("click", () => {
    banner.style.display = "none";
  });

  return banner;
}

async function setupPwaUpdateFlow(reg) {
  const banner = ensureUpdateBanner();

  // Quando o SW controlador mudar (novo SW ativou), recarrega
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  function showBannerIfWaiting() {
    if (!reg.waiting) return;

    banner.style.display = "flex";

    const btn = document.getElementById("pwaUpdateBtn");
    btn.onclick = () => {
      // manda o SW em waiting ativar
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    };
  }

  // Se já existe waiting (update já baixou), mostra
  showBannerIfWaiting();

  // Detecta updates futuros
  reg.addEventListener("updatefound", () => {
    const newSW = reg.installing;
    if (!newSW) return;

    newSW.addEventListener("statechange", () => {
      // Instalou e já existe controller => update pronto (waiting)
      if (newSW.state === "installed" && navigator.serviceWorker.controller) {
        showBannerIfWaiting();
      }
    });
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      console.log("✅ Contabils PWA: Service Worker registrado");

      // Opcional: força checar update ao abrir o app
      reg.update?.().catch(() => {});

      await setupPwaUpdateFlow(reg);
    } catch (e) {
      console.warn("⚠️ Contabils PWA: falha ao registrar Service Worker", e);
    }
  });
}

// ===== INIT =====
(async function init() {
  // ✅ garante que qualquer UI de “Instalar” suma quando já estiver instalado
  setupInstallStateWatcher();

  // init inputs
  if (monthInput) monthInput.value = currentMonth();
  if (dateEl) dateEl.value = todayISO();

  // trava o app se não tiver logado
  const ok = await requireAuthOrRedirect();
  if (!ok) return;

  await loadCategories();
  await load();
})();
