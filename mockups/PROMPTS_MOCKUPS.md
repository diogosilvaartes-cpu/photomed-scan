# Prompts dos mockups visuais — Farmácia Vital

Gerados com **Nano Banana Pro** (Google) via Higgsfield, 16:9 a 2K, 2 créditos por imagem.
Também funcionam colados direto no Gemini, anexando o print correspondente.

**Regra de uso:** sempre anexar o print da tela atual como imagem de referência.
Sem o print, o modelo inventa o layout.

Prints originais em: `C:\Users\ddiog\Pictures\Screenshots\prints farma\`

| # | Tela | Print de referência | Status |
|---|------|---------------------|--------|
| 1 | Dashboard | `...111641.png` | ✅ gerado — `01_dashboard.png` |
| 2 | Entregas (mobile) | `...110943.png` | pendente |
| 3 | Pedidos (Kanban) | `...111617.png` | pendente |
| 4 | Clientes | `...111018.png` | pendente |
| 5 | Estoque | `...111601.png` | pendente |
| 6 | Login | `...111032.png` | pendente |

A partir da tela 2, anexar TAMBÉM a imagem da tela 1 aprovada como segunda
referência de estilo, com a instrução: "use a segunda imagem como referência de
estilo visual e aplique na primeira". É o que mantém as seis telas coerentes.

---

## BLOCO A — identidade (colar no início de todos os prompts)

```
Redesenhe esta interface web mantendo EXATAMENTE o mesmo layout, a mesma
estrutura de blocos e os mesmos textos em português. Mude apenas o estilo
visual. Não invente funcionalidades, não remova nem adicione seções.

IDENTIDADE VISUAL A APLICAR:
- Produto: "Farmácia Vital — Painel Operacional", software de gestão de uma
  farmácia de bairro. Usado o dia inteiro por quem está no balcão.
- Sensação: clínico, confiável, moderno e caloroso. Ferramenta de trabalho
  profissional — não é landing page. Sem gradiente chamativo, sem
  glassmorphism, sem sombra dramática.
- Paleta:
  primário verde-clínico profundo #0D6E6E
  fundo off-white #F7F9F8, cards brancos puros
  texto principal azul-tinta #0B1F2A, texto auxiliar cinza-azulado #5A6B76
  valores em dinheiro sempre em verde #16A34A e em destaque
  atenção/aviso âmbar #F59E0B
  perigo/cancelado coral #E5484D
  em trânsito/na rua violeta #7C5CFF
  novo/entrada azul #3B82F6
- Tipografia: títulos em Bricolage Grotesque ExtraBold, com peso e presença;
  interface e tabelas em Inter; números grandes, tabulares e muito legíveis.
- Formas: cantos arredondados de 12px, sombras suaves e curtas, bordas de 1px
  em cinza claro, respiro generoso entre os blocos.
- Ícones: traço fino e coerente, estilo Lucide. NENHUM emoji em lugar algum.
- Status sempre indicado por cor + ícone + rótulo juntos, nunca só por cor.
  As pastilhas de status usam FUNDO SUAVE (a cor a ~10% de opacidade) com
  ícone, rótulo e número na cor forte — nunca fundo sólido saturado.
- O ícone de uma linha deve SEMPRE corresponder ao status dela. Nunca use um
  ícone de check em um item cujo status é "Novos".
- Alto contraste, legível sob luz forte.
```

---

## 1. Dashboard — print `...111641.png`

```
[BLOCO A]

A TELA: dashboard do administrador, desktop, proporção 16:9.

Sidebar fixa à esquerda com 256px, em tom escuro profundo derivado do
verde-clínico:
- No topo, o símbolo da marca "Farmácia Vital": um monograma geométrico
  simples — uma cruz farmacêutica combinada com uma folha — dentro de um
  quadrado arredondado, legível a 24px. Ao lado, "Farmácia Vital" e abaixo,
  menor, "Painel Operacional".
- Itens de menu com ícone e rótulo: Dashboard, Scan, Estoque, Pedidos,
  Clientes. "Dashboard" é o item ativo e deve ter destaque claro.
