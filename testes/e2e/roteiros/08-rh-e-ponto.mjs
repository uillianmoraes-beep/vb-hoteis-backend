// RH: funcionários (e o que cada perfil vê deles), ponto pelo tablet (quiosque) e pelo link do celular.
import { api, verifica, status, exige, entrar } from '../lib.mjs';

const rosto = (base) => Array.from({ length: 128 }, (_, i) => Math.round((Math.sin(i + base) * 0.1) * 10000) / 10000);
const longe = (r) => r.map((v) => v + 0.2);
// "foto" JPG de mentira com o tamanho mínimo aceito
const foto = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7), Buffer.from([0xff, 0xd9])]).toString('base64')}`;

export default async function (ctx) {
  const d = ctx.dados;
  const adm = ctx.admin;

  const f1 = await adm.post('/funcionarios', { nome: 'Ana Camareira', funcao: 'camareira', documento: '529.982.247-25', telefone: '24999990000', chavePix: 'ana@pix.com', nascimento: '1990-05-10', admissao: '2024-01-02' });
  exige('cadastra funcionária', [200, 201].includes(f1.status), f1.json);
  const f2 = await adm.post('/funcionarios', { nome: 'Bruno Portaria', funcao: 'portaria' });
  verifica('cadastra funcionário 2', [200, 201].includes(f2.status), f2.json);
  const funcaoRuim = await adm.post('/funcionarios', { nome: 'X', funcao: 'astronauta' });
  verifica('função inexistente é recusada', funcaoRuim.status === 400, funcaoRuim.json);

  // a recepção e a camareira só precisam do nome para escolher na lista
  const rec = await entrar(d.logins.recepcao, d.logins.senha);
  const lr = await rec.get('/funcionarios');
  status('recepção lista os funcionários (para escolher a camareira)', lr, 200);
  const ana = (lr.json ?? []).find((x) => x.nome === 'Ana Camareira');
  verifica('recepção NÃO vê CPF, telefone, Pix e nascimento dos funcionários', ana && !ana.documento && !ana.telefone && !ana.chavePix && !ana.nascimento, ana);
  const la = await adm.get('/funcionarios');
  const anaAdm = la.json.find((x) => x.nome === 'Ana Camareira');
  verifica('quem gerencia funcionários continua vendo os dados completos', anaAdm?.documento === '529.982.247-25' && anaAdm?.chavePix === 'ana@pix.com', anaAdm);

  // ponto: cadastro do rosto
  const semConsent = await adm.put(`/ponto/rosto/${f1.json.id}`, { descritor: rosto(1), foto, consentimento: false });
  verifica('sem consentimento (LGPD) não cadastra o rosto', semConsent.status === 400, semConsent.json);
  status('cadastra o rosto da Ana com consentimento', await adm.put(`/ponto/rosto/${f1.json.id}`, { descritor: rosto(1), foto, consentimento: true }), 200);
  status('cadastra o rosto do Bruno', await adm.put(`/ponto/rosto/${f2.json.id}`, { descritor: rosto(5), foto, consentimento: true }), 200);

  // quiosque (tablet)
  status('tablet do ponto abre', await adm.get('/ponto/quiosque'), 200);
  const outro = await adm.post('/ponto/quiosque', { funcionarioId: f1.json.id, descritor: longe(rosto(1)), foto });
  verifica('rosto diferente não bate o ponto', outro.status === 400 && /rosto/i.test(outro.json?.message ?? ''), outro.json);
  const bate = await adm.post('/ponto/quiosque', { funcionarioId: f1.json.id, descritor: rosto(1), foto });
  status('Ana bate o ponto no tablet', bate, 200);
  const repete = await adm.post('/ponto/quiosque', { funcionarioId: f1.json.id, descritor: rosto(1), foto });
  verifica('bater de novo em menos de 2 minutos é recusado', repete.status === 400 && /2 minutos/.test(repete.json?.message ?? ''), repete.json);
  const recQ = await rec.post('/ponto/quiosque', { funcionarioId: f1.json.id, descritor: rosto(1), foto });
  verifica('recepção não usa o tablet do ponto (403)', recQ.status === 403, recQ.status);

  // link do celular
  const link = await adm.post(`/ponto/link/${f2.json.id}`);
  status('gera o link do ponto pelo celular do Bruno', link, 200);
  const token = link.json?.token ?? String(link.json?.link ?? link.json?.url ?? '').split('/').pop();
  exige('o link traz um código', token && token.length >= 20, link.json);
  status('link inventado não abre (404)', await api('GET', '/publico/ponto/codigo-inventado-que-nao-existe-123'), 404);
  status('Bruno abre o link sem login', await api('GET', `/publico/ponto/${token}`), 200);
  status('Bruno bate o ponto pelo celular', await api('POST', `/publico/ponto/${token}`, { descritor: rosto(5), foto }), 200);
  const anaNoLinkDoBruno = await api('POST', `/publico/ponto/${token}`, { descritor: rosto(1), foto });
  verifica('o rosto da Ana não bate no link do Bruno', anaNoLinkDoBruno.status === 400, anaNoLinkDoBruno.json);

  // local do ponto (com cerca): sem localização é recusado
  status('define o local do ponto do motel (cerca de 200 m)', await adm.put(`/ponto/local/${d.motelId}`, { lat: -22.47, lng: -43.82, raio: 200 }), 200);
  await adm.post(`/ponto/link/${f1.json.id}`).then(async (l) => {
    const t = l.json?.token ?? String(l.json?.link ?? l.json?.url ?? '').split('/').pop();
    const semGps = await api('POST', `/publico/ponto/${t}`, { descritor: rosto(1), foto });
    verifica('com cerca ligada, celular sem localização é recusado', semGps.status === 400 && /localiza/i.test(semGps.json?.message ?? ''), semGps.json);
  });

  // relatórios do RH
  const painel = await adm.get('/ponto');
  status('painel do ponto do dia', painel, 200);
  verifica('painel mostra as batidas da Ana e do Bruno', JSON.stringify(painel.json).includes('Ana Camareira') && JSON.stringify(painel.json).includes('Bruno Portaria'), JSON.stringify(painel.json).slice(0, 300));
  status('espelho do ponto da Ana', await adm.get(`/ponto/espelho/${f1.json.id}`), 200);
  for (const r of ['/rh/painel', '/rh/banco-horas', '/rh/escala', '/rh/licencas', '/aniversariantes']) {
    const x = await adm.get(r);
    verifica(`tela ${r} abre sem erro`, x.status === 200, `${x.status}: ${x.texto.slice(0, 150)}`);
  }
  verifica('recepção não vê o espelho do ponto (403)', (await rec.get(`/ponto/espelho/${f1.json.id}`)).status === 403);
}
