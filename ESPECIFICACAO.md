# Escritório virtual — especificação de produto 0.1

Status: primeira consolidação da especificação em alto nível, em 22 de outubro de 2026.

Este documento reúne o escopo definido na conversa para orientar a implementação. As funcionalidades formam um catálogo único, sem divisão em fases de entrega. Regras complementares ainda não confirmadas são identificadas como propostas ou decisões abertas.

## 1. Objetivo e contexto

Criar um ambiente virtual de trabalho para uso interno de uma equipe de 5 a 10 pessoas simultâneas. O ambiente deve facilitar presença, conversas espontâneas, reuniões, concentração e pausas compartilhadas.

O acesso acontece em uma página de navegador que permanece aberta durante o expediente, inclusive enquanto a pessoa trabalha em outras abas e aplicativos.

Cada pessoa é representada por um avatar em um escritório visto de cima. O espaço é inspirado na sala física da equipe, com liberdade para adaptar o layout e acrescentar ambientes.

Voz, câmera e compartilhamento de tela integram o escopo. Baixa latência, boa qualidade de comunicação e consumo moderado de recursos são requisitos centrais.

O estilo visual ainda não foi escolhido. Esta especificação não fixa a arquitetura, as tecnologias ou a hospedagem.

## 2. Identidade e presença

- Cada integrante tem nome, avatar e uma mesa pessoal identificada.
- Ao entrar no escritório, microfone e câmera começam desligados. Sua ativação depende da própria pessoa.
- Ao sair do escritório, o avatar é removido do mapa.
- A mesa permanece como referência do integrante, inclusive para receber bilhetes pessoais.
- A interface mostra disponibilidade e localização dos integrantes presentes.
- Os estados contemplados são disponível, em foco, em reunião e ausente temporariamente.
- Uma mensagem curta pode complementar o estado, como “almoçando, volto às 14h”.
- Uma lista compacta permite localizar colegas, mostra o ambiente onde cada um está e leva até eles, atravessando as portas.
- Trocar de aba não deve, por si só, indicar ausência ou interromper uma conversa.
- Perda de conexão e ausência escolhida devem ter indicações distintas.

O tratamento de sessões abertas em múltiplas abas, computadores suspensos e desconexões transitórias ainda precisa ser detalhado.

## 3. Organização do escritório

Definido em 28/10: o escritório tem três ambientes, cada um uma cena própria. Quem está num ambiente vê só ele, enquadrado inteiro, e só vê e conversa com quem está ali.

| Ambiente | Função |
| --- | --- |
| Sala da equipe | Onde todos entram: mesas pessoais (trabalho e encontros espontâneos), quadro da sala e rádio. |
| Hub | Café (pausa com a equipe ou ausência), mesa de jogos 1 contra 1 e caixa de sugestões. Visitantes chegam pela entrada do hub. |
| Sala de reunião | Conversa compartilhada entre os ocupantes, isolada das pessoas de fora. |

- Portas ligam a sala da equipe ao hub e o hub à sala de reunião. Atravessar uma porta escurece a tela por um instante e a pessoa aparece logo depois da porta do outro lado.
- A porta da sala da equipe fica sempre aberta. A da reunião pode ser fechada por quem está dentro; vista do hub, uma luz sobre ela fica verde (aberta) ou vermelha (fechada), e quem chega bate.
- Ir a outro ambiente pela lista de lugares, pela lista de pessoas ou pelos atalhos (café, voltar à mesa) leva a pessoa pelas portas sozinha.
- Saíram em 28/10: o lounge, a recepção com balcão e espera, a área de lazer com pufes e o minimapa.
- A sala da equipe continua com a mesma disposição; o Jan vai alterá-la depois.

Os quadros ficam na sala da equipe e na sala de reunião.

A interação acontece no próprio objeto: ao passar o mouse, ele ganha destaque e uma dica do que o clique faz. Clicar leva a pessoa até o objeto e o usa (sentar numa cadeira, abrir um quadro, bater na porta).

A mudança de função de uma área específica é uma possibilidade a explorar. Ela não substitui os espaços dedicados nem concentra todas as atividades em uma única sala multifuncional.

O layout concreto, as dimensões, o estilo visual, os controles de movimentação e as possibilidades de personalização ainda serão definidos.

## 4. Conversas por proximidade

