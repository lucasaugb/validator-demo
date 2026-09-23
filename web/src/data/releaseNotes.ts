import { isAdminOrAbove, isSupervisorOrAbove, type Role } from '../types'

/**
 * "Novidades": histórico de evoluções do sistema.
 *
 * Conteúdo ESTÁTICO, embutido no build. Não toca Firestore nem BigQuery:
 * custo zero, peso desprezível. A cada release a gente acrescenta uma entrada
 * no topo do array e deploya junto com a mudança (o fluxo já é "mudou → deploya").
 *
 * Visibilidade por papel (`audience`):
 *   - 'todos'         → qualquer usuário, inclusive Gestor (role 'agente').
 *   - 'supervisor'    → Supervisor pra cima (isSupervisorOrAbove).
 *   - 'admin'         → Admin/Super Admin (isAdminOrAbove).
 *   - 'desenvolvedor' → SÓ Super Admin (role 'super_admin'). Use pra mudanças
 *                       que só interessam ao desenvolvedor (versionamento,
 *                       infra, ajustes internos que não mudam nada pro Admin).
 *
 * ⚠️ NUNCA mencionar "Transação", "Sistema de origem" ou "Transações" em NENHUMA nota
 *    (qualquer audiência). Usar "Registro", "operações", "base oficial".
 *    Nas notas 'todos' (que o Gestor vê), seguir também a nomenclatura do
 *    Gestor ("Volume", "Verificado/Inválido") e evitar "comissão".
 */

export type ReleaseAudience = 'todos' | 'supervisor' | 'admin' | 'desenvolvedor'

export type ReleaseCategory =
  | 'recurso' // funcionalidade nova
  | 'melhoria' // aprimoramento de algo existente
  | 'correcao' // correção de comportamento
  | 'visual' // mudança de aparência (cores, logo, layout)
  | 'seguranca' // segurança / acesso
  | 'desempenho' // performance / custo

export interface ReleaseChange {
  category: ReleaseCategory
  text: string
}

export interface ReleaseNote {
  /**
   * Versão da release. Esquema (definido em 2026-06-02):
   *   - 2º numeral (minor) = MARCO grande (ex.: 1.2.0 = nova identidade visual).
   *   - 3º numeral (patch) = cada atualização incremental (1.2.1, 1.2.2 … 1.2.65).
   * Ou seja: o normal é só bumpar o patch a cada deploy; o minor sobe só em
   * mudança grande. Pode repetir entre notas da mesma versão com audiências
   * diferentes (mesmo deploy, públicos distintos).
   */
  version: string
  /** Data ISO (yyyy-mm-dd). A lista é mantida do mais recente pro mais antigo. */
  date: string
  /** Hora local da implementação (HH:mm). Opcional, preenchido a partir de
   *  2026-06-02; notas anteriores mostram só a data. */
  time?: string
  title: string
  audience: ReleaseAudience
  /** Marco importante: recebe destaque visual (estrela + cor accent). */
  highlight?: boolean
  changes: ReleaseChange[]
}

