// Conecta o Instagram ao projeto da sua COMPOSIO_API_KEY (chave "ak_").
// Gera um link de autorização da Meta, espera você autorizar e imprime as
// linhas para o .env. Não imprime chaves nem tokens.
// Uso: npm run conectar
import 'dotenv/config';
import { Composio } from '@composio/core';

const fail = (code = 1) => { process.exitCode = code; }; // sem process.exit (bug do Node no Windows)

async function main() {
  const key = process.env.COMPOSIO_API_KEY || '';
  if (!key) { console.error('COMPOSIO_API_KEY não encontrada no .env.'); return fail(); }
  if (key.startsWith('ck_')) { console.error('Use a API key do PROJETO (começa com "ak_"), não a chave de consumidor "ck_".'); return fail(); }

  // user_id é um nome que você escolhe para identificar o "dono" da conexão no projeto.
  const userId = process.env.COMPOSIO_USER_ID || 'anselmotech';
  const composio = new Composio({ apiKey: key, allowTracking: false });

  // 1) Reaproveita a Auth Config do Instagram do projeto (ou cria uma gerenciada pelo Composio).
  let authConfigId = process.env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID || '';
  try {
    if (!authConfigId) {
      const list = await composio.authConfigs.list({ toolkit: 'instagram' });
      authConfigId = list?.items?.[0]?.id || '';
    }
    if (!authConfigId) {
      const created = await composio.authConfigs.create('instagram', { type: 'use_composio_managed_auth' });
      authConfigId = created.id;
      console.log('Auth Config do Instagram criada no projeto.');
    } else {
      console.log('Usando a Auth Config do Instagram que já existe no projeto.');
    }
  } catch (e) {
    console.error(`Não foi possível obter/criar a Auth Config do Instagram: ${e.message}`);
    return fail();
  }

  // 2) Gera o link de conexão (endpoint connected_accounts/link, exigido pelo Composio).
  let req;
  try {
    req = await composio.connectedAccounts.link(userId, authConfigId);
  } catch (e) {
    console.error(`Não foi possível iniciar a conexão: ${e.message}`);
    console.error('Se for erro de permissão (401/403), a API key precisa de escrita em "Connected accounts".');
    return fail();
  }
  if (!req.redirectUrl) {
    console.error('O Composio não devolveu um link de autorização. Tente pelo painel do projeto.');
    return fail();
  }
  console.log('\n1) Abra este link no navegador e autorize a conta @anselmo.tech (Instagram Business):\n');
  console.log(`   ${req.redirectUrl}\n`);
  console.log('2) Aguardando a autorização (até 5 minutos)...\n');

  let acc;
  try {
    acc = await req.waitForConnection(5 * 60 * 1000);
  } catch (e) {
    console.error(`A conexão não foi concluída: ${e.message}`);
    console.error('Rode "npm run conectar" de novo e autorize dentro de 5 minutos.');
    return fail();
  }
  console.log(`Conexão ${acc.status === 'ACTIVE' ? 'ATIVA' : acc.status}. Coloque no seu .env:\n`);
  console.log(`COMPOSIO_USER_ID=${userId}`);
  console.log(`COMPOSIO_INSTAGRAM_ACCOUNT_ID=${acc.id}\n`);
  console.log('Depois rode "npm start" e confira a tela Integração.');
}

await main();
