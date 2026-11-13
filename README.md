# AnselmoTech Social

App web para gerenciar o Instagram profissional **@anselmo.tech**: ideias, legendas, roteiros de Reels, calendário editorial, publicação e agendamento automáticos, e análise de resultados com dados reais da API. A integração com o Instagram é feita pelo **Composio**.

## O que a integração permite (verificado em 12/11/2026)

Conta conectada no Composio: **@anselmo.tech**, tipo BUSINESS. Testei só leituras; nada foi publicado durante o desenvolvimento.

| Ferramenta Composio | Tipo | Uso no app |
|---|---|---|
| `INSTAGRAM_GET_USER_INFO` | leitura | perfil, seguidores, nº de posts |
| `INSTAGRAM_GET_USER_INSIGHTS` | leitura | alcance, visualizações, contas engajadas, interações, visitas ao perfil |
| `INSTAGRAM_GET_IG_USER_MEDIA` / `INSTAGRAM_GET_IG_MEDIA` | leitura | lista de posts, link permanente, conferência pós-publicação |
| `INSTAGRAM_GET_IG_MEDIA_INSIGHTS` | leitura | métricas por post (views, alcance, salvos, compartilhamentos, tempo médio de Reels) |
| `INSTAGRAM_GET_IG_MEDIA_COMMENTS` | leitura | comentários (somente leitura) |
| `INSTAGRAM_GET_IG_USER_CONTENT_PUBLISHING_LIMIT` | leitura | cota de publicação (100 por 24h) |
| `INSTAGRAM_GET_POST_STATUS` | leitura | status do contêiner. O Composio marca como obsoleta, mas é a única que lê contêiner não publicado |
| `INSTAGRAM_POST_IG_USER_MEDIA` | escrita | cria contêiner: imagem (feed), `REELS` ou `STORIES` |
| `INSTAGRAM_CREATE_CAROUSEL_CONTAINER` | escrita | cria contêiner de carrossel (2 a 10 itens) |
| `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH` | escrita | publica um contêiner |

Existem no Composio, mas o app **não usa**: responder e excluir comentários, e enviar DM.

### Limitações reais
- **Não há agendamento nativo** no Instagram/Composio. Quem agenda é o servidor deste app (fila persistente em `data/db.json`, conferida a cada 30 s). Fechar o navegador não afeta nada, mas **o servidor precisa estar ligado** no horário.
- **Não há como editar ou excluir** um post já publicado.
- A publicação exige **URL pública e direta** da mídia (JPEG para imagem, MP4/MOV para vídeo). Para enviar arquivos do computador, configure o Supabase Storage (opcional).
- **Formatos:** as ferramentas aceitam imagem, Reels, Stories e carrossel, mas a aceitação **na sua conta** só é confirmada criando um contêiner. Use **Testar formato** no editor: ele cria um contêiner sem publicar, que some sozinho em até 24h. O app registra o resultado por formato.
- **Legenda e `#`:** a documentação de `INSTAGRAM_POST_IG_USER_MEDIA` pede `#` codificado como `%23`, e o app segue isso (`CAPTION_ENCODE_HASHTAGS=true`). Confira a primeira publicação real. Se aparecer `%23` no lugar de `#`, mude para `false`. No carrossel a legenda vai sem codificação, porque a ferramenta de carrossel não faz essa exigência.
- `follower_count` diário só existe a partir de 100 seguidores (regra da Meta).

## Arquitetura

```
Navegador (HTML/CSS/JS puro, PT-BR, responsivo)
   │ fetch /api/*
Node + Express  (server/)
   ├─ index.js      rotas, autenticação opcional, cabeçalhos de segurança
   ├─ composio.js   lista fixa de ferramentas permitidas; escrita só com confirmação; erros sanitizados
   ├─ publisher.js  prévia → confirmação digitada → fila → contêiner → status → publicação → verificação
   ├─ store.js      data/db.json (gravação atômica): rascunhos, calendário, fila e histórico
   ├─ media.js      valida URL/tipo/tamanho da mídia; upload opcional ao Supabase
   ├─ ai.js         sugestões com Claude (ou gerador local, se não houver chave)
   └─ tz.js         horários em America/Sao_Paulo
```