/**
 * Histórico, do mais novo pro mais antigo. Acrescente novas entradas NO TOPO.
 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.3.25',
    date: '2026-08-14',
    time: '00:40',
    title: 'Volume registrado no painel de Performance',
    audience: 'todos',
    changes: [
      {
        category: 'recurso',
        text: 'O painel Performance da Visão geral agora acompanha o Volume registrado, com as mesmas comparações das demais linhas: contra o período anterior e contra o mesmo dia do mês passado.',
      },
      {
        category: 'melhoria',
        text: 'A linha de Inválidos saiu do painel para abrir espaço. Os inválidos seguem na faixa de indicadores acima e na seção própria mais abaixo.',
      },
    ],
  },
  {
    version: '1.3.24',
    date: '2026-08-13',
    time: '00:20',
    title: 'Selos de setor e de perfil CRM redesenhados',
    audience: 'todos',
    changes: [
      {
        category: 'visual',
        text: 'Os selos de setor ganharam ícone próprio e caixa alta compacta, no mesmo desenho dos selos de acesso. Cada setor mantém a sua cor.',
      },
      {
        category: 'melhoria',
        text: 'O selo de perfil do cliente no CRM agora vem marcado como "CRM" e com ícone próprio. Antes ele e o selo de setor mostravam a mesma palavra na mesma linha e se confundiam.',
      },
    ],
  },
  {
    version: '1.3.23',
    date: '2026-08-13',
    time: '23:55',
    title: 'Menu lateral redesenhado',
    audience: 'todos',
    changes: [
      {
        category: 'visual',
        text: 'O menu lateral foi reorganizado: identificação do sistema no topo, faixa com ambiente, versão e data, e seções separadas por linhas finas. O item aberto agora tem uma marca dourada à esquerda.',
      },
      {
        category: 'visual',
        text: 'Cada perfil de acesso ganhou um selo próprio, com ícone e cor. Ficou fácil identificar de relance qual acesso está em uso.',
      },
    ],
  },
  {
    version: '1.3.22',
    date: '2026-08-13',
    time: '23:30',
    title: 'Tela de Registros muito mais rápida',
    audience: 'todos',
    changes: [
      {
        category: 'desempenho',
        text: 'A lista de Registros agora carrega por páginas de 50 linhas, em vez de desenhar todos os registros de uma vez. A tela abre praticamente na hora, mesmo com a base cheia.',
      },
      {
        category: 'melhoria',
        text: 'A busca e os filtros continuam procurando na base inteira. Só a exibição é dividida em páginas, com os números das páginas no rodapé da lista para ir direto a qualquer uma.',
      },
    ],
  },
  {
    version: '1.3.22',
    date: '2026-08-13',
    time: '23:30',
    title: 'Tela de Análises removida',
    audience: 'admin',
    changes: [
      {
        category: 'melhoria',
        text: 'A tela de Análises saiu do menu por baixo uso. Os comparativos entre gestores continuam disponíveis na Visão geral.',
      },
    ],
  },
  {
    version: '1.3.21',
    date: '2026-08-13',
    time: '12:00',
    title: 'Novo visual: barra lateral escura',
    audience: 'todos',
    changes: [
      {
        category: 'visual',
        text: 'A barra lateral agora é um painel escuro fixo, de ponta a ponta, dando ao sistema uma cara mais robusta de plataforma corporativa. O restante do sistema segue com o fundo claro de sempre.',
      },
    ],
  },
  {
    version: '1.3.20',
    date: '2026-07-31',
    time: '11:20',
    title: 'Forecast e Metas agora também por Ativação',
    audience: 'todos',
    highlight: true,
    changes: [
      {
        category: 'recurso',
        text: 'O Forecast da Visão geral ganhou um seletor no topo: Volume ou Ativação. Em Ativação, tudo passa a contar o primeiro registro de cada cliente: acumulado, ritmo do dia, meta diária, meta acumulada, gap e quanto falta por dia útil.',
      },
      {
        category: 'melhoria',
        text: 'O gráfico e o desempenho por time/colaborador seguem o seletor, então dá pra acompanhar as duas metas na mesma tela sem trocar de página.',
      },
    ],
  },
  {
    version: '1.3.20',
    date: '2026-07-31',
    time: '11:20',
    title: 'Metas de ativação por time e por colaborador',
    audience: 'admin',
    changes: [
      {
        category: 'recurso',
        text: 'A tela de Metas ganhou o seletor Volume · Ativação. Em Ativação, a meta é definida em quantidade de ativações: por time, por colaborador e como padrão de todos os meses, com a mesma divisão igualitária, os mesmos ajustes manuais e o mesmo botão de voltar ao padrão.',
      },
      {
        category: 'melhoria',
        text: 'A meta padrão de ativação começa em 300 no total, dividida igualmente entre os 4 times (75 cada). As duas metas ficam guardadas separadamente: mexer numa nunca altera a outra.',
      },
    ],
  },
  {
    version: '1.3.19',
    date: '2026-07-21',
    time: '13:45',
    title: 'Filtro por Perfil CRM nos registros',
    audience: 'supervisor',
    changes: [
      {
        category: 'recurso',
        text: 'A tela de registros agora tem um filtro por Perfil CRM (Premium, Starter ou Não encontrado) ao lado dos filtros de setor e moeda.',
      },
    ],
  },
  {
    version: '1.3.18',
    date: '2026-07-21',
    time: '13:25',
    title: 'Bônus escalonado só a partir de julho/2026',
    audience: 'supervisor',
    changes: [
      {
        category: 'correcao',
        text: 'O bônus de ativação escalonado passa a valer apenas para registros com transação a partir de 01/07/2026. Registros de meses anteriores mantêm o bônus fixo de US$ 5. As competências já fechadas não são recalculadas.',
      },
    ],
  },
  {
    version: '1.3.17',
    date: '2026-07-21',
    time: '13:05',
    title: 'Detalhamento da comissão no tooltip',
    audience: 'supervisor',
    changes: [
      {
        category: 'melhoria',
        text: 'Na coluna de comissão da tabela, um ícone de informação (ⓘ) mostra o detalhamento daquele registro (tipo, valor do bônus e por que (dias na Premium/Starter), 1% e total) conforme as regras de comissionamento.',
      },
    ],
  },
  {
    version: '1.3.16',
    date: '2026-07-21',
    time: '12:45',
    title: 'Bônus de ativação escalonado por tempo na Premium/Starter',
    audience: 'supervisor',
    changes: [
      {
        category: 'recurso',
        text: 'O bônus por ativação deixou de ser fixo em US$ 5 e passa a variar conforme quantos dias o cliente já estava na Premium/Starter quando fez a transação: até 7 dias US$ 10, de 8 a 15 dias US$ 7,50, de 16 a 30 dias US$ 6, acima de 30 dias (ou fora do CRM) US$ 5.',
      },
      {
        category: 'melhoria',
        text: 'O detalhe do registro mostra o valor do bônus e há quantos dias o cliente estava na Premium/Starter. O 1% sobre o volume e as regras de elegibilidade continuam iguais.',
      },
    ],
  },
  {
    version: '1.3.15',
    date: '2026-07-21',
    time: '12:15',
    title: 'Perfil CRM restrito a Supervisor+',
    audience: 'supervisor',
    changes: [
      {
        category: 'seguranca',
        text: 'O Perfil CRM do cliente (Premium/Starter, data de entrada e etapa no Pipedrive) passa a aparecer apenas para Supervisor, Admin e Super Admin: o gestor não vê.',
      },
    ],
  },
  {
    version: '1.3.14',
    date: '2026-07-21',
    time: '11:58',
    title: 'Perfil CRM: data de entrada e etapa',
    audience: 'supervisor',
    changes: [
      {
        category: 'melhoria',
        text: 'O perfil do cliente agora mostra também a data em que ele entrou (Premium/Starter) e a etapa em que está no CRM (ex.: Bloqueado, Cancelado, Contrato Ok). Quando a etapa está vazia, aparece a origem.',
      },
    ],
  },
  {
    version: '1.3.13',
    date: '2026-07-21',
    time: '11:20',
    title: 'Perfil Premium/Starter do cliente no registro',
    audience: 'supervisor',
    changes: [
      {
        category: 'recurso',
        text: 'Cada registro agora exibe o perfil do cliente (Premium, Starter ou Não encontrado) cruzando o email ou o telefone com a base do CRM.',
      },
      {
        category: 'melhoria',
        text: 'O perfil também aparece no detalhe do registro (campo "Perfil CRM"), indicando se o match veio por email ou telefone.',
      },
    ],
  },
  {
    version: '1.3.11',
    date: '2026-07-20',
    time: '19:20',
    title: '"Meu time" no forecast: só a meta do time, enxuto',
    audience: 'todos',
    changes: [
      {
        category: 'melhoria',
        text: 'No forecast, o modo "Meu time" agora mostra de forma direta como está a meta do time que você pertence: volume acumulado do time × meta e o % atingido. Sem cartões vazios e sem nenhum dado individual de outros colegas.',
      },
    ],
  },
  {
    version: '1.3.10',
    date: '2026-07-20',
    time: '19:00',
    title: 'Meta do time no forecast do colaborador atualiza na hora',
    audience: 'admin',
    changes: [
      {
        category: 'correcao',
        text: 'Quando uma meta era alterada na tela de Metas, o forecast "Meu time" do colaborador continuava mostrando o valor antigo da meta até alguém reabrir a Visão Geral (ele lê a meta do time de um cache). Agora a tela de Metas propaga a meta efetiva pro cache assim que ela muda, então o colaborador vê o valor novo imediatamente. O escopo "Meu" já refletia na hora (calcula ao vivo).',
      },
    ],
  },
  {
    version: '1.3.9',
    date: '2026-07-20',
    time: '18:30',
    title: 'Forecast: % da meta agora em destaque',
    audience: 'admin',
    changes: [
      {
        category: 'melhoria',
        text: 'O percentual atingido da meta agora aparece grande e legível logo acima da barra de progresso, tanto no Forecast da Visão geral quanto no gráfico Realizado × Meta da tela de Metas. Antes o número ficava embutido dentro da barra e quase não dava pra enxergar.',
      },
    ],
  },
  {
    version: '1.3.8',
    date: '2026-07-20',
    time: '18:00',
    title: 'Gráfico da tela Metas no mesmo estilo do Forecast',
    audience: 'admin',
    changes: [
      {
        category: 'visual',
        text: 'O gráfico Realizado × Meta da tela Metas agora usa o mesmo visual do Forecast da Visão geral no modo Dia: barras com o volume validado acumulado dia a dia e a linha da meta acumulada (sábado e domingo sem meta). A tela abre já nesse modo; o modo Mês (histórico dos últimos 12 meses) continua disponível no botão.',
      },
    ],
  },
  {
    version: '1.3.7',
    date: '2026-07-20',
    time: '17:30',
    title: 'Cards de ritmo também na tela Metas',
    audience: 'admin',
    changes: [
      {
        category: 'melhoria',
        text: 'A tela Metas ganhou os mesmos cards de ritmo do Forecast da Visão geral, logo acima do gráfico Realizado × Meta: volume acumulado × meta, volume no dia, meta diária, meta acumulada até hoje, gap em relação à meta acumulada e quanto ainda precisa por dia útil. Mais a barra de % de atingimento. Os cards seguem o escopo selecionado (geral, time ou colaborador) e o mês navegado.',
      },
    ],
  },
  {
    version: '1.3.6',
    date: '2026-07-20',
    time: '17:00',
    title: 'Forecast repaginado: ritmo diário e Realizado × Meta',
    audience: 'todos',
    changes: [
      {
        category: 'visual',
        text: 'O Forecast da Visão geral foi repaginado. No topo, cards com o ritmo do mês: volume acumulado × meta, volume no dia, meta diária, meta acumulada até hoje, gap em relação à meta acumulada e quanto ainda precisa por dia útil. Mais uma barra com o % de atingimento.',
      },
      {
        category: 'recurso',
        text: 'Novo gráfico Realizado × Meta acumulada: as barras mostram o volume validado acumulado dia a dia e a linha mostra a meta acumulada. Sábado e domingo não têm meta (a meta só cresce em dia útil).',
      },
      {
        category: 'melhoria',
        text: 'A linha de "projeção" foi removida do Forecast. O foco agora é comparar o realizado com a meta e com o ritmo esperado até hoje.',
      },
    ],
  },
  {
    version: '1.3.5',
    date: '2026-07-13',
    time: '10:00',
    title: 'Forecast na Visão geral',
    audience: 'todos',
    changes: [
      {
        category: 'recurso',
        text: 'A Visão geral agora tem um Forecast: a projeção de quanto o seu volume validado deve fechar no mês (pelo ritmo dos dias úteis, seg-sex. Fim de semana não conta), comparada com a meta. Você acompanha o realizado, a projeção de fechamento e o % de atingimento, com uma explicação de como o valor foi calculado (já validado ÷ dias úteis = ritmo por dia × dias úteis do mês → projeção, e quanto falta pra meta). Dá pra alternar entre "Meu" (individual) e "Meu time".',
      },
    ],
  },
  {
    version: '1.3.5',
    date: '2026-07-13',
    time: '10:00',
    title: 'Forecast e Metas por time e colaborador',
    audience: 'admin',
    highlight: true,
    changes: [
      {
        category: 'recurso',
        text: 'A Visão geral ganhou um painel de Forecast com filtro Geral · Time · Colaborador (supervisor vê só os times do seu escopo). Mostra meta, volume validado realizado, projeção de fechamento (ritmo por dias úteis, seg-sex) e % de atingimento, com detalhamento por time e por colaborador.',
      },
      {
        category: 'recurso',
        text: 'Nova tela "Metas" (para usuários autorizados): permite definir a meta geral, por time e por colaborador, mês a mês. A meta do time é dividida igualitariamente entre os colaboradores (colaborador novo entra só no mês seguinte). Ao ajustar a meta de um colaborador, a diferença sobe automaticamente para a meta do time e para a meta geral.',
      },
      {
        category: 'recurso',
        text: 'A tela de Metas ganhou um gráfico Realizado × Meta com filtro de granularidade (por mês (últimos 12) ou por dia. Acumulado vs ritmo da meta no mês) e de escopo (geral, time ou colaborador). As barras/linhas mudam de cor conforme o atingimento (verde/âmbar/vermelho).',
      },
    ],
  },
  {
    version: '1.3.5',
    date: '2026-07-13',
    time: '10:00',
    title: 'Infra de Metas/Forecast',
    audience: 'desenvolvedor',
    changes: [
      {
        category: 'recurso',
        text: 'Metas em nova coleção `metas` (baseline `default` + overrides por mês); base = volume validado USD. Meta do time/geral é rolled-up = soma das metas individuais (base + ajustes). Forecast = (validado ÷ dias úteis decorridos) × dias úteis do mês. Acesso de edição via capability `canEditMetas` (só super_admin concede/revoga; super_admin sempre pode).',
      },
      {
        category: 'recurso',
        text: 'Rollup `metas_rollup/{yyyy-MM}` (realizado + nº elegíveis + meta efetiva por setor) mantido pelos dashboards de supervisor+ para o forecast "meu time" do colaborador: só agregados, sem PII e sem meta individual de colega, respeitando o silo de dados do agente.',
      },
    ],
  },
  {
    version: '1.3.4',
    date: '2026-07-08',
    time: '12:00',
    title: 'Busca por nome, e-mail ou telefone nos seus registros',
    audience: 'todos',
    changes: [
      {
        category: 'recurso',
        text: 'A tela "Meus registros" ganhou uma barra de busca: digite o nome, o e-mail ou o telefone do cliente e a lista filtra na hora. Também dá pra procurar direto pelo número do registro (ex.: "#123"). Funciona junto com o filtro de mês e de moeda.',
      },
    ],
  },
  {
    version: '1.3.3',
    date: '2026-06-29',
    time: '15:00',
    title: 'Notificações que de fato somem ao serem vistas',
    audience: 'todos',
    changes: [
      {
        category: 'correcao',
        text: 'O número vermelho do sininho agora zera de verdade quando você abre as notificações. Antes ele ficava preso enquanto houvesse uma pendência aberta, mesmo depois de você já ter visto tudo.',
      },
      {
        category: 'melhoria',
        text: 'O contador só volta a aparecer quando surge algo NOVO que você ainda não viu. Pendências que continuam abertas seguem na lista, mas não inflam mais o contador. Cada usuário tem sua própria marcação de "já visto", preservada entre acessos.',
      },
    ],
  },
  {
    version: '1.3.3',
    date: '2026-06-29',
    time: '15:00',
    title: 'Análises muito mais completa: operação, meses e setores',
    audience: 'supervisor',
    highlight: true,
    changes: [
      {
        category: 'recurso',
        text: 'Novo "Panorama geral" no topo: Registros, Validados, Ativações, Comissão e Volume validado do período, cada um com a variação vs o período anterior. Mais uma faixa com o acumulado do ano.',
      },
      {
        category: 'recurso',
        text: '"Insights da operação": leituras automáticas sobre o todo (não só sobre gestores): recorde histórico de registros num dia, melhor mês em validados, projeção de fechamento do mês no ritmo atual, setor líder, peso das ativações e dia da semana mais movimentado.',
      },
      {
        category: 'recurso',
        text: 'Gráfico "Evolução mensal" cobrindo os últimos 12 meses, alternando entre Registros, Validados, Ativações, Comissão e Volume: o mês recorde fica destacado.',
      },
      {
        category: 'recurso',
        text: 'Nova tabela "Comparativo entre setores": Registros, Validados, Ativações e Comissão por setor, com o crescimento de cada um vs o período anterior.',
      },
    ],
  },
  {
    version: '1.3.2',
    date: '2026-06-18',
    time: '12:12',
    title: 'Novo setor combinado "Online/Eventos"',
    audience: 'admin',
    changes: [
      {
        category: 'recurso',
        text: 'Agora existe o setor combinado "Online/Eventos", nos mesmos moldes do "Premium/Starter": é atribuível apenas a um Supervisor, que passa a enxergar e gerenciar os dois setores (Online e Eventos) de uma vez. Os gestores continuam em um setor individual. O novo setor aparece nas tags, filtros e no fechamento de competência.',
      },
    ],
  },
  {
    version: '1.3.1',
    date: '2026-06-18',
    time: '11:47',
    title: 'Análises redesenhada: mais BI, menos repetição',
    audience: 'supervisor',
    changes: [
      {
        category: 'melhoria',
        text: 'A tela "Análises" foi repensada pra ter cara de BI e não repetir a Visão Geral. Saíram os KPIs e cards que já existiam lá; o visual ficou mais sóbrio (menos cores).',
      },
      {
        category: 'recurso',
        text: 'Novo gráfico de linhas "Evolução por gestor": compara a trajetória dos gestores ao longo do tempo (com as linhas se cruzando), alternando entre Validados, Ativações e Volume validado.',
      },
      {
        category: 'recurso',
        text: 'Os "Destaques comparativos" agora são mais abrangentes: líder em validados, top em ativações, melhor conversão, maior ticket, maior crescimento e maior queda em comissão, mais atenção e distribuição vs a média.',
      },
      {
        category: 'recurso',
        text: 'A tabela "Comparativo entre gestores" lista TODOS os gestores (não só o top), com validados/ativações/conversão/inválidos/comissão e a coluna de crescimento vs o período anterior, ordenável por qualquer coluna.',
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-06-18',
    time: '11:35',
    title: 'Nova tela "Análises"',
    audience: 'supervisor',
    highlight: true,
    changes: [
      {
        category: 'recurso',
        text: 'Estreia da tela "Análises" no menu lateral (grupo Análise), dedicada a comparar gestores. O Supervisor vê apenas o próprio setor e o olhinho de ocultar valores também vale aqui. (Layout detalhado na atualização seguinte.)',
      },
    ],
  },
  {
    version: '1.2.12',
    date: '2026-06-18',
    time: '10:58',
    title: 'Performance mostra valor atual vs anterior + a variação',
    audience: 'admin',
    changes: [
      {
        category: 'melhoria',
        text: 'No painel "Performance", cada coluna (Mês e vs mesmo dia do mês anterior) voltou a exibir o valor atual ao lado do valor de comparação ("12 vs 10") junto com a variação em %. Antes, na versão compacta, o valor anterior tinha sumido e só aparecia a porcentagem.',
      },
    ],
  },
  {
    version: '1.2.11',
    date: '2026-06-18',
    time: '10:50',
    title: 'Comissões Pendentes: "Aguardando 1ª op." volta a contar certo',
    audience: 'admin',
    changes: [
      {
        category: 'correcao',
        text: 'Na tela "Comissões Pendentes", o indicador "Aguardando 1ª op." aparecia como 0 mesmo havendo ativações verificadas cujo cliente ainda não operou. Agora essas ativações (registradas como "sem operação ainda" pela base) são contadas corretamente em "Aguardando 1ª op." e no valor de 1% represado. O "1% não elegível" passa a listar só os casos genuínos. Clientes que já operavam antes do registro. O encerramento de competência (Fechamento) não foi afetado.',
      },
    ],
  },
  {
    version: '1.2.10',
    date: '2026-06-18',
    time: '10:48',
    title: 'Painel Performance mais compacto',
    audience: 'admin',
    changes: [
      {
        category: 'melhoria',
        text: 'O painel "Performance" da Visão Geral ficou compacto: cada indicador agora ocupa uma única linha com as colunas "Mês" e "vs mesmo dia do mês anterior" lado a lado. Assim o painel volta a ter altura parecida com o gráfico "Registros por dia" ao lado e some o espaço em branco que sobrava embaixo dele. Em telas estreitas, a tabela rola na horizontal.',
      },
    ],
  },
  {
    version: '1.2.9',
    date: '2026-06-18',
    time: '10:36',
    title: 'Comparativo do dia em coluna e olhinho ocultando toda a comissão',
    audience: 'admin',
    changes: [
      {
        category: 'melhoria',
        text: 'No painel "Performance" da Visão Geral, o comparativo "vs mesmo dia do mês anterior" agora fica em uma coluna ao lado do comparativo do mês (não mais abaixo). Isso deixa o painel mais baixo e elimina o espaço em branco que sobrava no gráfico "Registros por dia" ao lado.',
      },
      {
        category: 'correcao',
        text: 'O botão de ocultar valores sensíveis (olhinho) agora esconde TODOS os valores de comissão da tela. Incluindo a tabela "Comissão por setor", a coluna Comissão do comparativo entre gestores e o gráfico histórico de comissão (eixo e tooltip). Antes alguns desses valores continuavam visíveis mesmo com o olhinho ativado.',
      },
    ],
  },
  {
    version: '1.2.8',
    date: '2026-06-18',
    time: '10:21',
    title: 'Performance compara o dia com o mês anterior e Equipe sinaliza quem parou de registrar',
    audience: 'admin',
    changes: [
      {
        category: 'recurso',
        text: 'No painel "Performance" da Visão Geral, cada indicador (Registros, Validados, Ativações, Inválidos) agora mostra, além da comparação do mês inteiro, o comparativo "vs mesmo dia do mês anterior". Por exemplo, hoje (18/06) contra o mesmo dia do mês passado (18/05).',
      },
      {
        category: 'recurso',
        text: 'Nos destaques da seção "Equipe" entra um aviso de inatividade: aponta o gestor ativo que está há mais dias sem nenhum registro (validado ou não), para a equipe perceber rápido quem parou e entender o motivo. O card leva direto aos registros do gestor.',
      },
    ],
  },
  {
    version: '1.2.7',
    date: '2026-06-17',
    time: '20:40',
    title: 'Filtro "Aguard. 1ª op." corrigido e tabela de Registros mais compacta',
    audience: 'admin',
    changes: [
      {
        category: 'correcao',
        text: 'O filtro "Aguard. 1ª op." não retornava nada. Ele agora lista corretamente as ativações verificadas cujo 1% ainda não foi liberado porque o cliente não operou após ativar. O mesmo conjunto que o sistema re-checa automaticamente todo dia para liberar quando a operação acontecer.',
      },
      {
        category: 'melhoria',
        text: 'A tabela de Registros foi compactada (espaçamentos, miniaturas de comprovante e largura das colunas) para caber melhor na tela e reduzir a rolagem horizontal. O comportamento agora é igual com "Todos os gestores" ou filtrando um gestor específico.',
      },
    ],
  },
  {
    version: '1.2.6',
    date: '2026-06-10',
    time: '00:00',
    title: 'Supervisor identificado no Log de atividade',
    audience: 'admin',
    changes: [
      {
        category: 'correcao',
        text: 'No Log de atividade, ações feitas por um Supervisor apareciam com a tag "Gestor". Agora o Supervisor tem sua própria etiqueta (em teal), assim como Admin e Super Admin, deixando claro quem executou cada ação.',
      },
    ],
  },
  {
    version: '1.2.5',
    date: '2026-06-02',
    time: '19:39',
    title: 'Alertas para gestão e ajuste em Comissões Pendentes',
    audience: 'supervisor',
    changes: [
      {
        category: 'recurso',
        text: 'O sino de notificações de Supervisor, Admin e Super Admin agora mostra alertas que ficam abertos enquanto o problema existir: registro duplicado e agente com 3 ou mais registros invalidados pelo sistema. Antes esses alertas só apareciam para o Supervisor. Agora a gestão toda é avisada, mesmo que a situação tenha sido detectada fora do horário em que você estava no sistema.',
      },
      {
        category: 'melhoria',
        text: 'Para evitar aviso em dobro, duplicidade e excesso de pedidos de edição deixaram de aparecer como evento avulso para Admin/Super Admin e passaram a contar só como alerta aberto.',
      },
      {
        category: 'correcao',
        text: 'Em Comissões Pendentes, o botão "Concluído" agora fica desabilitado nos registros "Não elegíveis". Como o 1% nunca cai em mês nenhum, não há pagamento a concluir.',
      },
      {
        category: 'visual',
        text: 'O botão "Concluído" em Comissões Pendentes ganhou cor mais forte (verde), antes estava apagado demais.',
      },
    ],
  },
  {
    version: '1.2.4',
    date: '2026-06-02',
    time: '11:50',
    title: 'Ajuste no versionamento',
    audience: 'desenvolvedor',
    changes: [
      {
        category: 'melhoria',
        text: 'Numeração de versão mais enxuta: cada atualização incremental sobe só o último número (1.2.1, 1.2.2 …) e o número do meio sobe só em mudanças grandes. Por isso a versão no rodapé passou de 1.6.0 para 1.2.x.',
      },
      {
        category: 'melhoria',
        text: 'As notas de atualização agora mostram também a hora da implementação.',
      },
      {
        category: 'melhoria',
        text: 'Novo público "Desenvolvedor" nas notas: mudanças que só interessam ao desenvolvedor aparecem apenas para o Super Admin, sem poluir a visão do Admin.',
      },
    ],
  },
  {
    version: '1.2.3',
    date: '2026-06-02',
    time: '11:47',
    title: 'Notificações mais úteis',
    audience: 'todos',
    changes: [
      {
        category: 'melhoria',
        text: 'Você passa a ser avisado quando um registro fica totalmente verificado (o aviso aparece uma vez).',
      },
      {
        category: 'melhoria',
        text: 'O aviso de conversa que precisa de ajuste fica destacado no sino até a conversa ser resolvida.',
      },
    ],
  },
  {
    version: '1.2.3',
    date: '2026-06-02',
    time: '11:47',
    title: 'Central de alertas da Supervisão',
    audience: 'supervisor',
    changes: [
      {
        category: 'recurso',
        text: 'O sino da Supervisão passa a mostrar exclusivamente alertas do seu setor: registros duplicados (em tempo real, do mesmo gestor ou entre gestores), gestores com mais de 2 registros invalidados pela base oficial e registros com 3 ou mais pedidos de edição.',
      },
    ],
  },
  {
    version: '1.2.3',
    date: '2026-06-02',
    time: '11:47',
    title: 'Fechamento mais limpo',
    audience: 'admin',
    changes: [
      {
        category: 'melhoria',
        text: 'Na tela de Fechamento, os extratos por gestor agora começam recolhidos. Use "Expandir todos" para abrir todos de uma vez.',
      },
    ],
  },
  {
    version: '1.2.2',
    date: '2026-06-02',
    time: '10:30',
    title: 'Filtro por mês de pagamento em Comissões Pendentes',
    audience: 'supervisor',
    changes: [
      {
        category: 'recurso',
        text: 'Novo filtro "Mês pagamento operação": mostra apenas os registros cujo 1% após a operação será pago no mês escolhido (mês da primeira operação do cliente).',
      },
    ],
  },
  {
    version: '1.2.1',
    date: '2026-06-02',
    time: '09:50',
    title: 'Controle de pagamento em Comissões Pendentes',
    audience: 'supervisor',
    changes: [
      {
        category: 'recurso',
        text: 'Botão "Concluído" em cada linha de Comissões Pendentes para marcar que o pagamento (1% + ativação) já foi feito. A linha fica riscada, deixando claro o que já foi quitado.',
      },
      {
        category: 'recurso',
        text: 'Filtro entre "Concluídos" e "Não concluídos", para acompanhar rapidamente o que falta pagar.',
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-05-30',
    title: 'Nova identidade visual',
    audience: 'todos',
    highlight: true,
    changes: [
      {
        category: 'visual',
        text: 'Nova paleta de cores e logotipo do sistema, com visual mais moderno e consistente.',
      },
      {
        category: 'visual',
        text: 'Modos claro e escuro refinados para melhor leitura em qualquer ambiente.',
      },
    ],
  },
  {
    version: '1.1.2',
    date: '2026-05-29',
    title: 'Rankings de desempenho',
    audience: 'admin',
    changes: [
      {
        category: 'recurso',
        text: 'Top clientes e top gestores na Visão Geral, ordenados pelo valor verificado em dólar (USD).',
      },
      {
        category: 'melhoria',
        text: 'Botão "ver tudo" abre a lista completa em uma tabela, sem trocar de tela.',
      },
    ],
  },
  {
    version: '1.1.1',
    date: '2026-05-29',
    title: 'Identificação por setor',
    audience: 'supervisor',
    changes: [
      {
        category: 'melhoria',
        text: 'Cada setor passa a ter cor própria nas tabelas e etiquetas, tornando a leitura mais rápida.',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-05-27',
    title: 'Segurança e resiliência',
    audience: 'admin',
    changes: [
      {
        category: 'seguranca',
        text: 'Reforço de segurança no acesso às funções de servidor (controle de origem e cabeçalhos de proteção).',
      },
      {
        category: 'melhoria',
        text: 'Backup automático da base a cada hora, com retenção de 90 dias.',
      },
      {
        category: 'desempenho',
        text: 'Otimização de custo nas rotinas de verificação automática.',
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-05-26',
    title: 'Lançamento oficial',
    audience: 'todos',
    highlight: true,
    changes: [
      {
        category: 'recurso',
        text: 'Sistema disponível em produção para registro e acompanhamento das operações.',
      },
      {
        category: 'seguranca',
        text: 'No primeiro acesso, o sistema solicita a troca da senha inicial.',
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-05-25',
    title: 'Importação em lote',
    audience: 'todos',
    changes: [
      {
        category: 'recurso',
        text: 'Importação de planilha (.xlsx) para registrar várias linhas de uma só vez.',
      },
      {
        category: 'recurso',
        text: 'Anexo de comprovante direto na linha, para registros importados sem documento.',
      },
      {
        category: 'melhoria',
        text: 'Padronização de termos na interface (Registro, Volume, Verificado, Inválido).',
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-05-18',
    title: 'Notificações e observações',
    audience: 'todos',
    changes: [
      {
        category: 'recurso',
        text: 'Central de notificações (sino) avisa quando um registro é verificado ou marcado como inválido.',
      },
      {
        category: 'melhoria',
        text: 'Observações da administração passam a aparecer destacadas na linha do registro.',
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-05-18',
    title: 'Comissões por período',
    audience: 'admin',
    changes: [
      {
        category: 'recurso',
        text: 'Tela de comissões pendentes, com apuração no mês da primeira operação do cliente.',
      },
      {
        category: 'recurso',
        text: 'Fechamento de competência por mês e setor.',
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-05-16',
    title: 'Controle de edições',
    audience: 'admin',
    changes: [
      {
        category: 'recurso',
        text: 'Fluxo de edição com aprovação e alerta automático quando um mesmo registro é editado três vezes ou mais.',
      },
      {
        category: 'recurso',
        text: 'Registro de auditoria (log de atividade) unificado.',
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-05-15',
    title: 'Papel de Supervisor',
    audience: 'supervisor',
    changes: [
      {
        category: 'recurso',
        text: 'Novo papel de Supervisor, com visão e gestão restritas ao próprio setor.',
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-05-12',
    title: 'Conversão de moeda',
    audience: 'admin',
    changes: [
      {
        category: 'recurso',
        text: 'Conversão automática para dólar (USD) pela cotação oficial do dia do registro.',
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-05-11',
    title: 'Verificação automática',
    audience: 'todos',
    changes: [
      {
        category: 'recurso',
        text: 'Verificação automática dos registros por cruzamento com a base oficial.',
      },
      {
        category: 'melhoria',
        text: 'Cada registro passa a exibir claramente seu status: pendente, verificado ou inválido.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-05-10',
    title: 'Primeira versão',
    audience: 'todos',
    highlight: true,
    changes: [
      {
        category: 'recurso',
        text: 'Registro de operações com anexo de comprovante e acompanhamento de status.',
      },
    ],
  },
]

/* ----------------------------- visibilidade ----------------------------- */

