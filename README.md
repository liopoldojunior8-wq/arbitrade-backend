# ⚡ ArbitrageAI — Backend

Node.js + Express + PostgreSQL + Prisma + Redis

---

## 🚀 Setup em 5 Passos

### 1. Instalar dependências
```bash
cd arbitrage-backend
npm install
```

### 2. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Editar .env com os seus valores reais
```

### 3. Configurar banco de dados (PostgreSQL)

**Opção recomendada — Supabase (grátis):**
1. Criar conta em https://supabase.com
2. Criar novo projeto
3. Copiar a "Connection String" para DATABASE_URL no .env

```bash
# Criar as tabelas
npm run db:push

# Gerar o Prisma client
npm run db:generate

# (Opcional) Ver o banco pelo browser
npm run db:studio
```

### 4. Configurar Redis (cache)

**Opção recomendada — Upstash (grátis):**
1. Criar conta em https://upstash.com
2. Criar database Redis
3. Copiar a URL para REDIS_URL no .env

### 5. Iniciar o servidor
```bash
# Desenvolvimento (com hot reload)
npm run dev

# Produção
npm start
```

Servidor disponível em: `http://localhost:4000`
Health check: `http://localhost:4000/health`

---

## 💳 Configurar Pagamentos

### PayPal
1. Criar conta em https://developer.paypal.com
2. Criar app → copiar Client ID e Secret
3. Em produção, mudar `PAYPAL_MODE=live`
4. Configurar webhook: `POST /api/webhooks/paypal`

### M-Pesa (Vodacom Moçambique)
1. Registar em https://developer.vm.co.mz
2. Obter API Key e Public Key
3. Configurar Service Provider Code: `171717`
4. Callback URL: `POST /api/payments/mpesa/callback`

### Transferência Bancária
- Preencher dados bancários no .env
- Admin confirma manualmente via: `POST /api/payments/bank/confirm`

---

## 📡 API Endpoints

### Auth
```
POST /api/auth/register     — Criar conta
POST /api/auth/login        — Login
POST /api/auth/refresh      — Renovar token
POST /api/auth/logout       — Logout
GET  /api/auth/me           — Dados do utilizador logado
```

### Pagamentos
```
GET  /api/payments/plans                  — Planos e preços
GET  /api/payments/my                     — Histórico do utilizador

POST /api/payments/paypal/create-order    — Criar ordem PayPal
POST /api/payments/paypal/capture/:id     — Capturar pagamento

POST /api/payments/mpesa/pay              — Iniciar pagamento M-Pesa
POST /api/payments/mpesa/callback         — Callback M-Pesa (automático)
GET  /api/payments/mpesa/status/:ref      — Verificar status

POST /api/payments/bank/instructions      — Obter dados p/ transferência
POST /api/payments/bank/confirm           — Admin confirma transferência [ADMIN]
GET  /api/payments/admin/all              — Todos os pagamentos [ADMIN]
```

### Scanner
```
GET  /api/scanner/opportunities           — Listar oportunidades ativas
POST /api/scanner/scan                    — Executar scan [PRO]
```

### Produtos
```
GET  /api/products                        — Listar produtos
GET  /api/products/:id                    — Detalhe do produto
POST /api/products/:id/track              — Adicionar ao watchlist
DELETE /api/products/:id/track            — Remover do watchlist
```

### Alertas
```
GET  /api/alerts                          — Alertas do utilizador
POST /api/alerts/rules                    — Criar regra de alerta
GET  /api/alerts/rules                    — Listar regras
DELETE /api/alerts/rules/:id              — Eliminar regra
```

### Utilizadores
```
GET  /api/users/me/tracked                — Produtos monitorizados
PATCH /api/users/me                       — Atualizar perfil
PATCH /api/users/me/password              — Alterar password
GET  /api/users/me/notifications          — Notificações
PATCH /api/users/me/notifications/read    — Marcar como lido
```

### Admin
```
GET  /api/admin/stats                     — Estatísticas globais
GET  /api/admin/users                     — Listar utilizadores
PATCH /api/admin/users/:id                — Gerir utilizador
GET  /api/admin/revenue                   — Dados de receita
```

---

## 🌍 Deploy — Railway (recomendado)

1. Criar conta em https://railway.app
2. Novo projeto → "Deploy from GitHub repo"
3. Adicionar serviço PostgreSQL (Railway oferece grátis)
4. Configurar variáveis de ambiente no painel
5. Deploy automático em cada push

```bash
# URL da sua API em produção:
# https://arbitrage-ai-backend.railway.app
```

**Domínio customizado:**
- Comprar domínio (Namecheap, GoDaddy)
- Configurar no Railway: `api.arbitrageai.com`

---

## 📦 Estrutura do Projeto

```
arbitrage-backend/
├── prisma/
│   └── schema.prisma          ← Schema do banco de dados
├── src/
│   ├── index.js               ← Entry point do servidor
│   ├── routes/
│   │   ├── auth.js            ← Autenticação
│   │   ├── payments.js        ← PayPal, M-Pesa, Banco
│   │   ├── scanner.js         ← Motor de arbitragem
│   │   ├── products.js        ← Gestão de produtos
│   │   ├── alerts.js          ← Sistema de alertas
│   │   ├── users.js           ← Perfil do utilizador
│   │   ├── admin.js           ← Painel admin
│   │   └── webhooks.js        ← Webhooks externos
│   ├── services/
│   │   ├── paymentService.js  ← Lógica de pagamento
│   │   ├── scannerService.js  ← Motor de scan
│   │   ├── emailService.js    ← Templates de email
│   │   └── alertService.js    ← Dispatcher de alertas
│   ├── middleware/
│   │   └── auth.js            ← JWT + guards de plano
│   ├── jobs/
│   │   └── index.js           ← Cron jobs (preços, alertas)
│   └── utils/
│       ├── prisma.js          ← Prisma singleton
│       ├── redis.js           ← Cache Redis
│       └── logger.js          ← Winston logger
├── .env.example               ← Template de variáveis
├── package.json
└── README.md
```

---

## ⚡ Próximos Passos

1. [ ] Integrar Amazon PA-API (chaves reais)
2. [ ] Integrar eBay Browse API (chaves reais)
3. [ ] Ativar M-Pesa em produção
4. [ ] Configurar domínio + SSL
5. [ ] Conectar frontend ao backend
6. [ ] Seed da base de dados com produtos reais
7. [ ] Configurar Telegram Bot (@BotFather)
