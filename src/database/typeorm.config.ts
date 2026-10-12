import { DataSourceOptions } from 'typeorm';
import { join } from 'path';

/**
 * Configuração única do banco.
 * - synchronize desligado: o schema só muda por migration.
 * - migrationsRun: as migrations pendentes rodam sozinhas a cada deploy.
 */
export function opcoesBanco(): DataSourceOptions {
  const ssl = (process.env.DATABASE_SSL || 'false').toLowerCase() === 'true';
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    entities: [join(__dirname, '..', '**', '*.entity.{js,ts}')],
    migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
    migrationsTableName: 'migrations',
    migrationsRun: true,
    synchronize: false,
    logging: ['error', 'migration'],
  };
}
