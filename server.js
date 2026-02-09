const express = require("express");
const path = require("path");
const ExcelJS = require("exceljs");
const { Pool } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// middlewares
app.use(express.json());
app.use(express.static(__dirname)); // index.html, styles.css, app.js

// ===== Supabase (Auth) =====
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn("⚠️ SUPABASE_URL / SUPABASE_ANON_KEY não definidos no ambiente (Render).");
}

// Supabase server client (usado só pra validar token e pegar o user)
const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_ANON_KEY || ""
);

// ===== Supabase Postgres =====
if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL não definido. Configure no Render (Environment) e/ou no seu terminal.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

function monthKeyFromDate(dateIso) {
  return dateIso.slice(0, 7); // YYYY-MM
}

// ===== Auth middleware =====
// Espera: Authorization: Bearer <access_token>
async function requireUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Não autenticado (faltou token)." });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Sessão inválida. Faça login novamente." });
    }

    req.user = data.user; // { id, email, ... }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Não autenticado.", details: String(e?.message || e) });
  }
}

// ===== Schema + Seed (idempotente) =====
async function ensureSchemaAndSeed() {
  // categories (globais)
  await pool.query(`
    create table if not exists public.categories (
      id bigserial primary key,
      name text not null unique,
      emoji text not null,
      kind text not null check (kind in ('both','income','expense')),
      is_active boolean not null default true
    );
  `);

  // transactions (por usuário)
  await pool.query(`
    create table if not exists public.transactions (
      id bigserial primary key,
      user_id uuid,
      type text not null check (type in ('income','expense')),
      amount_cents integer not null,
      category text not null,
      description text,
      date_iso date not null,
      month_key text not null
    );
  `);

  // garante coluna user_id se a tabela já existia sem ela
  await pool.query(`
    alter table public.transactions
    add column if not exists user_id uuid;
  `);

  // se você quiser FK (opcional). Se der erro por permissão, pode comentar.
  // await pool.query(`
  //   alter table public.transactions
  //   add constraint if not exists transactions_user_fk
  //   foreign key (user_id) references auth.users(id);
  // `);

  await pool.query(`create index if not exists idx_transactions_month on public.transactions(month_key);`);
  await pool.query(`create index if not exists idx_transactions_category on public.transactions(category);`);
  await pool.query(`create index if not exists idx_transactions_user on public.transactions(user_id);`);
  await pool.query(`create index if not exists idx_transactions_user_month on public.transactions(user_id, month_key);`);

  const seedCategories = [
    // gastos
    { name: "Mercado", emoji: "🛒", kind: "expense" },
    { name: "Alimentação", emoji: "🍽️", kind: "expense" },
    { name: "Gasolina", emoji: "⛽", kind: "expense" },
    { name: "Transporte", emoji: "🚌", kind: "expense" },
    { name: "Carro", emoji: "🚗", kind: "expense" },
    { name: "Pet", emoji: "🐶", kind: "expense" },
    { name: "Saúde", emoji: "🩺", kind: "expense" },
    { name: "Farmácia", emoji: "💊", kind: "expense" },
    { name: "Casa", emoji: "🏠", kind: "expense" },
    { name: "Contas", emoji: "📄", kind: "expense" },
    { name: "Internet/Telefone", emoji: "📶", kind: "expense" },
    { name: "Streaming", emoji: "🎬", kind: "expense" },
    { name: "Lazer", emoji: "🎉", kind: "expense" },
    { name: "Educação", emoji: "📚", kind: "expense" },
    { name: "Vestuário", emoji: "👕", kind: "expense" },
    { name: "Assinaturas", emoji: "🔁", kind: "expense" },
    { name: "Imprevistos", emoji: "🚨", kind: "expense" },

    // entradas
    { name: "Salário", emoji: "💼", kind: "income" },
    { name: "Freela", emoji: "🧑‍💻", kind: "income" },
    { name: "Vendas", emoji: "💰", kind: "income" },
    { name: "Cashback", emoji: "🪙", kind: "income" },
  ];

  for (const c of seedCategories) {
    await pool.query(
      `insert into public.categories (name, emoji, kind)
       values ($1, $2, $3)
       on conflict (name) do nothing`,
      [c.name, c.emoji, c.kind]
    );
  }
}

