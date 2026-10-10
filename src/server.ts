<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui;padding:24px;background:#fff;color:#111}typescript
import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Configuração de middlewares
app.use(cors());
app.use(express.json());

// Conexão com o PostgreSQL do Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Rota de Health Check
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'online',
    service: 'VB Hotéis e Motéis API',
    timestamp: new Date().toISOString()
  });
});

// Teste de conexão com o banco
app.get('/api/health/db', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    res.json({
      database: 'connected',
      server_time: result.rows[0].current_time
    });
  } catch (error: any) {
    res.status(500).json({
      database: 'error',
      message: error.message
    });
  }
});

// Inicialização do servidor
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});</style></head><body><div class="preview-root"><h1>Preview</h1><p>Estilos aplicados ao documento de exemplo.</p><button class="btn">Botão</button><div class="card price-card best-offer"><div class="price-name">Plano</div><div class="price-value">R$ 99</div></div></div></body></html>
