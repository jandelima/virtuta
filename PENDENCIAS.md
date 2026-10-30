# Pendências — rodada de 23/10

Tudo feito e conferido em captura de tela em 23/10.

Pedidos do Jan. Cada item só sai da lista quando estiver feito e conferido na tela.

## Já definidos (faço direto)
- [x] **Sentar bugado em alguns assentos.** No café o boneco fica em cima da cadeira; no sofá do lounge ele afunda e só a cabeça aparece. Calibrar a altura e a posição de cada tipo de assento pelo próprio modelo 3D (medir onde está o estofado), e conferir todos: mesas, reunião, projetos, café, recepção, sofás, poltronas, bancos e pufes.
- [x] **Quarto computador da fileira de baixo da sala.** Não existe na sala real: a fileira passa a ter 3 mesas (9 no total).
- [x] **Barra horizontal no meio das janelas.** Tirar.
- [x] **Aviso do YouTube ("sua conta está em muitos dispositivos") e música parando.** O player usa a conta do YouTube logada no navegador; com várias abas ou pessoas no mesmo login, o YouTube pausa. Trocar para o modo sem cookies (youtube-nocookie), que não usa a conta.
- [x] **Lag ao andar e parar.** Quando ninguém se mexe, a cena cai para 12 quadros por segundo, e a transição de "andando" para "parado" fica travada. Manter a fluidez durante e logo depois do movimento e subir o mínimo parado, sem perder a leveza.
- [x] **Rádio dentro da sala da equipe**, num canto bom (não no lounge).
- [x] **Contorno azul nas bordas da sala.** Tirar.

## Alinhados com o Jan
- [x] **Paredes:** as paredes internas viradas para a câmera (leste e sul da sala da equipe, sul da reunião) viram uma divisória baixa de vidro, sem colunas pretas. A parede oeste da reunião continua alta, mas com o vidro limpo, sem colunas (só moldura fina em cima e embaixo). As paredes externas do fundo ficam inteiras. A porta da reunião acompanha a altura nova.
- [x] **Rádio:** toca para quem está dentro da sala da equipe e ligou "Ouvir". Ao sair da sala para; ao voltar, retoma no ponto atual da rádio.
- [x] **Quadro aberto:** o quadro ocupa a maior parte da tela e uma faixa à direita continua mostrando a cena 3D ao vivo. No quadro, o cursor de cada pessoa mostra o rostinho do avatar. O mesmo vale para a apresentação de tela.
- [x] **Destaque da sala:** sai o contorno azul e a etiqueta com o nome; fica só o escurecido do lado de fora e o enquadramento da câmera.

# Rodada 2 — 23/10

- [x] **Vidro rebaixado só para quem está dentro da sala**, na altura do armário. Para quem olha de fora, as paredes de vidro ficam inteiras (sem colunas). Vale para a sala da equipe e para a reunião, incluindo a porta.
- [x] **Tirar as mesas de projeto e a função de projetos inteira** (tela de materiais, murais, quadros de projeto, item no menu).
- [x] **Reorganizar o salão com o espaço que sobra**, dando mais respiro entre ambientes e móveis: o lounge sobe para o meio (saindo da porta da sala da equipe), e recepção, café e lazer se espalham embaixo.
- [x] **Costas do boneco atravessando o encosto** em cadeiras de madeira (café, recepção): afastar o quadril do encosto, medindo o encosto no modelo.
- [x] **Conferir todas as funções multiplayer** com várias pessoas.
- [x] **Link para a rede local**, com HTTPS (sem ele, o navegador bloqueia microfone e câmera fora do localhost) e voz e vídeo funcionando para quem entra de outro computador.

# Rodada 3 — 23/10

- [x] **Caixa de sugestões no lugar do jardim** (atrás do sofá do lounge): púlpito com a caixa, onde as pessoas deixam ideias, melhorias ou problemas do site. Fica registrado no servidor, e a administração vê, trata e copia tudo na aba Sugestões.
- [x] **Só o primeiro nome no balão sobre o avatar** (e nas miniaturas de vídeo). Se duas pessoas tiverem o mesmo primeiro nome, aparece a inicial do último sobrenome ("Jan F.", "Jan S."). A lista de pessoas e os painéis continuam com o nome completo.

# Rodada 4 — 23/10

- [x] **Boneco um pouco mais rápido:** de 2,1 para 2,6 m/s, com a animação de andar acompanhando.
- [x] **Cores que vazavam entre partes** (trocar a calça mudava outras coisas; escolher uma cor e ver outra): cada parte do corpo agora tem a sua cor, classificada triângulo a triângulo no modelo.
- [x] **Mais granularidade e qualidade no avatar:** penteado, expressão e roupa separados; cores para pele, cabelo, blusa, detalhes, calça e sapatos (com cor livre); óculos (de grau, redondos, escuros), bigode, cavanhaque, barba, boné, gorro, fone e brincos.
- [x] **Criar o avatar é a primeira coisa** que uma pessoa nova faz ao entrar.
- [x] **Lag em alguns computadores:** luminárias só à noite (de dia pesavam ~40% do desenho sem acender), resolução que se ajusta sozinha quando a máquina não acompanha, menos quadros com a janela em segundo plano, sem desfoque nas barras flutuantes e retratos sem criar um contexto 3D novo a cada atualização.