- Aproximar-se de uma pessoa disponível permite iniciar automaticamente uma conversa com voz e câmera, respeitando os dispositivos ativados por cada participante.
- A interface identifica claramente o grupo e quem participa da conversa.
- Áudio, vídeo e tela compartilhada ficam restritos aos participantes da conversa correspondente.
- Afastar-se permite sair da conversa e encerra o acesso à sua mídia.
- Passar pelo escritório não deve gerar uma sequência de conexões involuntárias.
- Pequenos movimentos não devem provocar desconexões frequentes.
- O modo foco impede conexões automáticas.
- Um colega pode enviar um pedido discreto de atenção, como “Posso falar?”, que o destinatário pode aceitar ou recusar.
- Acenos e reações rápidas permitem interações sem ativar o microfone.
- Entrar em uma conversa não reativa um dispositivo desligado pela pessoa.

Regras complementares propostas:

- Exigir uma breve permanência em proximidade antes de conectar.
- Aplicar uma pequena tolerância ao afastamento antes de desconectar.
- Impedir que a aproximação entre dois grupos funda suas chamadas automaticamente.

Permanecem abertos os tempos, as distâncias, o limite de participantes, o tratamento de paredes e as regras de formação, entrada, saída e divisão dos grupos.

## 5. Reuniões e compartilhamento de tela

- Todos os ocupantes de uma sala participam da mesma chamada, independentemente da distância entre seus avatares.
- Pessoas externas à sala não recebem seu áudio, vídeo ou conteúdo compartilhado.
- A chamada da sala tem precedência sobre proximidade com pessoas de fora.
- A porta pode ficar aberta ou fechada. Quando fechada, a entrada depende de solicitação e autorização.
- Uma visualização de reunião privilegia câmeras e conteúdo apresentado, mantendo acesso ao mapa.
- O compartilhamento de tela é iniciado explicitamente por quem apresenta.
- Duas pessoas podem compartilhar simultaneamente, inclusive com visualização lado a lado.
- Um apontador colaborativo e marcações temporárias ajudam a indicar partes da apresentação sem alterar o material original.
- A interface mostra participantes, quem está falando e quem está apresentando.
- Controles permitem ativar e desativar microfone e câmera, selecionar dispositivos e testar áudio e imagem.
- Atalhos de teclado atendem às ações frequentes enquanto a página está em foco.

Quem pode autorizar entradas, o destino de uma apresentação ao deixar a chamada e os detalhes de controle das marcações ainda serão definidos.

## 6. Disponibilidade, café e notificações

- A pessoa pode ativar foco individual na própria mesa.
- Foco protege de conexões automáticas e mantém a disponibilidade claramente indicada.
- A ação “Fui tomar café” leva o avatar até a máquina de café do hub e suspende sua participação em conversas.
- A ação “Voltei” permite retornar à mesa.
- A pausa no café do hub é social e não ativa AFK: a pessoa senta numa das mesinhas e continua disponível.
- Aproximações e pedidos de atenção podem gerar avisos discretos, respeitando disponibilidade e preferências individuais.
- Conversas em andamento continuam enquanto a página está em segundo plano.
- O ambiente oferece notificações fora da página quando permitidas pelo navegador e habilitadas pela pessoa.
- Falhas transitórias têm indicação e tentativa de reconexão automática.

O comportamento de microfone e câmera ao retornar de AFK, encerrar foco e reconectar ainda precisa ser definido. O estado inicial ao abrir o escritório é sempre desligado.

## 7. Sessões coletivas de concentração

- Qualquer integrante pode anunciar uma sessão de foco e escolher sua duração.
- Outras pessoas podem aderir voluntariamente.
- Os participantes acompanham quem aderiu e um temporizador compartilhado.
- A sessão pode combinar blocos de concentração e pausas, inspirados em Pomodoro.
- Durante a concentração, os participantes ficam sinalizados como em foco e protegidos de conexões automáticas.
- O término de um bloco é indicado discretamente, com possibilidade de aderir a uma pausa compartilhada.
- Cada participante pode deixar a sessão explicitamente.
- Trabalhar em outra aba ou aplicativo é compatível com a sessão e não representa abandono.

Ainda serão definidos os ciclos de foco e pausa, a entrada após o início, interrupções, saída do organizador, e persistência dos resultados.

## 8. Quadros brancos e recuperação do trabalho

