// Sugestões de conteúdo: legendas, ganchos, CTAs, hashtags e roteiro de Reels.
// Usa Claude (ANTHROPIC_API_KEY) quando configurado; senão, um gerador local simples
// — e a resposta informa claramente qual fonte foi usada.
import Anthropic from '@anthropic-ai/sdk';

const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
let client = null;

export const aiEnabled = () => Boolean(KEY);

const SYSTEM = `Você é estrategista de conteúdo do perfil profissional @anselmo.tech (marca AnselmoTech) no Instagram.
O perfil fala de tecnologia, automação (n8n, Python, APIs), dados e inteligência artificial para profissionais e curiosos.
Tom: claro, acessível, útil, sem jargão desnecessário, sem promessas exageradas, sem clickbait enganoso. Português do Brasil.
Emojis com moderação (no máximo 3 por legenda). Nada de inventar números, estatísticas ou resultados.
Responda SOMENTE com um JSON válido, sem markdown, no formato pedido.`;

function userPrompt({ topic, format, audience, goal, details, caption }) {
  return `Tema: ${topic || '(não informado)'}
Formato: ${format || 'reels'}
Público: ${audience || 'profissionais e pessoas interessadas em tecnologia'}
Objetivo: ${goal || 'educar e gerar engajamento'}
Detalhes/contexto: ${details || '-'}
Legenda atual (se houver, melhore-a): ${caption || '-'}

Gere este JSON:
{
  "ganchos": [5 frases curtas de abertura (até 12 palavras) que prendem a atenção nos 2 primeiros segundos],
  "legendas": [2 legendas completas (até 1200 caracteres cada), com quebra de linha, estrutura: gancho, valor prático em passos ou bullets, fechamento],
  "ctas": [4 chamadas para ação variadas: comentar palavra-chave, salvar, compartilhar, seguir],
  "hashtags": [15 hashtags relevantes em português e inglês, misturando amplas e de nicho, sem o símbolo #],
  "roteiro": ${format === 'reels' || !format ? '[cenas do Reels de 30-45s: objetos {"tempo":"0-3s","fala":"...","tela":"o que aparece / texto na tela"}]' : '[]'}
}`;
}

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('A IA não retornou JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

function sanitizeOut(o) {
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  return {
    ganchos: arr(o.ganchos, 8).map(String),
    legendas: arr(o.legendas, 3).map(String),
    ctas: arr(o.ctas, 6).map(String),
    hashtags: arr(o.hashtags, 30).map((h) => String(h).replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean),
    roteiro: arr(o.roteiro, 12).map((c) => ({ tempo: String(c.tempo || ''), fala: String(c.fala || ''), tela: String(c.tela || '') })),
  };
}

export async function suggest(input) {
  if (!aiEnabled()) return { source: 'modelo-local', ...localSuggest(input) };
  client ||= new Anthropic({ apiKey: KEY });
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt(input) }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { source: 'claude', model: MODEL, ...sanitizeOut(parseJson(text)) };
  } catch (e) {
    const status = e?.status ? ` (HTTP ${e.status})` : '';
    const local = localSuggest(input);
    return { source: 'modelo-local', warning: `A IA (Claude) falhou${status}; mostrando sugestões do gerador local.`, ...local };
  }
}

// ---------------- gerador local (sem IA externa) ----------------
const BASE_TAGS = ['tecnologia', 'automacao', 'inteligenciaartificial', 'ia', 'produtividade', 'anselmotech'];
const TOPIC_TAGS = {
  n8n: ['n8n', 'nocode', 'lowcode', 'workflow', 'automation'],
  python: ['python', 'programacao', 'dev', 'codigo'],
  dados: ['dados', 'engenhariadedados', 'dataengineering', 'sql', 'etl'],
  sql: ['sql', 'postgresql', 'bancodedados', 'dados'],
  ia: ['ai', 'chatgpt', 'claude', 'llm', 'agentesdeia'],
  agente: ['agentesdeia', 'aiagents', 'llm', 'rag'],
  whatsapp: ['whatsapp', 'chatbot', 'atendimento'],
  instagram: ['instagram', 'marketingdigital', 'socialmedia'],
  erp: ['erp', 'gestao', 'sistemas', 'empresas'],
};

function localSuggest({ topic = 'automação', format = 'reels' }) {
  const t = topic.trim() || 'automação';
  const low = t.toLowerCase();
  const extra = Object.entries(TOPIC_TAGS).filter(([k]) => low.includes(k)).flatMap(([, v]) => v);
  const words = low.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 3);
  const hashtags = [...new Set([...extra, ...words, ...BASE_TAGS, 'dicastech', 'carreiraemti', 'aprendatech'])].slice(0, 15);
  return {
    ganchos: [
      `Você ainda faz ${t} no braço?`,
      `${t}: o que ninguém te explica no começo`,
      `3 jeitos práticos de usar ${t} hoje`,
      `O erro mais comum com ${t} (e como evitar)`,
      `Em 30 segundos: ${t} sem complicação`,
    ],
    legendas: [
      `${t} não precisa ser complicado. 👇\n\nNeste ${format === 'carrossel' ? 'carrossel' : 'vídeo'} eu mostro:\n✅ o que é, em uma frase\n✅ onde isso economiza tempo de verdade\n✅ como dar o primeiro passo ainda hoje\n\nSalve para consultar depois e me conta nos comentários: qual parte você quer que eu aprofunde?`,
      `Uma dúvida que sempre aparece: por onde começar com ${t}?\n\nMinha sugestão prática:\n1. Escolha uma tarefa repetitiva do seu dia\n2. Descreva o passo a passo dela\n3. Automatize só uma parte primeiro\n\nPequenas automações somam muito tempo no fim do mês. 🤖`,
    ],
    ctas: [
      'Comente "QUERO" que eu te envio o material no direct.',
      'Salve este post para não perder.',
      'Compartilhe com aquele amigo que vive fazendo tudo manual.',
      'Siga @anselmo.tech para mais conteúdo de automação e IA.',
    ],
    hashtags,
    roteiro: format === 'reels'
      ? [
          { tempo: '0-3s', fala: `Você ainda faz ${t} no braço?`, tela: 'Texto grande com o gancho' },
          { tempo: '3-10s', fala: 'Deixa eu te mostrar o problema em um exemplo real.', tela: 'Tela/print do processo manual' },
          { tempo: '10-25s', fala: 'Agora olha como fica com automação, passo a passo.', tela: 'Gravação de tela da solução' },
          { tempo: '25-35s', fala: 'O ganho: menos tempo repetindo tarefa e menos erro.', tela: 'Antes x depois' },
          { tempo: '35-40s', fala: 'Comenta QUERO que eu te mando o fluxo.', tela: 'CTA + @anselmo.tech' },
        ]
      : [],
  };
}