# Rodada 5 — 23/10

- [x] **Boneco entrando na parede no canto da porta da sala da equipe** (porta junto à parede do fundo): o vão da porta liberava também a faixa colada na parede do fundo.
- [x] **Mesas da fileira de baixo da sala juntas, como a bancada de cima**, sem mudar tamanho nem posição de mesas, cadeiras e computadores.
- [x] **Piso da sala da equipe menos branco e brilhante:** off-white quente e fosco.
- [x] **Trocar de lugar a cadeira laranja e a preta** da bancada principal.
- [x] **Rádio com problemas para tocar links do YouTube:** sem ouvintes a rádio continuava correndo no relógio do servidor; quem ligava depois pedia um ponto além do fim da música, o YouTube recomeçava do zero para cada um e ninguém ficava sincronizado. Agora a rádio pausa sem ouvintes e retoma de onde parou; se a posição passar do fim, segue para a próxima; com uma música só na programação, ela repete.

# Rodada 6 — 28/10: ambientes separados

- [x] **Entrar na sala da equipe**, que ocupa a tela inteira: é tudo o que a pessoa vê enquanto está nela.
- [x] **Hub** com o café, uma mesa para jogos 1 contra 1 (jogo da velha) e a caixa de sugestões; dele saem as portas para a sala da equipe e para a sala de reunião.
- [x] **Sala de reunião** como ambiente próprio, pela porta do hub, com a porta que fecha, as batidas e a chamada única.
- [x] **Portas**: atravessar escurece a tela por um instante; a lista de lugares, a de pessoas, o café e o "Voltei" levam a pessoa pelas portas sozinha.
- [x] **Visitantes no mínimo**: chegam à entrada do hub e esperam ali; não entram na sala da equipe.
- [x] **Saem** o lounge, a recepção com balcão, a área de lazer e o minimapa. A sala da equipe fica como está.

# Rodada 7 — 29/10

- [x] **Sala da equipe com o dobro do tamanho, para baixo, e três ilhas iguais à do meio** (18 mesas). A fileira de baixo sai; os armários ficam como estão.
- [x] **Cadeiras sortidas** em cinco cores (laranja, vermelho, azul, roxo e preto), sem repetir cor entre vizinhas.
- [x] **Câmera mais perto, acompanhando a pessoa**: mesmo tamanho de gente nos três ambientes; na sala, a vista segue quem anda e para nas paredes; o botão abaixo do zoom mostra a sala inteira.
- [x] **Dois ar-condicionados** na parede esquerda da sala, logo depois de cada janela, com uma folga.

# Rodada 8 — 29/10: achados de UX escolhidos (relatorios/ux-2.md e ux-1.md)

