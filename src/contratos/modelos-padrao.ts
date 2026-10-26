/**
 * Textos prontos dos contratos do hotel (ponto de partida: revisar com o advogado).
 * Variáveis trocadas na hora de enviar: {{CONTRATANTE}}, {{CONTRATADA}}, {{SERVICOS}}, {{VALOR_TOTAL}}, {{DIA_VENCIMENTO}},
 * {{FORMA_PAGAMENTO}}, {{VIGENCIA}}, {{DATA_INICIO}}, {{DATA_FIM}}, {{ALTERACAO}}. Trechos [PREENCHER: ...] impedem o envio.
 */

/** serviços que o contrato pode ter; cada um puxa as suas cláusulas */
export const AREAS = {
  hospedagem: 'Hospedagem (diárias acordadas)',
  alimentacao: 'Alimentação (café, almoço, jantar)',
  lavanderia: 'Lavanderia',
  eventos: 'Eventos e salão',
  estacionamento: 'Estacionamento',
  servico: 'Prestação de serviço ao hotel (fornecedor)',
} as const;
export type Area = keyof typeof AREAS;

export const QUALIFICACAO_PADRAO =
  '{{NOME_HOTEL}}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {{CNPJ_HOTEL}}, com sede em [PREENCHER: endereço completo do hotel], neste ato representada por [PREENCHER: nome e cargo do representante]';

export const ADITIVO_PADRAO = `TERMO ADITIVO AO CONTRATO Nº {{NUMERO}}

As partes, {{CONTRATANTE}}, doravante CONTRATANTE, e {{CONTRATADA}}, doravante CONTRATADA, resolvem aditar o contrato acima, mantidas todas as demais cláusulas, nos seguintes termos:

{{ALTERACAO}}

Com este aditivo, os serviços passam a ser:

{{SERVICOS}}

O valor mensal passa a ser de {{VALOR_TOTAL}}, a partir de {{DATA_INICIO}}, com vencimento todo dia {{DIA_VENCIMENTO}}, por {{FORMA_PAGAMENTO}}.`;

