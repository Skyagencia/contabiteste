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

async function load() {
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

  if (txs.length === 0) {
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
      await fetch(`/api/transactions/${tx.id}`, { method: "DELETE" });
      load();
    });

    listEl.appendChild(div);
  }
}

form.addEventListener("submit", async (e) => {
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
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
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

// init
monthInput.value = currentMonth();
dateEl.value = todayISO();

loadCategories().then(load);

// ====== anima número ======
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

// ====== categorias ======
async function loadCategories() {
  const type = typeEl.value; // income/expense
  const res = await fetch(`/api/categories?type=${type}`);
  const cats = await res.json();

  // (evita acumular listeners)
  if (!typeEl.dataset.bound) {
    typeEl.addEventListener("change", async () => {
      await loadCategories();
    });
    typeEl.dataset.bound = "1";
  }

  if (!categoryFilter.dataset.bound) {
    categoryFilter.addEventListener("change", load);
    categoryFilter.dataset.bound = "1";
  }

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

// ====== exportar ======
exportBtn.addEventListener("click", () => {
  const month = monthInput.value || currentMonth();
  const cat = categoryFilter ? categoryFilter.value : "";
  const url = `/export.xlsx?month=${encodeURIComponent(month)}&category=${encodeURIComponent(cat)}`;
  window.location.href = url;
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

  // ✅ listener global: quando trocar controller, recarrega
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
}

// ===== PWA Update Banner (premium) =====
(function setupPwaUpdateBanner() {
  if (!("serviceWorker" in navigator)) return;

  // garante keyframes do spinner sem depender do styles.css
  if (!document.getElementById("pwaSpinKeyframes")) {
    const st = document.createElement("style");
    st.id = "pwaSpinKeyframes";
    st.textContent = `
      @keyframes pwaSpin { to { transform: rotate(360deg); } }
      @keyframes pwaPop { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform: translateY(0); } }
      @keyframes pwaFadeOut { to { opacity:0; transform: translateY(-6px); } }
    `;
    document.head.appendChild(st);
  }

  function showUpdateBanner(reg) {
    if (document.getElementById("pwaUpdateBanner")) return;

    const banner = document.createElement("div");
    banner.id = "pwaUpdateBanner";
    banner.style.position = "fixed";
    banner.style.top = "12px";
    banner.style.right = "12px";
    banner.style.zIndex = "9999";
    banner.style.background = "rgba(11,18,32,.92)";
    banner.style.color = "#fff";
    banner.style.padding = "12px 14px";
    banner.style.borderRadius = "14px";
    banner.style.boxShadow = "0 10px 30px rgba(0,0,0,.25)";
    banner.style.display = "flex";
    banner.style.alignItems = "center";
    banner.style.gap = "10px";
    banner.style.maxWidth = "340px";
    banner.style.animation = "pwaPop .18s ease-out both";
    banner.innerHTML = `
      <div id="pwaUpdateText" style="font-size:13px; line-height:1.2;">
        <strong>Atualização disponível</strong><br/>
        Clique para atualizar o Contabils.
      </div>
      <button id="pwaUpdateBtn" style="
        border:0; cursor:pointer; padding:10px 12px; border-radius:12px;
        font-weight:800; background:#10b981; color:#052015;
      ">Atualizar</button>
      <button id="pwaCloseBtn" title="Fechar" style="
        border:0; cursor:pointer; padding:8px 10px; border-radius:12px;
        background:rgba(255,255,255,.12); color:#fff;
      ">✕</button>
    `;

    document.body.appendChild(banner);

    document.getElementById("pwaCloseBtn").onclick = () => {
      banner.style.animation = "pwaFadeOut .18s ease-out both";
      setTimeout(() => banner.remove(), 180);
    };

    document.getElementById("pwaUpdateBtn").onclick = () => {
      // se não tiver waiting, não tem o que ativar
      if (!reg.waiting) return;

      // UI premium: some botão, mostra spinner
      const btn = document.getElementById("pwaUpdateBtn");
      const text = document.getElementById("pwaUpdateText");
      const close = document.getElementById("pwaCloseBtn");

      close.disabled = true;
      close.style.opacity = "0.4";
      btn.disabled = true;

      text.innerHTML = `<strong>Atualizando…</strong><br/>Aplicando melhorias rapidinho ✨`;

      const loader = document.createElement("div");
      loader.style.width = "18px";
      loader.style.height = "18px";
      loader.style.border = "3px solid rgba(255,255,255,.35)";
      loader.style.borderTopColor = "#fff";
      loader.style.borderRadius = "50%";
      loader.style.animation = "pwaSpin .8s linear infinite";
      loader.style.marginLeft = "2px";

      btn.replaceWith(loader);

      // pede pro SW aplicar update (controllerchange vai recarregar)
      reg.waiting.postMessage({ type: "SKIP_WAITING" });

      // fallback: se por algum motivo demorar, dá um reload leve depois de 2.5s
      setTimeout(() => {
        // se ainda existir banner, tenta recarregar (não força se já recarregou)
        if (document.getElementById("pwaUpdateBanner")) {
          window.location.reload();
        }
      }, 2500);
    };
  }

  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;

    if (reg.waiting) showUpdateBanner(reg);

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateBanner(reg);
        }
      });
    });
  });
})();
