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

// Avatar UI
const avatarBtn = document.getElementById("avatarBtn");
const heroAvatarInner =
  document.getElementById("heroAvatarInner") || document.getElementById("userAvatarInner");
const avatarMood = document.getElementById("avatarMood");

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
async function waitForSupabaseClient({ tries = 70, delayMs = 80 } = {}) {
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
logoutBtn?.addEventListener("click", async () => {
  const sb = window.supabaseClient || window.supabase;

  const btn = logoutBtn;
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

// ====== Cards: cores do dashboard (entradas verde, saídas vermelha) ======
function applyDashboardCardColors() {
  function parentCard(el) {
    if (!el) return null;
    return el.closest(".card") || el.closest(".panel") || null;
  }

  const incomeCard = parentCard(incomeValue);
  const expenseCard = parentCard(expenseValue);
  const balanceCard = parentCard(balanceValue);

  if (incomeValue) incomeValue.style.color = "var(--good)";
  if (expenseValue) expenseValue.style.color = "var(--bad)";
  if (balanceValue) balanceValue.style.color = "var(--ink)";

  if (incomeCard && incomeCard.classList?.contains("card")) {
    incomeCard.style.boxShadow = "0 18px 45px rgba(0,0,0,.12), 0 0 0 1px rgba(16,185,129,.16)";
  }
  if (expenseCard && expenseCard.classList?.contains("card")) {
    expenseCard.style.boxShadow = "0 18px 45px rgba(0,0,0,.12), 0 0 0 1px rgba(239,68,68,.16)";
  }
  if (balanceCard && balanceCard.classList?.contains("card")) {
    // mantém padrão
  }
}

// ====== Avatar: status neon + texto mood (DINÂMICO PELO SALDO) ======
function setAvatarStatusByBalance(balanceCents) {
  if (!avatarBtn) return;

  const bal = Number(balanceCents);

  avatarBtn.classList.remove("status-good", "status-warn", "status-bad", "status-neutral");

  if (!Number.isFinite(bal)) {
    avatarBtn.classList.add("status-neutral");
    if (avatarMood) avatarMood.textContent = "Carregando seu saldo… 💸";
    return;
  }

  if (bal > 0) {
    avatarBtn.classList.add("status-good");
    if (avatarMood) avatarMood.textContent = "Você tá economizando esse mês 😎";
  } else if (bal === 0) {
    avatarBtn.classList.add("status-warn");
    if (avatarMood) avatarMood.textContent = "Mês zerado: nem sobe nem desce 😅";
  } else {
    avatarBtn.classList.add("status-bad");
    if (avatarMood) avatarMood.textContent = "O mês tá no vermelho… vamo virar o jogo 💪";
  }
}

// ====== Avatar: carregar foto do profiles.avatar_url ======
async function loadAvatarFromProfile() {
  try {
    const sb = await waitForSupabaseClient();
    if (!sb?.auth) return;

    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr) {
      console.warn("getUser erro:", userErr);
      return;
    }

    const user = userData?.user;
    if (!user) return;

    const { data: profile, error: profErr } = await sb
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) {
      console.warn("profiles select erro:", profErr);
      return;
    }

    const url = profile?.avatar_url;
    if (!url) return;

    if (!heroAvatarInner) return;

    const fallback = document.getElementById("avatarFallback");
    if (fallback) fallback.remove();

    const existing = heroAvatarInner.querySelector("img[data-avatar='1']");
    if (existing) {
      existing.src = `${url}?t=${Date.now()}`;
      return;
    }

    const img = document.createElement("img");
    img.dataset.avatar = "1";
    img.src = `${url}?t=${Date.now()}`;
    img.alt = "Foto do perfil";

    heroAvatarInner.textContent = "";
    heroAvatarInner.appendChild(img);
  } catch (e) {
    console.warn("loadAvatarFromProfile falhou:", e);
  }
}

// ====== App ======
function animateNumber(el, toCents) {
  if (!el) return;

  const fromText = el.getAttribute("data-cents");
  const from = fromText ? Number(fromText) : 0;
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
  const month = monthInput?.value || currentMonth();
  const cat = categoryFilter?.value || "";

  const [sumRes, txRes] = await Promise.all([
    fetchAuth(`/api/summary?month=${encodeURIComponent(month)}`),
    fetchAuth(`/api/transactions?month=${encodeURIComponent(month)}&category=${encodeURIComponent(cat)}`),
  ]);

  if (!sumRes.ok) {
    const err = await sumRes.json().catch(() => ({}));
    if (hint) hint.textContent = err?.error || "Erro ao carregar resumo";
    return;
  }

  if (!txRes.ok) {
    const err = await txRes.json().catch(() => ({}));
    if (hint) hint.textContent = err?.error || "Erro ao carregar transações";
    return;
  }

  const summary = await sumRes.json().catch(() => ({}));
  const txsRaw = await txRes.json().catch(() => []);
  const txs = Array.isArray(txsRaw) ? txsRaw : [];

  animateNumber(incomeValue, summary.income);
  animateNumber(expenseValue, summary.expense);
  animateNumber(balanceValue, summary.balance);

  setAvatarStatusByBalance(summary?.balance);

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

    div.querySelector(".del")?.addEventListener("click", async () => {
      const delRes = await fetchAuth(`/api/transactions/${tx.id}`, { method: "DELETE" });
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
    const type = typeEl?.value || "income";
    const res = await fetch(`/api/categories?type=${encodeURIComponent(type)}`);
    const catsRaw = await res.json().catch(() => []);
    const cats = Array.isArray(catsRaw) ? catsRaw : [];

    if (categorySelect) categorySelect.innerHTML = "";
    for (const c of cats) {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `${c.emoji} ${c.name}`;
      categorySelect?.appendChild(opt);
    }

    const allRes = await fetch(`/api/categories`);
    const allCatsRaw = await allRes.json().catch(() => []);
    const allCats = Array.isArray(allCatsRaw) ? allCatsRaw : [];

    const current = categoryFilter?.value || "";
    if (categoryFilter) {
      categoryFilter.innerHTML = `<option value="">Todas</option>`;
      for (const c of allCats) {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = `${c.emoji} ${c.name}`;
        categoryFilter.appendChild(opt);
      }
      categoryFilter.value = current;
    }
  } catch (e) {
    console.error("Erro ao carregar categorias:", e);
    if (hint) hint.textContent = "Erro ao carregar categorias";
  }
}

// ====== Eventos ======
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (hint) hint.textContent = "";

  const payload = {
    type: typeEl?.value,
    amount: (amountEl?.value || "").replace(",", "."),
    category: categorySelect?.value,
    description: descriptionEl?.value,
    date: dateEl?.value,
  };

  const res = await fetchAuth("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (hint) hint.textContent = data.error || "Erro ao salvar";
    return;
  }

  if (amountEl) amountEl.value = "";
  if (descriptionEl) descriptionEl.value = "";
  if (categoryEl) categoryEl.value = "";
  if (hint) hint.textContent = "Salvo ✅";

  load();
});