- Participantes podem desenhar, escrever e organizar post-its simultaneamente.
- É possível salvar o trabalho criado colaborativamente e recuperá-lo depois.
- Quadros salvos têm nome e identificação suficiente para serem encontrados e reabertos.
- O conteúdo não é descartado porque a chamada terminou ou o último participante saiu.
- Quadros ficam associados a uma sala.

Proposta operacional: manter o trabalho corrente salvo automaticamente e oferecer cópias nomeadas para preservar momentos importantes. Recuperar uma cópia não deve sobrescrever silenciosamente uma colaboração em andamento.

Formato de exportação, permissões, histórico de alterações e organização dos quadros salvos permanecem abertos.

## 9. Objetos úteis

- Objetos do escritório abrem as ferramentas usadas pela equipe (quadros, rádio, café, jogo, caixa de sugestões, portas).
- As mesas de projeto foram retiradas em 23/10: não se mostraram úteis para a equipe.
- O jardim do foco coletivo saiu em 23/10 para dar lugar à caixa de sugestões. O foco coletivo continua, pelo botão do topo.

### Caixa de sugestões

- Um púlpito no hub, encostado na parede do fundo, com a caixa e uma placa acima.
- Integrantes deixam um bilhete do tipo ideia, melhoria ou problema. Visitantes não usam a caixa.
- Quem escreveu acompanha os próprios bilhetes e vê quando foram marcados como feitos ou descartados.
- A administração recebe um aviso quando chega um bilhete novo e acompanha tudo na aba Sugestões: marca como feita, descarta, reabre e copia as abertas em texto para tratar depois.
- Cada bilhete guarda autor, data e o navegador usado, para ajudar a reproduzir problemas.

## 10. Bilhetes pessoais nas mesas

- Bilhetes pessoais fazem parte do escopo.
- É possível deixar uma mensagem associada à mesa de um colega.
- O bilhete fica salvo para o destinatário consultar posteriormente, inclusive se ele estiver ausente ou offline no momento em que for deixado.
- Sair do escritório e remover o avatar não apaga os bilhetes da mesa.
- A mesa permite perceber que há bilhetes disponíveis para consulta.

Visibilidade, notificação, organização de bilhetes lidos, exclusão e prazo de retenção ainda serão definidos. A inclusão de bilhetes não inclui um sistema de chat.

## 11. Rádio compartilhada

- A rádio é compartilhada e tem adesão voluntária.
- A rádio fica na sala da equipe: toca para quem ligou "Ouvir" enquanto estiver lá dentro. Ao sair da sala a música para; ao voltar, retoma no ponto em que a rádio está.
- Sem nenhum ouvinte, a rádio pausa: quem ligar depois retoma a música do ponto onde ela parou, e quem entra em seguida ouve sincronizado com os demais.
- A fonte inicial são vídeos ou links do YouTube, reproduzidos pelo player incorporado.
- Quem adere acompanha a programação comum e controla individualmente seu volume ou saída.
- Entrar no escritório não inicia a rádio automaticamente.
- A reprodução deve ter alinhamento suficiente para uma experiência compartilhada; a tolerância de sincronização será definida.
- Conteúdo indisponível deve ter indicação e permitir seguir para outro item.
- A experiência deve respeitar as interações necessárias para iniciar reprodução em cada navegador.

Permanecem abertos o controle da fila, as permissões para trocar vídeos, o comportamento durante chamadas e o tratamento de entradas e reconexões na rádio.

## 12. Convivência e lazer

- Reações rápidas e acenos permitem pequenas interações sociais.
- Uma pessoa pode convidar colegas para uma pausa no café do hub (pela máquina de café).
- A adesão às pausas é voluntária.
- A mesa de jogos do hub tem o jogo da velha, para duas pessoas. Jogos novos ficam para uma etapa separada.
- Personalização do avatar (definida em 23/10):
  - Quem entra pela primeira vez cria o avatar antes de tudo; depois, muda pelo próprio menu.
  - Peças: penteado (11, incluindo careca), expressão (5) e roupa (10), combináveis entre si.
  - Cores separadas para pele, cabelo (vale para barba e bigode), blusa, detalhes da roupa (gravata, colar, suspensório), calça ou saia e sapatos, com paleta e cor livre.
  - Acessórios opcionais: óculos (de grau, redondos ou escuros, com cor da armação), bigode, cavanhaque ou barba, boné ou gorro (com cor), fone de ouvido (com cor) e brincos.
  - O que aparece no criador é exatamente o que a equipe vê no escritório.