- [x] **#1 Criador de avatar** pergunta antes de descartar alterações (clique fora, Esc, Cancelar).
- [x] **#4 Conversa involuntária** ao passar perto de quem está sentado.
- [x] **#5 Nomes dos colegas** em vez de bolinhas sem nome.
- [x] **#7 Placa na porta da sala** para o hub.
- [x] **#8 Dica do objeto** que não sai da tela na borda.
- [x] **#9 Porta fechada da reunião** visível de fora (lista de lugares e luz).
- [x] **#10 Botão de enquadramento** com ícone e rótulo de estado.
- [x] **#11 Aviso quando alguém entra em conversa** com você (som e notificação com a aba escondida).
- [x] **#12 Ícone "em conversa"** na lista, sem confundir com microfone ligado.
- [x] **#13 Microfone e câmera desligados** em cinza, não em vermelho.
- [x] **#14 Cartão da conversa** fora de baixo da gaveta e do aviso de conexão.
- [x] **#15 Aviso de falha de mídia** com "Tentar de novo", fechar e sumindo fora de conversa.
- [x] **#16 Microfone, câmera e tela** com o quadro aberto e na apresentação.
- [x] **#17 "Compartilhar tela"** desabilitado fora de conversa.
- [x] **#19 Pedidos pendentes** que não se perdem na pilha de avisos.
- [x] **#20 Batida na porta** resolvida para todos, e quem foi autorizado entra sozinho.
- [x] **#23 Bilhetes**: marcar como lidos, apagar e fechar o aviso ao abrir.
- [x] **#25 Status**: sugestões com prazo; "Voltei" só para quem foi ao café.
- [x] **#26 Lista de Pessoas**: "Ninguém encontrado" e bilhete para quem está offline.
- [x] **#27 Botão Foco do dock** acompanha a sessão coletiva e não tira ninguém dela.
- [x] **#28 Textos e restos da sessão coletiva.**
- [x] **#29 Convite de pausa** não chega a quem está em reunião ou em conversa.
- [x] **#30 Jogo da velha** libera quem saiu do hub ou ficou parado; sair da mesa levanta o boneco.
- [x] **#31 Botões desabilitados** com cara de desabilitados.
- [x] **#32 Painel da rádio** não apaga o link sendo digitado.
- [x] **#33 Rádio** sem laço de erro com vídeo indisponível; vídeo recolhível.
- [x] **#34 Programação da rádio editável**: remover, aviso de quem pulou, "+" com rótulo.
- [x] **#35 Quadro**: redimensionar, selecionar vários, ferramenta que fica, nome da cópia sem `prompt()`, Esc só desmarca, cópia recuperada na parede.
- [x] **#38 Telas "Você saiu" e "Outra aba"** cobrem o app inteiro.
- [x] **#40 Painel da pessoa** sem repetição, assunto em uma linha e foco automático.
- [x] **#42 Conversa e apresentação** sem redesenhar tudo a cada troca de quem fala.
- [x] **P4 Lista de atalhos** acessível em qualquer tela.
- [x] **P6 Dois "Foco"**: nome e ícone que não se confundem.
- [x] **P7 "Sair do escritório"** confirma quando há conversa ou rádio.
- [x] **P8 Levantar a mão** no lugar do aceno duplicado.
- [x] **De quebra, no mesmo código:** "Responder" um bilhete de quem não tem mesa abria "Mesa livre" (#22); o botão da rádio fora da sala diz "Ouvir ao voltar à sala".

# Rodada 9 — 29/10: três análises independentes (relatorios/ux-3.md, bugs-1.md, produto-1.md)

**Bugs**
- [x] **B1** Ninguém ouve conversa de que não participa (mídia por conversa, decidida pelo servidor).
- [x] **B2** Resposta a "Posso falar?" só vale para pedido que existiu.
- [x] **B3** Revogar convite ou recusar visitante tira o acesso de verdade.
- [x] **B4** O quadro não perde o que se desenha depois de reinício ou queda longa.
- [x] **B5** Depois de reconectar, posição, status e mão voltam certos para todos.
- [x] **B6** Sem conversa fantasma depois de queda rápida.
- [x] **B7** Elemento malformado não inutiliza o quadro.
- [x] **B8** Sem avatar fantasma ao remover acesso ou recusar visitante.
- [x] **B9** Visitante que aguarda não recebe o estado do escritório.
- [x] **B10** Foco coletivo sem sessão zumbi.
- [x] **B11** Rádio só aceita comandos de quem deve (erros definitivos e confirmados; visitante não adiciona).
- [x] **B12** Sessão expirada leva ao login; sessão renovada com o uso.
- [x] **B13** Jogo da velha não expulsa quem esperava sozinho.
- [x] **B14** Fechar a Administração pelo X não deixa Esc preso.
- [x] **B15** Aviso de visitante some para todos quando alguém responde.

**UI e UX**
- [x] **U1** Aba em segundo plano chama a atenção (convite para ativar avisos, título e ícone com pendências).
- [x] **U2** Aviso de microfone desligado dentro da conversa.
- [x] **U3** Janela estreita: lateral recolhida, dock sempre acessível.
- [x] **U4** Cartão da conversa fora de cima de quem conversa, recolhível; avisos não caem no meio da cena.
- [x] **U5** "Posso falar?" com espera, cancelamento e prazo (e batida na porta com prazo).
- [x] **U6** Ação principal conforme o estado do colega; dica ao passar o mouse sobre pessoas.
- [x] **U7** Foco coletivo anunciado a todos; contagem só dos blocos de foco; dock sem confusão.
- [x] **U8** Primeira orientação e dica de teclas compacta em notebook.
- [x] **U10** Porta controlada pelo cartão da reunião; rostos de quem está dentro; reunião vale mais que foco.
- [x] **U11** Formulários com Enter, "Adicionando…" e erro junto do campo.
- [x] **U12** Rádio compacta quando não faz sentido destacar.
- [x] **U13** Estado com forma além da cor; reunião sem o vermelho de alerta.
- [x] **U14** Um contador só de pendências, no sino.
- [x] **U15** Rótulos legíveis no hub.

**Produto**
- [x] **P5** "Me avise quando estiver livre" e "quando chegar"; "Te chamo quando terminar".
- [x] **P10** Conversa reservada, com pedido para entrar.
- [x] **P12** Falar com a sala toda.
- [x] **De quebra:** quem entrava no escritório não recebia a lista das conversas já em andamento (só chegava quando alguma mudava); a lista de telas compartilhadas já vistas era zerada a cada redesenho do cartão da conversa.
