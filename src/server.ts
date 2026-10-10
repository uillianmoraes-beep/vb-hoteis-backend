```ts
import express from 'express';
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

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'API VB Hoteis & Moteis rodando com sucesso!',
  });
});

app.get('/health', async (req, res) => {
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

⚠️ **Atenção:** 
- A **primeira linha** deve começar diretamente com `import express from 'express';` (sem ``` ou texto antes).
- A **última linha** deve terminar em `});` (sem ``` ou crases depois).

5. Clique em **`Commit changes...`** e confirme no botão verde.

Assim que salvar, volte na aba do Railway e observe a aba **Deployments**.
