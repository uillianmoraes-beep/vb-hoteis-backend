import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'API VB Hoteis & Moteis rodando com sucesso!',
  });
});

app.get('/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      status: 'healthy',
      database: 'connected',
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: (error as Error).message,
    });
  }
});

app.get('/quartos', async (req: Request, res: Response) => {
  try {
    const query = [
      'SELECT',
      '  q.id,',
      '  q.numero,',
      '  q.status,',
      '  q.observacoes,',
      '  c.nome AS categoria,',
      '  c.valor_hora,',
      '  c.valor_adicional_hora,',
      '  c.valor_pernoite,',
      '  c.valor_diaria',
      'FROM quartos q',
      'INNER JOIN categorias_quartos c ON q.categoria_id = c.id',
      'ORDER BY q.numero ASC;',
    ].join('\n');

    const result = await pool.query(query);

    res.json({
      total: result.rowCount,
      quartos: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message,
    });
  }
});

app.patch('/quartos/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const statusPermitidos = [
    'disponivel',
    'ocupado',
    'limpeza',
    'manutencao',
  ];

  if (
    typeof status !== 'string' ||
    !statusPermitidos.includes(status)
  ) {
    res.status(400).json({
      error:
        'Status inválido. Use: disponivel, ocupado, limpeza ou manutencao.',
    });
    return;
  }

  try {
    const result = await pool.query(
      'UPDATE quartos SET status = $1 WHERE id = $2 RETURNING *;',
      [status, id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({
        error: 'Quarto não encontrado.',
      });
      return;
    }

    res.json({
      message: 'Status atualizado com sucesso!',
      quarto: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message,
    });
  }
});

app.get('/produtos', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM produtos ORDER BY nome ASC;'
    );

    res.json({
      total: result.rowCount,
      produtos: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message,
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(
    'API VB Hoteis & Moteis rodando na porta ' + port
  );
});
