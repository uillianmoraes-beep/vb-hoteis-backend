/**
 * Endereços da SEFAZ para a NFC-e (modelo 65) em cada estado: quem autoriza (a própria SEFAZ ou a SVRS),
 * os serviços (SOAP 1.2), o endereço do QR Code (e a versão) e o da consulta pela chave (urlChave).
 * Fonte: tabela pública dos autorizadores (Portal da NF-e), conferida com o projeto aberto sped-nfe.
 */
export interface ServicosNfce { NfeAutorizacao?: string; NfeRetAutorizacao?: string; NfeConsultaProtocolo?: string; RecepcaoEvento?: string; NfeStatusServico?: string; NfeInutilizacao?: string; qr?: string; qrVersao?: string; urlChave?: string }
export interface UfNfce { cUF: number; autorizador: string; homologacao: ServicosNfce; producao: ServicosNfce }

export const UFS_NFCE: Record<string, UfNfce> = {
 "RO": {
  "cUF": 11,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp",
   "qrVersao": "300",
   "urlChave": "www.sefin.ro.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp",
   "qrVersao": "200",
   "urlChave": "www.sefin.ro.gov.br/nfce/consulta"
  }
 },
 "AC": {
  "cUF": 12,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.hml.sefaznet.ac.gov.br/nfce/qrcode",
   "qrVersao": "300",
   "urlChave": "www.sefaznet.ac.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.sefaznet.ac.gov.br/nfce/qrcode",
   "qrVersao": "200",
   "urlChave": "www.sefaznet.ac.gov.br/nfce/consulta"
  }
 },
 "AM": {
  "cUF": 13,
  "autorizador": "AM",
  "homologacao": {
   "NfeAutorizacao": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4",
   "NfeRetAutorizacao": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4",
   "RecepcaoEvento": "https://homnfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4",
   "NfeStatusServico": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4",
   "NfeInutilizacao": "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4",
   "qr": "https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp",
   "qrVersao": "300",
   "urlChave": "www.sefaz.am.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4",
   "NfeRetAutorizacao": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4",
   "RecepcaoEvento": "https://nfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4",
   "NfeStatusServico": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4",
   "NfeInutilizacao": "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4",
   "qr": "https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp",
   "qrVersao": "200",
   "urlChave": "www.sefaz.am.gov.br/nfce/consulta"
  }
 },
 "RR": {
  "cUF": 14,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://200.174.88.103:8080/nfce/servlet/qrcode",
   "qrVersao": "300",
   "urlChave": "www.sefaz.rr.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://www.sefaz.rr.gov.br/servlet/qrcode",
   "qrVersao": "200",
   "urlChave": "www.sefaz.rr.gov.br/nfce/consulta"
  }
 },
 "PA": {
  "cUF": 15,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam",
   "qrVersao": "300",
   "urlChave": "www.sefa.pa.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam",
   "qrVersao": "200",
   "urlChave": "www.sefa.pa.gov.br/nfce/consulta"
  }
 },
 "AP": {
  "cUF": 16,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://www.sefaz.ap.gov.br/nfcehml/nfce.php",
   "qrVersao": "300",
   "urlChave": "www.sefaz.ap.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://www.sefaz.ap.gov.br/nfce/nfcep.php",
   "qrVersao": "200",
   "urlChave": "www.sefaz.ap.gov.br/nfce/consulta"
  }
 },
 "TO": {
  "cUF": 17,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://homologacao.sefaz.to.gov.br/nfce/qrcode",
   "qrVersao": "300",
   "urlChave": "http://homologacao.sefaz.to.gov.br/nfce/consulta.jsf"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.sefaz.to.gov.br/nfce/qrcode",
   "qrVersao": "200",
   "urlChave": "www.sefaz.to.gov.br/nfce/consulta"
  }
 },
 "MA": {
  "cUF": 21,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.hom.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp",
   "qrVersao": "300",
   "urlChave": "www.sefaz.ma.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp",
   "qrVersao": "200",
   "urlChave": "www.sefaz.ma.gov.br/nfce/consulta"
  }
 },
 "PI": {
  "cUF": 22,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.sefaz.pi.gov.br/nfce/qrcode",
   "qrVersao": "300",
   "urlChave": "www.sefaz.pi.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.sefaz.pi.gov.br/nfce/qrcode",
   "qrVersao": "200",
   "urlChave": "www.sefaz.pi.gov.br/nfce/consulta"
  }
 },
 "CE": {
  "cUF": 23,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html",
   "qrVersao": "300",
   "urlChave": "www.sefaz.ce.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html",
   "qrVersao": "200",
   "urlChave": "www.sefaz.ce.gov.br/nfce/consulta"
  }
 },
 "RN": {
  "cUF": 24,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://hom.nfce.set.rn.gov.br/consultarNFCe.aspx",
   "qrVersao": "300",
   "urlChave": "www.set.rn.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://nfce.set.rn.gov.br/consultarNFCe.aspx",
   "qrVersao": "200",
   "urlChave": "www.set.rn.gov.br/nfce/consulta"
  }
 },
 "PB": {
  "cUF": 25,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.sefaz.pb.gov.br/nfcehom",
   "qrVersao": "300",
   "urlChave": "www.sefaz.pb.gov.br/nfcehom"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.sefaz.pb.gov.br/nfce",
   "qrVersao": "200",
   "urlChave": "www.sefaz.pb.gov.br/nfce/consulta"
  }
 },
 "PE": {
  "cUF": 26,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://nfcehomolog.sefaz.pe.gov.br/nfce/consulta",
   "qrVersao": "300",
   "urlChave": "nfce.sefaz.pe.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://nfce.sefaz.pe.gov.br/nfce/consulta",
   "qrVersao": "200",
   "urlChave": "nfce.sefaz.pe.gov.br/nfce/consulta"
  }
 },
 "AL": {
  "cUF": 27,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp",
   "qrVersao": "300",
   "urlChave": "www.sefaz.al.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp",
   "qrVersao": "200",
   "urlChave": "www.sefaz.al.gov.br/nfce/consulta"
  }
 },
 "SE": {
  "cUF": 28,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.hom.nfe.se.gov.br/nfce/qrcode",
   "qrVersao": "300",
   "urlChave": "http://www.hom.nfe.se.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.nfce.se.gov.br/nfce/qrcode",
   "qrVersao": "200",
   "urlChave": "http://www.nfce.se.gov.br/nfce/consulta"
  }
 },
 "BA": {
  "cUF": 29,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx",
   "qrVersao": "300",
   "urlChave": "http://hinternet.sefaz.ba.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx",
   "qrVersao": "200",
   "urlChave": "http://www.sefaz.ba.gov.br/nfce/consulta"
  }
 },
 "MG": {
  "cUF": 31,
  "autorizador": "MG",
  "homologacao": {
   "NfeAutorizacao": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4",
   "NfeRetAutorizacao": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4",
   "RecepcaoEvento": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4",
   "NfeStatusServico": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4",
   "NfeInutilizacao": "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4",
   "qr": "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
   "qrVersao": "300",
   "urlChave": "https://hportalsped.fazenda.mg.gov.br/portalnfce"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4",
   "NfeRetAutorizacao": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4",
   "RecepcaoEvento": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4",
   "NfeStatusServico": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4",
   "NfeInutilizacao": "https://nfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4",
   "qr": "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
   "qrVersao": "200",
   "urlChave": "https://portalsped.fazenda.mg.gov.br/portalnfce"
  }
 },
 "ES": {
  "cUF": 32,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://homologacao.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx",
   "qrVersao": "300",
   "urlChave": "www.sefaz.es.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx",
   "qrVersao": "200",
   "urlChave": "www.sefaz.es.gov.br/nfce/consulta"
  }
 },
 "RJ": {
  "cUF": 33,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode",
   "qrVersao": "300",
   "urlChave": "www.fazenda.rj.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode",
   "qrVersao": "200",
   "urlChave": "www.fazenda.rj.gov.br/nfce/consulta"
  }
 },
 "SP": {
  "cUF": 35,
  "autorizador": "SP",
  "homologacao": {
   "NfeAutorizacao": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx",
   "RecepcaoEvento": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx",
   "NfeStatusServico": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
   "NfeInutilizacao": "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx",
   "qr": "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode",
   "qrVersao": "300",
   "urlChave": "https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx",
   "RecepcaoEvento": "https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx",
   "NfeStatusServico": "https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx",
   "qr": "https://www.nfce.fazenda.sp.gov.br/qrcode",
   "qrVersao": "200",
   "urlChave": "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica"
  }
 },
 "PR": {
  "cUF": 41,
  "autorizador": "PR",
  "homologacao": {
   "NfeAutorizacao": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4",
   "NfeRetAutorizacao": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4",
   "RecepcaoEvento": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4",
   "NfeStatusServico": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeStatusServico4",
   "NfeInutilizacao": "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4",
   "qr": "http://www.fazenda.pr.gov.br/nfce/qrcode",
   "qrVersao": "300",
   "urlChave": "http://www.fazenda.pr.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4",
   "NfeRetAutorizacao": "https://nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4",
   "RecepcaoEvento": "https://nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4",
   "NfeStatusServico": "https://nfce.sefa.pr.gov.br/nfce/NFeStatusServico4",
   "NfeInutilizacao": "https://nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4",
   "qr": "http://www.fazenda.pr.gov.br/nfce/qrcode",
   "qrVersao": "200",
   "urlChave": "http://www.fazenda.pr.gov.br/nfce/consulta"
  }
 },
 "SC": {
  "cUF": 42,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://hom.sat.sef.sc.gov.br/nfce/consulta",
   "qrVersao": "300",
   "urlChave": "https://hom.sat.sef.sc.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://sat.sef.sc.gov.br/nfce/consulta",
   "qrVersao": "200",
   "urlChave": "https://sat.sef.sc.gov.br/nfce/consulta"
  }
 },
 "RS": {
  "cUF": 43,
  "autorizador": "RS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
   "qrVersao": "300",
   "urlChave": "www.sefaz.rs.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
   "qrVersao": "200",
   "urlChave": "www.sefaz.rs.gov.br/nfce/consulta"
  }
 },
 "MS": {
  "cUF": 50,
  "autorizador": "MS",
  "homologacao": {
   "NfeAutorizacao": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4",
   "NfeRetAutorizacao": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
   "RecepcaoEvento": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4",
   "NfeStatusServico": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeStatusServico4",
   "NfeInutilizacao": "https://hom.nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4",
   "qr": "http://www.dfe.ms.gov.br/nfce/qrcode",
   "qrVersao": "300",
   "urlChave": "http://www.dfe.ms.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4",
   "NfeRetAutorizacao": "https://nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
   "RecepcaoEvento": "https://nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4",
   "NfeStatusServico": "https://nfce.sefaz.ms.gov.br/ws/NFeStatusServico4",
   "NfeInutilizacao": "https://nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4",
   "qr": "http://www.dfe.ms.gov.br/nfce/qrcode",
   "qrVersao": "200",
   "urlChave": "http://www.dfe.ms.gov.br/nfce/consulta"
  }
 },
 "MT": {
  "cUF": 51,
  "autorizador": "MT",
  "homologacao": {
   "NfeAutorizacao": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4",
   "NfeRetAutorizacao": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
   "RecepcaoEvento": "https://homologacao.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4",
   "NfeStatusServico": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4",
   "NfeInutilizacao": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4",
   "qr": "http://homologacao.sefaz.mt.gov.br/nfce/consultanfce",
   "qrVersao": "300",
   "urlChave": "http://homologacao.sefaz.mt.gov.br/nfce/consultanfce"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4",
   "NfeRetAutorizacao": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
   "RecepcaoEvento": "https://nfce.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4",
   "NfeStatusServico": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4",
   "NfeInutilizacao": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4",
   "qr": "http://www.sefaz.mt.gov.br/nfce/consultanfce",
   "qrVersao": "200",
   "urlChave": "http://www.sefaz.mt.gov.br/nfce/consultanfce"
  }
 },
 "GO": {
  "cUF": 52,
  "autorizador": "GO",
  "homologacao": {
   "NfeAutorizacao": "https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
   "NfeRetAutorizacao": "https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
   "RecepcaoEvento": "https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4",
   "NfeStatusServico": "https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
   "NfeInutilizacao": "https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
   "qr": "https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
   "qrVersao": "300",
   "urlChave": "www.nfce.go.gov.br/post/ver/214413/consulta-nfc-e-homologacao"
  },
  "producao": {
   "NfeAutorizacao": "https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
   "NfeRetAutorizacao": "https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
   "NfeConsultaProtocolo": "https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
   "RecepcaoEvento": "https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4",
   "NfeStatusServico": "https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
   "NfeInutilizacao": "https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
   "qr": "https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
   "qrVersao": "200",
   "urlChave": "www.sefaz.go.gov.br/nfce/consulta"
  }
 },
 "DF": {
  "cUF": 53,
  "autorizador": "SVRS",
  "homologacao": {
   "NfeAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://dec.fazenda.df.gov.br/ConsultarNFCe.aspx",
   "qrVersao": "300",
   "urlChave": "www.fazenda.df.gov.br/nfce/consulta"
  },
  "producao": {
   "NfeAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
   "NfeRetAutorizacao": "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
   "NfeConsultaProtocolo": "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
   "RecepcaoEvento": "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
   "NfeStatusServico": "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
   "NfeInutilizacao": "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
   "qr": "http://www.fazenda.df.gov.br/nfce/qrcode",
   "qrVersao": "200",
   "urlChave": "www.fazenda.df.gov.br/nfce/consulta"
  }
 }
};