ensureSchemaAndSeed()
  .then(() => console.log("✅ Schema/seed OK (Supabase)"))
  .catch((e) => console.error("❌ Erro no schema/seed:", e));

// ===== Rotas =====

// healthcheck
app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("select 1 as ok");
    res.json({ ok: true, db: r.rows[0].ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// home
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ===== TRANSAÇÕES (tudo com auth) =====

// listar transações do mês (opcional category)
app.get("/api/transactions", requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const category = req.query.category || "";

    const q = category
      ? await pool.query(
          `
          select id, type, amount_cents, category, description,
                 to_char(date_iso, 'YYYY-MM-DD') as date_iso,
                 month_key
          from public.transactions
          where user_id = $1 and month_key = $2 and category = $3
          order by date_iso desc, id desc
          `,
          [userId, month, category]
        )
      : await pool.query(
          `
          select id, type, amount_cents, category, description,
                 to_char(date_iso, 'YYYY-MM-DD') as date_iso,
                 month_key
          from public.transactions
          where user_id = $1 and month_key = $2
          order by date_iso desc, id desc
          `,
          [userId, month]
        );

    res.json(q.rows);
  } catch (e) {
    res.status(500).json({ error: "Erro ao listar transações", details: String(e?.message || e) });
  }
});

// resumo do mês
app.get("/api/summary", requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const incomeQ = await pool.query(
      `select coalesce(sum(amount_cents),0) as total
       from public.transactions
       where user_id = $1 and month_key = $2 and type='income'`,
      [userId, month]
    );

    const expenseQ = await pool.query(
      `select coalesce(sum(amount_cents),0) as total
       from public.transactions
       where user_id = $1 and month_key = $2 and type='expense'`,
      [userId, month]
    );

    const income = Number(incomeQ.rows[0].total || 0);
    const expense = Number(expenseQ.rows[0].total || 0);

    res.json({ month, income, expense, balance: income - expense });
  } catch (e) {
    res.status(500).json({ error: "Erro ao calcular resumo", details: String(e?.message || e) });
  }
});

// criar transação
app.post("/api/transactions", requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, amount, category, description, date } = req.body;

    if (!["income", "expense"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    if (!amount || isNaN(amount) || Number(amount) <= 0) return res.status(400).json({ error: "Valor inválido" });
    if (!category || typeof category !== "string") return res.status(400).json({ error: "Categoria inválida" });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Data inválida (YYYY-MM-DD)" });

    const amountCents = Math.round(Number(String(amount).replace(",", ".")) * 100);
    const monthKey = monthKeyFromDate(date);

    const ins = await pool.query(
      `
      insert into public.transactions (user_id, type, amount_cents, category, description, date_iso, month_key)
      values ($1, $2, $3, $4, $5, $6::date, $7)
      returning id
      `,
      [userId, type, amountCents, category.trim(), (description || "").trim(), date, monthKey]
    );

    res.json({ ok: true, id: ins.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: "Erro ao criar transação", details: String(e?.message || e) });
  }
});

// deletar transação (só do próprio user)
app.delete("/api/transactions/:id", requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const del = await pool.query(
      `delete from public.transactions where id = $1 and user_id = $2`,
      [id, userId]
    );

    // se não deletou nada, pode ser pq não é do user
    if (del.rowCount === 0) {
      return res.status(404).json({ error: "Transação não encontrada (ou não pertence a você)." });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Erro ao deletar transação", details: String(e?.message || e) });
  }
});

// ===== CATEGORIAS (globais, sem auth) =====