function canSee(audience: ReleaseAudience, role: Role | undefined): boolean {
  if (audience === 'todos') return true
  if (audience === 'supervisor') return isSupervisorOrAbove(role)
  if (audience === 'desenvolvedor') return role === 'super_admin'
  return isAdminOrAbove(role) // 'admin'
}

/** Notas visíveis pro papel informado, já na ordem mais recente → mais antiga. */
export function visibleReleaseNotes(role: Role | undefined): ReleaseNote[] {
  return RELEASE_NOTES.filter((n) => canSee(n.audience, role))
}

/* ------------------------------ "visto" --------------------------------- */
/**
 * Contagem de não-lidas, no mesmo espírito do sininho: client-side, sem backend.
 * Guardamos por uid o NÚMERO de notas visíveis que o usuário já viu. Como a lista
 * só cresce no topo, não-lidas = visíveis - vistas. Robusto a notas na mesma data
 * (diferente de comparar por data) e dispensa armazenar ids.
 */

const SEEN_KEY_PREFIX = 'validator:relnotes-seen:'
/** Evento de janela disparado ao marcar como visto, pro badge do nav atualizar na hora. */
export const RELEASE_NOTES_SEEN_EVENT = 'validator:relnotes-seen'

export function getSeenCount(uid: string): number {
  try {
    const raw = localStorage.getItem(SEEN_KEY_PREFIX + uid)
    const n = raw ? parseInt(raw, 10) : 0
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function unreadReleaseNotesCount(
  role: Role | undefined,
  uid: string | undefined,
): number {
  if (!uid) return 0
  return Math.max(0, visibleReleaseNotes(role).length - getSeenCount(uid))
}

/** Marca todas as notas visíveis como lidas e avisa o nav. */
export function markReleaseNotesSeen(role: Role | undefined, uid: string): void {
  try {
    localStorage.setItem(SEEN_KEY_PREFIX + uid, String(visibleReleaseNotes(role).length))
    window.dispatchEvent(new Event(RELEASE_NOTES_SEEN_EVENT))
  } catch {
    /* localStorage indisponível: segue sem badge, sem quebrar */
  }
}