## 13. Visitantes e administração

- Um integrante autorizado pode gerar um convite temporário para um visitante.
- O visitante chega à entrada do hub e solicita entrada ao anfitrião. Ele circula só pelo hub e pela sala de reunião.
- O anfitrião pode admitir ou recusar a entrada.
- Visitantes são identificados e têm acesso limitado aos espaços e conteúdos autorizados.
- A administração permite controlar integrantes, convites e configuração do escritório.

Método de autenticação, papéis, permissões, validade e revogação de convites e mecanismo de edição do mapa ainda serão especificados.

## 14. Qualidade e operação

- Priorizar inteligibilidade e continuidade do áudio quando as condições de rede piorarem.
- Manter baixa latência para conversas naturais.
- Preservar legibilidade de documentos e código em compartilhamentos de tela.
- Indicar conexão degradada e reconexão, distinguindo falhas de ausência ou silêncio.
- Buscar recuperação automática de falhas transitórias.
- Manter consumo de processamento, memória e rede compatível com trabalho simultâneo em outros aplicativos.
- Preservar dados explicitamente salvos, como quadros e bilhetes.

Metas numéricas de latência, tempo de conexão, qualidade, sincronização e consumo dependem de condições explícitas de teste. Navegadores, sistemas operacionais, localização da equipe, condições de rede, hospedagem e orçamento permanecem em aberto.

## 15. Cenários de validação

- Dez participantes em uma reunião, com voz e câmeras conforme as escolhas individuais.
- Conversas independentes simultâneas no escritório.
- Entrada e saída de conversas por proximidade sem conexões involuntárias frequentes.
- Isolamento de áudio, vídeo e apresentações entre sala e áreas externas.
- Duas telas compartilhadas simultaneamente, incluindo leitura de texto e uso de apontadores.
- Continuidade de chamadas ao alternar abas e aplicativos.
- Foco individual, adesão a foco coletivo e transições para pausas.
- AFK no café e retorno à mesa.
- Salvamento e recuperação de quadros depois que todos saem.
- Entrega e consulta de bilhetes deixados para uma pessoa offline.
- Recepção e autorização de visitantes, respeitando seus acessos.
- Adesão e saída da rádio com controles individuais.
- Falha transitória de conexão, indicação do problema e recuperação.

## 16. Fora do escopo atual e backlog

- Chat: fora do escopo atual, incluindo mensagens diretas, canal geral e chat de chamada. Bilhetes pessoais nas mesas estão incluídos conforme a seção 10.
- Pedido genérico de ajuda ao grupo: não incluído nesta consolidação; a utilidade para uma equipe com papéis específicos permanece em discussão.
- Assistente de IA, transcrição e resumo de reuniões: backlog explícito.

## 17. Decisões abertas antes do detalhamento técnico

- Estilo visual, layout, controles de movimentação e personalização.
- Formação e separação de grupos e regras espaciais de proximidade.
- Comportamento de dispositivos ao retornar de AFK, foco ou falha de conexão.
- Regras detalhadas das sessões de concentração e sua representação visual.
- Persistência, organização, permissões e recuperação de quadros.
- Visibilidade, gestão e retenção dos bilhetes pessoais.
- Governança e sincronização da rádio.
- Modalidades de lazer e transformações possíveis de áreas específicas.
- Autenticação, permissões, edição do escritório e gestão de visitantes.
- Infraestrutura, orçamento, navegadores e sistemas operacionais suportados.
- Metas mensuráveis de desempenho e qualidade.

## 18. Referências consultadas

- [Gather — organização de um escritório](https://support.gather.town/articles/2958572750-take-a-tour-of-an-office-on-gather)
- [WorkAdventure — conversas por proximidade](https://docs.workadventu.re/user/proximity-bubble/)
- [WorkAdventure — disponibilidade](https://docs.workadventu.re/user/availability-status/)
- [Gather — recepção de visitantes](https://support.gather.town/articles/4128932154-remote-office-guest-check-in)
- [Kumospace — áudio por proximidade e por sala](https://www.kumospace.com/help/spatial-and-room-audio)
- [Kumospace — apresentações simultâneas e visualizações](https://www.kumospace.com/help/present-views)
- [YouTube — player incorporado e controles](https://developers.google.com/youtube/iframe_api_reference)

As referências servem de inspiração. O comportamento do produto é definido por esta especificação e pelos refinamentos acordados na conversa.