- No rodapé, bloco do usuário: "Admin", o e-mail em texto pequeno truncado e
  um ícone de sair.

Conteúdo principal:
- Título "Dashboard" e subtítulo "Segunda-feira, 03 de agosto".
- Quatro cards de métrica lado a lado, TODOS com a mesma estrutura interna e
  o mesmo alinhamento: ícone no topo, rótulo pequeno, número GRANDE embaixo.
  "Pedidos hoje 0" · "Em andamento 5" · "Faturado hoje R$ 0,00" ·
  "Total faturado R$ 71" (com "todos os tempos" em texto menor).
  Valor em dinheiro em verde só quando for maior que zero; R$ 0,00 fica em
  cinza neutro.
- Faixa "STATUS ATUAL" com cinco pastilhas de fundo suave, cada uma com ícone
  de linha, rótulo e contador na sua cor:
  Novos 3 (azul) · Separação 0 (âmbar) · Na rua 2 (violeta) ·
  Entregues 5 (verde) · Cancelados 8 (coral).
- Seção "ÚLTIMOS PEDIDOS": lista de linhas, cada uma com ícone do status à
  esquerda (coerente com o badge da direita), nome do cliente, data e hora em
  texto pequeno, valor à direita em verde e o badge de status colorido.
  Clientes: Santos e Silva, Diogo Silva #Mataruna, Luh Oliver.
- Use o verde-clínico primário também no conteúdo principal, não só na
  sidebar: em títulos de seção, ícones e detalhes.

Remova o padrão xadrez cinza do fundo da versão atual — parece um bug.
Use um fundo off-white liso e limpo.
```

---

## 2. Entregas (mobile do entregador) — print `...110943.png` ⭐

```
[BLOCO A]

ESTA É A TELA MAIS IMPORTANTE: usada por um entregador de moto, na rua, sob
sol forte, com uma mão só. Priorize contraste altíssimo, tipografia grande e
alvos de toque generosos.

Mockup de celular na vertical (proporção 9:16), tela cheia, sem sidebar.
Topo: "Entregas", subtítulo "Olá, Diogo — 1 entrega pendente", indicador de
atualização automática. Data "Quinta-feira, 26/03/2026".

Card da entrega, com hierarquia forte:
- Nome "Diogo Silva #Mataruna" e horário; à direita, "A receber" e "R$ 9,90"
  em verde, grande e imediatamente visível.
- Faixa de observação em âmbar com ícone de alerta:
  "Obs: SEMPRE LIGAR NO WPP ANTES DE BUZINAR" — precisa saltar aos olhos.
- Endereço com ícone de pino: "R. Lamas Rabelos 07 - Pq Mataruna".
- Bloco "ITENS" com "Dipirona 500mg 20 comprimidos" e "×1".
- Três botões lado a lado com ícone: "Maps", "WhatsApp" (verde), "CRM".
- Link "Notas & Fotos".
- Botões empilhados e altos: "Cheguei ao local", "Compartilhar localização" e,
  por último, "Marcar como entregue" — este cheio, largo, na cor primária, o
  elemento mais destacado da tela.
Abaixo, seção "HISTÓRICO" com um card de entrega cancelada em coral, com badge
"Cancelado".
```

---

## 3. Pedidos (Kanban) — print `...111617.png`

```
[BLOCO A]

Tela "Pedidos" do admin, desktop 16:9, mesma sidebar do Dashboard.
No topo: abas "Kanban" e "Na rua 2", botões "Entregadores" e "Atualizar" à
direita, e uma linha de chips de filtro por status
(Novos 3 · Separação 0 · Na rua 2 · Entregue 5 · Cancelado 8), cada um com
ícone e sua cor, em fundo suave.

Kanban de 3 colunas com cabeçalho e contador:
- "Novos" (3) — cards de Santos e Silva, Diogo Silva #Mataruna, Luh Oliver.
- "Separação" (0) — estado vazio DESENHADO: ilustração simples em linha,
  "Nenhum pedido" e uma frase auxiliar. Não deixe só texto cinza.