### Como a publicação evita erros e duplicidade
1. **Prévia**: valida mídia (URL pública, tipo, tamanho), formato, legenda (até 2.200 caracteres e 30 hashtags), conexão e cota.
2. **Confirmação**: você digita `PUBLICAR`, `AGENDAR` ou `TESTAR`. O token vale uma vez, por 10 min, e só para aquele conteúdo exato. Editar o post depois de agendar **desfaz o agendamento**.
3. **Fila**: no horário, o servidor cria o contêiner, espera o Instagram processar (`FINISHED`) e publica. Cada etapa é gravada **antes** da chamada externa.
4. **Verificação**: se a publicação falhar ou der timeout, o app **não tenta de novo sozinho**. Ele consulta o status do contêiner e a lista de posts. Se já publicou, registra como publicado. Se não publicou, marca erro e libera uma nova tentativa, que **reaproveita o mesmo contêiner** (um contêiner só pode ser publicado uma vez).
5. Se o servidor reiniciar no meio de uma publicação, ela vira verificação, nunca republicação. Se o servidor ficou desligado além de `PUBLISH_GRACE_MINUTES` (padrão 6h), o post vira erro "horário perdido" e não é publicado.

Status de publicação: `rascunho` → `agendado` → `publicando` → `publicado` | `erro`.
Status editorial (quadro): `ideia` → `em produção` → `pronto` → `publicado`.

## Como executar

Requisitos: Node.js 20 ou mais novo.

```bash
git clone https://github.com/anselmoaxo/anselmotech-social.git
cd anselmotech-social
npm install
cp .env.example .env     # preencha (veja abaixo)
npm start                # http://127.0.0.1:3000
```

### Variáveis do `.env`
- `COMPOSIO_API_KEY`: chave do projeto no painel do Composio.
- `COMPOSIO_USER_ID`: o *user id* do Composio dono da conexão do Instagram. A tela **Integração** do app mostra se a conexão foi encontrada. Se a conexão que você fez pelo conector do Claude não aparecer no projeto da sua chave, conecte o Instagram nesse projeto pelo painel do Composio.
- `COMPOSIO_INSTAGRAM_ACCOUNT_ID` (opcional): fixa a conta conectada (`ca_...`).
- `COMPOSIO_INSTAGRAM_VERSION` (opcional, recomendado): fixa a versão do toolkit. Sem ela, o app usa a mais recente.
- `ANTHROPIC_API_KEY` (opcional): sugestões com Claude. Sem ela, um gerador local simples entra no lugar, e a interface avisa qual fonte foi usada.
- `APP_PASSWORD`: obrigatória se o app ficar acessível na rede (`HOST` diferente de `127.0.0.1`). O usuário é `anselmo`.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` (opcionais): upload de mídia para um bucket **público**.

### Rodando 24h (para o agendamento funcionar com o PC desligado)
No seu servidor (o mesmo do n8n, por exemplo):

```bash
cp .env.example .env   # preencha e defina APP_PASSWORD
docker compose up -d --build
```

A porta fica só em `127.0.0.1:3000`. Publique-a com HTTPS pelo seu proxy reverso. Os dados ficam em `./data`. Rode **uma única instância**: a fila não foi feita para vários processos ao mesmo tempo.

### Testes
```bash
npm test     # máquina de estados da publicação, com o Composio simulado (nenhuma chamada real)
```

## Segurança
- Chaves só no `.env` (fora do git). Nunca aparecem em respostas da API, logs ou interface; mensagens de erro passam por um filtro que oculta tokens.
- O servidor só chama as ferramentas da lista fixa em `server/composio.js`. Ações de escrita exigem o objeto de confirmação gerado pelo fluxo de prévia.
- Por padrão o app escuta apenas em `127.0.0.1` e se recusa a abrir para a rede sem `APP_PASSWORD`. Há CSP restritiva e fontes servidas localmente.

## Primeiros passos recomendados
1. Abra **Integração** e confira se aparece "Conectado como @anselmo.tech".
2. Crie um post, cole a URL de uma imagem JPEG pública e use **Testar formato** (não publica).
3. Faça a primeira publicação real com **Publicar agora** e confira a legenda no Instagram (`#` x `%23`).
4. Depois disso, use **Agendar** à vontade.