export const CLAUSULAS_PADRAO: { area: 'geral' | Area; ordem: number; titulo: string; texto: string }[] = [
  { area: 'geral', ordem: 10, titulo: 'Das partes e do objeto', texto: 'São partes deste contrato, de um lado, {{CONTRATANTE}}, doravante denominada CONTRATANTE, e, de outro, {{CONTRATADA}}, doravante denominada CONTRATADA.\n\nO presente contrato tem por objeto a prestação, pela CONTRATADA, dos serviços relacionados abaixo, nas condições deste instrumento:\n\n{{SERVICOS}}' },
  { area: 'geral', ordem: 30, titulo: 'Do prazo e da vigência', texto: 'O presente contrato vigora por {{VIGENCIA}}, de {{DATA_INICIO}} a {{DATA_FIM}}, renovando-se automaticamente por iguais períodos se nenhuma das partes se manifestar em contrário, por escrito, com 30 (trinta) dias de antecedência.' },
  { area: 'geral', ordem: 40, titulo: 'Do preço e do pagamento', texto: 'Pelos serviços contratados, a CONTRATANTE pagará à CONTRATADA o valor mensal de {{VALOR_TOTAL}}, com vencimento todo dia {{DIA_VENCIMENTO}}, por {{FORMA_PAGAMENTO}}. Os serviços cobrados por uso (diárias, refeições, eventos) seguem os valores unitários deste contrato e são faturados no fechamento do período.\n\nO atraso no pagamento sujeita a CONTRATANTE a multa de 2% (dois por cento) e juros de 1% (um por cento) ao mês. Os valores serão reajustados a cada 12 (doze) meses pelo IPCA ou por outro índice que o substitua.' },
  { area: 'geral', ordem: 50, titulo: 'Das obrigações da contratada', texto: 'A CONTRATADA se obriga a prestar os serviços com qualidade, segurança e pontualidade, com equipe treinada, cumprindo as normas legais e sanitárias aplicáveis, e a comunicar à CONTRATANTE, com antecedência, qualquer fato que possa afetar a prestação dos serviços.' },
  { area: 'geral', ordem: 60, titulo: 'Das obrigações da contratante', texto: 'A CONTRATANTE se obriga a efetuar os pagamentos nas datas combinadas, a fornecer as informações necessárias à prestação dos serviços e a zelar pelo cumprimento das regras internas da CONTRATADA por seus funcionários, hóspedes e convidados.' },
  { area: 'geral', ordem: 70, titulo: 'Dos aditivos', texto: 'Qualquer alteração de serviços, valores ou condições deste contrato será feita por termo aditivo assinado pelas partes, que passa a fazer parte deste instrumento.' },
  { area: 'geral', ordem: 80, titulo: 'Da rescisão', texto: 'Este contrato poderá ser rescindido por qualquer das partes, sem multa, mediante aviso prévio por escrito de 30 (trinta) dias, ou imediatamente em caso de descumprimento de qualquer cláusula, respondendo a parte culpada pelos prejuízos causados. Os serviços prestados até a data da rescisão serão pagos integralmente.' },
  { area: 'geral', ordem: 90, titulo: 'Da proteção de dados', texto: 'As partes tratarão os dados pessoais a que tiverem acesso apenas para a execução deste contrato, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), adotando medidas de segurança adequadas e não os compartilhando com terceiros sem base legal.' },
  { area: 'geral', ordem: 100, titulo: 'Da assinatura eletrônica e do foro', texto: 'As partes reconhecem a validade da assinatura eletrônica deste contrato, registrada com data, hora, endereço de rede (IP) e código de conferência, nos termos da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020.\n\nFica eleito o foro da comarca da sede da CONTRATADA para dirimir quaisquer questões oriundas deste contrato.' },
  { area: 'hospedagem', ordem: 20, titulo: 'Da hospedagem', texto: 'A CONTRATADA hospedará os funcionários e convidados indicados pela CONTRATANTE nas diárias e categorias de apartamento acordadas neste contrato, sujeitas à disponibilidade, com entrada (check-in) a partir das 14h e saída (check-out) até as 12h.\n\nAs reservas serão solicitadas por escrito pela CONTRATANTE. Cancelamentos com menos de 24 (vinte e quatro) horas de antecedência e não comparecimentos (no-show) serão cobrados como uma diária. O consumo pessoal do hóspede não incluído neste contrato será pago diretamente pelo hóspede, salvo autorização por escrito da CONTRATANTE.' },
  { area: 'alimentacao', ordem: 21, titulo: 'Da alimentação', texto: 'A CONTRATADA fornecerá as refeições contratadas (café da manhã, almoço e/ou jantar) aos hóspedes e funcionários indicados pela CONTRATANTE, nos horários do restaurante, pelos valores unitários deste contrato, faturados conforme o consumo do período.' },
  { area: 'lavanderia', ordem: 22, titulo: 'Da lavanderia', texto: 'A CONTRATADA prestará serviços de lavanderia das peças entregues pela CONTRATANTE, com prazo de devolução de até [PREENCHER: prazo em dias] dias, respondendo pelos danos comprovadamente causados no processo de lavagem, limitados ao valor de reposição da peça.' },
  { area: 'eventos', ordem: 23, titulo: 'Dos eventos e do salão', texto: 'A CONTRATADA cederá o espaço e os serviços de eventos contratados na data e no horário combinados por escrito. A CONTRATANTE responde pelos danos causados por seus convidados às instalações e deve confirmar o número de participantes com 72 (setenta e duas) horas de antecedência, que será o mínimo cobrado.' },
  { area: 'estacionamento', ordem: 24, titulo: 'Do estacionamento', texto: 'A CONTRATADA disponibilizará as vagas de estacionamento contratadas, sem responsabilidade por objetos deixados no interior dos veículos.' },
  { area: 'servico', ordem: 25, titulo: 'Da prestação de serviço ao hotel', texto: 'A CONTRATADA prestará ao hotel os serviços descritos neste contrato, com profissionais próprios e sob sua inteira responsabilidade trabalhista, previdenciária e fiscal, sem vínculo empregatício com a CONTRATANTE, cumprindo as regras de segurança e de convivência do hotel durante a execução dos serviços.' },
];
