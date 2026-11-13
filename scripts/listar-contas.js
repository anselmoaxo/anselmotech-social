// Lista as contas do Instagram conectadas ao projeto da sua COMPOSIO_API_KEY.
// Mostra o ID da conta (ca_...) e o user_id para colocar no .env. Não imprime chaves.
// Uso: npm run contas
import 'dotenv/config';

const key = process.env.COMPOSIO_API_KEY;
if (!key) {
  console.error('COMPOSIO_API_KEY não encontrada. Preencha o arquivo .env primeiro.');
  process.exit(1);
}

const url = 'https://backend.composio.dev/api/v3/connected_accounts?toolkit_slugs=instagram&limit=50';
let res;
try {
  res = await fetch(url, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(20000) });
} catch (e) {
  console.error(`Não consegui falar com o Composio: ${e.message}`);
  process.exit(1);
}
if (res.status === 401 || res.status === 403) {
  console.error('O Composio recusou a chave (HTTP ' + res.status + '). Confira se copiou a API key do projeto inteira.');
  process.exit(1);
}
if (!res.ok) {
  console.error(`O Composio respondeu HTTP ${res.status}.`);
  process.exit(1);
}
const data = await res.json();
const items = data.items || [];
if (!items.length) {
  console.log('Nenhuma conta do Instagram conectada neste projeto do Composio.');
  console.log('A conexão "malto-charge" provavelmente está em outro projeto (a do conector do Claude).');
  console.log('Conecte o Instagram dentro do projeto desta API key e rode "npm run contas" de novo.');
  process.exit(0);
}
console.log(`Contas do Instagram neste projeto: ${items.length}\n`);
for (const a of items) {
  console.log(`Status:   ${a.status}${a.status === 'ACTIVE' ? '  <- pode usar' : ''}`);
  console.log(`Criada:   ${a.created_at || '-'}`);
  console.log(`COMPOSIO_USER_ID=${a.user_id}`);
  console.log(`COMPOSIO_INSTAGRAM_ACCOUNT_ID=${a.id}\n`);
}
console.log('Copie as duas linhas da conta ACTIVE para o seu .env.');