monthInput?.addEventListener("change", load);
typeEl?.addEventListener("change", async () => await loadCategories());
categoryFilter?.addEventListener("change", load);

// ===== Export (com auth via blob) =====
exportBtn?.addEventListener("click", async () => {
  try {
    const month = monthInput?.value || currentMonth();
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
  if (monthInput) monthInput.value = currentMonth();
  if (dateEl) dateEl.value = todayISO();

  const ok = await requireAuthOrRedirect();
  if (!ok) return;

  applyDashboardCardColors();

  await loadAvatarFromProfile();
  setupAvatarUpload();

  await loadCategories();
  await load();
})();

// ====== Avatar: upload ao clicar (Storage + profiles.avatar_url) ======
function setupAvatarUpload() {
  if (!avatarBtn || !heroAvatarInner) return;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  avatarBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;

    const maxMb = 5;
    if (file.size > maxMb * 1024 * 1024) {
      alert(`Imagem muito grande. Máximo: ${maxMb}MB`);
      return;
    }

    try {
      const sb = await waitForSupabaseClient();
      if (!sb?.auth) {
        alert("Supabase não carregou. Recarrega e tenta de novo.");
        return;
      }

      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr) throw userErr;
      const user = userData?.user;
      if (!user) return;

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
      const path = `${user.id}/avatar.${safeExt}`;

      if (avatarMood) avatarMood.textContent = "Enviando sua foto… ⏳";

      const { error: upErr } = await sb.storage.from("avatars").upload(path, file, {
        upsert: true,
        cacheControl: "3600",
        contentType: file.type || "image/jpeg",
      });

      if (upErr) throw upErr;

      const { data: pub } = sb.storage.from("avatars").getPublicUrl(path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error("Não consegui gerar publicUrl do avatar.");

      // ✅ resolve NOT NULL (name/phone/email) criando profile se não existir; senão só atualiza avatar
const displayName =
  user.user_metadata?.name ||
  user.user_metadata?.full_name ||
  (user.email ? user.email.split("@")[0] : "Usuário");

const phoneValue =
  user.user_metadata?.phone ||
  user.user_metadata?.telefone ||
  user.phone ||
  "00000000000";

const emailValue =
  user.email ||
  user.user_metadata?.email ||
  "sem-email@contabils.local";

// 1) tenta ver se já existe profile
const { data: existingProfile, error: getProfErr } = await sb
  .from("profiles")
  .select("id")
  .eq("id", user.id)
  .maybeSingle();

if (getProfErr) throw getProfErr;

// 2) se já existe -> update só do avatar
if (existingProfile?.id) {
  const { error: updErr } = await sb
    .from("profiles")
    .update({
      avatar_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updErr) throw updErr;
} else {
  // 3) se NÃO existe -> insert com os NOT NULL
  const { error: insErr } = await sb.from("profiles").insert({
    id: user.id,
    name: displayName,
    phone: phoneValue,
    email: emailValue,
    avatar_url: publicUrl,
    updated_at: new Date().toISOString(),
  });

  if (insErr) throw insErr;
}


      const fallback = document.getElementById("avatarFallback");
      if (fallback) fallback.remove();

      const existing = heroAvatarInner.querySelector("img[data-avatar='1']");
      if (existing) existing.src = `${publicUrl}?t=${Date.now()}`;
      else {
        heroAvatarInner.textContent = "";
        const img = document.createElement("img");
        img.dataset.avatar = "1";
        img.src = `${publicUrl}?t=${Date.now()}`;
        img.alt = "Foto do perfil";
        heroAvatarInner.appendChild(img);
      }

      if (avatarMood) avatarMood.textContent = "Foto atualizada ✅";
    } catch (e) {
      console.error("Avatar upload falhou:", e);

      const msg = String(e?.message || e);
      if (msg.includes("403") || msg.toLowerCase().includes("not authorized")) {
        alert("Sem permissão pra enviar/salvar (Storage/Profiles policy). Me manda o erro completo do console que eu te passo a policy certinha.");
      } else {
        alert("Não consegui enviar a foto agora. Tenta de novo.");
      }

      if (avatarMood) avatarMood.textContent = "Seu mês está começando…";
    }
  });
}