- "Na rua" (2) — dois cards de Diogo Silva #Mataruna.

Cada card: nome do cliente em destaque, tempo decorrido no canto, telefone com
ícone, lista de itens com quantidade (ex.: "×1 Dipirona 500mg 20 comprimidos"),
endereço com ícone de pino, forma de pagamento, valor em verde grande,
entregador designado e um botão de ação principal cheio ("Confirmar Entrega")
com um botão de cancelar discreto ao lado.
Cada coluna identificada por uma borda superior na cor do seu status.
```

---

## 4. Clientes — print `...111018.png`

```
[BLOCO A]

Tela "Clientes" do admin, desktop 16:9, com sidebar.
À esquerda: título "Clientes", "13 cliente(s)", botão "+" de adicionar, campo
de busca "Buscar por nome ou telefone..." e lista de clientes — cada linha com
avatar circular de iniciais colorido, nome, telefone e endereço à direita.
Nomes: Santos e Silva, Diogo Silva #Mataruna, Hugo Malta, Suporte De Eventos,
Samuel Silva, Luh Oliver.

À direita, painel lateral (drawer) aberto sobre a lista, com sombra:
avatar grande "DS", nome "Diogo Silva #Mataruna" e telefone; lista de endereços
com ícones; "13 pedido(s) · R$ 60,70"; "Cliente desde 19/03/2026"; botões
"Editar dados" e "WhatsApp"; caixa âmbar "Obs. farmácia: SEMPRE LIGAR NO WPP
ANTES DE BUZINAR"; campo "Anotações do entregador" com textarea e botão
"Salvar"; seção "Fotos de referência" com uma miniatura e botão "Adicionar
foto"; e "Histórico de pedidos" com badges de status coloridos.
```

---

## 5. Estoque — print `...111601.png`

```
[BLOCO A]

Tela "Estoque de Medicamentos" do admin, desktop 16:9, com sidebar.
Topo: título com ícone e badge "33 itens" à direita; campo de busca largo
"Buscar por nome, laboratório, dosagem, forma, lote...".

Lista de medicamentos agrupados em cards. Cada card tem um cabeçalho de fundo
suave com o nome do medicamento em destaque e, à direita, um badge
"Total: 100 un.". Dentro, uma tabela limpa e arejada com as colunas
FOTO · LABORATÓRIO · DOSAGEM · FORMA · QTD · PREÇO · LOTE · VALIDADE.

Medicamentos: "Água Oxigenada 10 Volumes" (Farmax, 30 mg/ml, 100 mL, 100,
R$ 0,00, lote Kwi1020, validade 2028-03), "Amoxicilina 500mg 21 cápsulas"
(58, R$ 22,00, com foto da caixa), "Atenolol 25mg 30 comprimidos"
(80, R$ 7,50), "Azitromicina 500mg 3 comprimidos" (45, R$ 28,90),
"Benegrip Multi 20 comprimidos" (80, R$ 19,90).

Melhore a hierarquia: quantidade e preço com peso visual, campos vazios como
travessão discreto, célula de foto como um slot de upload elegante quando
vazia, e a validade com cor semântica — verde se distante, âmbar se próxima,
coral se vencida.
```

---

## 6. Login — print `...111032.png`

```
[BLOCO A]

Tela de login centralizada. Acima do card, o símbolo de marca da
"Farmácia Vital" em tamanho grande (o mesmo monograma da sidebar: cruz
farmacêutica combinada com folha, em verde-clínico, dentro de um quadrado
arredondado). Abaixo, "Farmácia Vital" em título forte e "Painel Operacional"
menor em cinza.
Card branco com sombra suave: campos "Email" e "Senha" com rótulos acima e
botão "Entrar" largo na cor primária.
Fundo liso off-white com uma textura sutil quase imperceptível — remova o
padrão xadrez cinza atual, que parece um bug.
Desktop, 16:9.
```