// listar categorias (opcional type=income|expense)
app.get("/api/categories", async (req, res) => {
  try {
    const type = req.query.type;

    const q =
      type === "income" || type === "expense"
        ? await pool.query(
            `
            select name, emoji, kind
            from public.categories
            where is_active = true and (kind = $1 or kind = 'both')
            order by name
            `,
            [type]
          )
        : await pool.query(
            `
            select name, emoji, kind
            from public.categories
            where is_active = true
            order by name
            `
          );

    res.json(q.rows);
  } catch (e) {
    res.status(500).json({ error: "Erro ao listar categorias", details: String(e?.message || e) });
  }
});

// criar categoria (se quiser, dá pra colocar auth/admin depois)
app.post("/api/categories", async (req, res) => {
  try {
    const { name, emoji, kind } = req.body;

    if (!name || typeof name !== "string") return res.status(400).json({ error: "Nome inválido" });
    if (!emoji || typeof emoji !== "string") return res.status(400).json({ error: "Emoji inválido" });
    if (!["both", "income", "expense"].includes(kind)) return res.status(400).json({ error: "Kind inválido" });

    await pool.query(
      `insert into public.categories (name, emoji, kind) values ($1, $2, $3)`,
      [name.trim(), emoji.trim(), kind]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "Categoria já existe ou erro ao salvar", details: String(e?.message || e) });
  }
});

// ===== EXPORT (com auth, por usuário) =====
app.get("/export.xlsx", requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const category = req.query.category || "";

    const q = category
      ? await pool.query(
          `
          select type, amount_cents, category, description,
                 to_char(date_iso, 'YYYY-MM-DD') as date_iso
          from public.transactions
          where user_id = $1 and month_key = $2 and category = $3
          order by date_iso asc, id asc
          `,
          [userId, month, category]
        )
      : await pool.query(
          `
          select type, amount_cents, category, description,
                 to_char(date_iso, 'YYYY-MM-DD') as date_iso
          from public.transactions
          where user_id = $1 and month_key = $2
          order by date_iso asc, id asc
          `,
          [userId, month]
        );

    const rows = q.rows;

    const wb = new ExcelJS.Workbook();
    wb.creator = "Contabils";

    const ws = wb.addWorksheet("Extrato");
    ws.columns = [
      { header: "Data", key: "date", width: 14 },
      { header: "Tipo", key: "type", width: 10 },
      { header: "Categoria", key: "category", width: 18 },
      { header: "Descrição", key: "description", width: 36 },
      { header: "Valor (R$)", key: "value", width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    for (const tx of rows) {
      ws.addRow({
        date: tx.date_iso,
        type: tx.type === "income" ? "Entrada" : "Saída",
        category: tx.category,
        description: tx.description || "",
        value: Number(tx.amount_cents) / 100,
      });
    }

    ws.getColumn("value").numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

    const incomeCents = rows.filter(r => r.type === "income").reduce((a, b) => a + Number(b.amount_cents), 0);
    const expenseCents = rows.filter(r => r.type === "expense").reduce((a, b) => a + Number(b.amount_cents), 0);
    const balanceCents = incomeCents - expenseCents;

    ws.addRow({});
    ws.addRow({
      date: "",
      type: "Exportado em",
      category: new Date().toLocaleString("pt-BR"),
      description: category ? `Filtro: ${category}` : "Filtro: Todas",
      value: "",
    });
    ws.addRow({});

    const r1 = ws.addRow({ date: "", type: "TOTAL ENTRADAS", category: "", description: "", value: incomeCents / 100 });
    const r2 = ws.addRow({ date: "", type: "TOTAL SAÍDAS", category: "", description: "", value: expenseCents / 100 });
    const r3 = ws.addRow({ date: "", type: "SALDO (ENTRADAS - SAÍDAS)", category: "", description: "", value: balanceCents / 100 });
    r1.font = { bold: true };
    r2.font = { bold: true };
    r3.font = { bold: true };

    const safeCat = category ? `_${String(category).replace(/[^\w\-]+/g, "_")}` : "";
    const filename = `contabils_extrato_${month}${safeCat}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).json({ error: "Erro ao exportar", details: String(e?.message || e) });
  }
});


app.listen(PORT, () => {
  console.log(`✅ Contabils rodando em http://localhost:${PORT}`);
});
