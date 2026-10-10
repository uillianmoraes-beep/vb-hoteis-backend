<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui;padding:24px;background:#fff;color:#111}ts ` ou formatação de texto na linha 1).

Vamos corrigir isso agora diretamente no GitHub.

---

## Passo 1: Abrir o `src/server.ts` no GitHub

1. Volte na aba do **GitHub** (a 4ª aba lá no topo do navegador: `uillianmoraes-beep/vb...`).
2. Entre na pasta **`src`** e clique no arquivo **`server.ts`**.
3. Clique no ícone de lápis ✏️ (**Edit this file**) no canto superior direito.

---

## Passo 2: Substituir por este código limpo

Apague **absolutamente tudo** o que estiver dentro do arquivo e cole exatamente o bloco abaixo (sem incluir nada antes ou depois):

```typescript
import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';

const app = express();
const port = process.env.PORT || 3333;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'API VB Hotéis & Motéis rodando com sucesso!',
  });
});

app.get('/health', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error: any) {
    res.status(500).json({ status: 'unhealthy', database: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
```

---

## Passo 3: Salvar no GitHub

1. Clique no botão verde **`Commit changes...`** no topo direito.
2. Na janelinha que abrir, clique em **`Commit changes`**.

---

## O que vai acontecer em seguida:
Assim que você salvar, o Railway detecta a alteração automaticamente e inicia uma nova compilação. Em cerca de 1 minuto o status ficará verde no Railway!</style></head><body><div class="preview-root"><h1>Preview</h1><p>Estilos aplicados ao documento de exemplo.</p><button class="btn">Botão</button><div class="card price-card best-offer"><div class="price-name">Plano</div><div class="price-value">R$ 99</div></div></div></body></html>
