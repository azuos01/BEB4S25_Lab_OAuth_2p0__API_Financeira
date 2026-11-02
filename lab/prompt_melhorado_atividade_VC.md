# Prompt revisado — Procedimento de laboratório (Técnico em Desenvolvimento de Sistemas)

> **Antes de usar:** anexe nesta conversa o material didático de referência (a aula específica que será trabalhada), indicando a **disciplina, o bimestre, a semana, a aula e o tema**. O prompt abaixo pressupõe esse arquivo como entrada. Se algum desses dados não estiver explícito, extraia-o do próprio arquivo (título, rodapé, nome do arquivo — ex.: `SISANO2C2B4S25A1AP` = 2ª série, 4º bimestre, semana 25, aula 1, atividade prática).

---

## Papel

Aja como professor(a)/instrutor(a) da Sec. Educ. do Estado de São Paulo, no Programa de Educação Profissional Paulista, curso Técnico em Desenvolvimento de Sistemas, na disciplina indicada no material anexado (ex.: Versionamento de Código, Programação Front-End, Programação Back-End, CI/CD).

## Entrada

Analise o arquivo anexo e identifique a disciplina, a série, o bimestre, a semana, a aula e o tema. Use-o como base de conteúdo para o procedimento abaixo. Se o material for apenas teórico, proponha um exercício prático executável que exercite os conceitos do material, sem descartar as tarefas originais (estudo, caso prático, perguntas).

## Contexto do ambiente de laboratório

- Sistema operacional: Windows (PowerShell 5.1+ como shell padrão)
- Ferramentas: Git, Visual Studio Code, Node.js/npm (informar versões mínimas recomendadas)
- Trabalho em grupo (informar nº de alunos por grupo; se não houver restrição, assumir 2–4)
- Duração estimada da aula/atividade: [preencher — ex.: 2 aulas de 50 min], com a divisão do tempo por etapa

## O que gerar — procedimento passo a passo

1. Barra horizontal de progresso (passos executados / total de passos).
2. Checklist editável dos recursos necessários (software, extensões, arquivos de partida).
3. Para cada passo: instrução completa, comando(s) exato(s), o ambiente onde executar (PowerShell, Git, VS Code, navegador etc.) e **um exemplo do resultado esperado em caso de sucesso e um exemplo de saída típica em caso de falha** (com a correção correspondente).
4. Código completo de todos os arquivos requeridos — código-fonte do exercício (HTML/CSS/JS ou equivalente) **e arquivos de configuração** (ex.: `package.json`, `.gitignore`, workflows de CI/CD, arquivos `.http`), quando aplicável — prontos para copiar/colar ou salvar.
5. Respostas completas das perguntas da tarefa presentes no material de referência (incluindo o caso prático, se houver).
6. Rubrica objetiva de avaliação para cada pergunta/etapa (critério de certo/errado ou pontuação, com total).

## Artefatos finais a entregar

### A) Script de execução

Script (`.ps1` ou `.sh`, especificar) que automatiza a preparação do ambiente e, sempre que a atividade permitir, **executa de fato** as etapas do exercício — não apenas cria os arquivos: cria a estrutura de pastas e os arquivos de código, instala dependências, roda build/testes e sobe o serviço/servidor local de preview para validar um resultado concreto (ex.: chamar um endpoint de health-check, checar um arquivo de saída gerado, conferir o código de saída de um comando). **Não deve depender de interação humana.**

Estrutura obrigatória do script:

- **Cabeçalho com tabela de referência**: para cada passo de verificação/execução, documentar em comentário Ambiente, Comando exato, um exemplo de saída esperada em caso de sucesso e um exemplo de saída típica em caso de falha — serve de documentação e de guia de suporte para o professor em sala.
- **Função reutilizável de registro de passo** (ex.: `Registrar-Passo`) que recebe nome do passo, ambiente, comando, exemplos de sucesso/falha, a ação a executar (scriptblock) e a dica de correção — sem duplicar try/catch em cada passo.
- Cada passo deve **validar o resultado de fato** (não apenas assumir sucesso): arquivo gerado, código de saída do processo, conteúdo de uma resposta HTTP etc. Quando a etapa depende de um processo assíncrono (ex.: servidor subindo), implementar **tentativas com espera (retry/backoff)** antes de declarar falha.
- Comentar no código as decisões técnicas não óbvias (armadilhas de Windows/PowerShell 5.1, condições de corrida, path/encoding, política de execução etc.) que um instrutor precisaria saber para dar suporte à turma.
- Deixar explícito, nos comentários e no relatório final, quais passos são 100% automatizáveis localmente e quais exigem **ação manual** do aluno (login em serviços externos, criação de repositório remoto, `git push`, conta em plataforma de deploy, chave de API, registro de evidências). **O script nunca deve tentar automatizar login, push ou deploy remoto** — apenas preparar tudo localmente e instruir claramente o próximo passo manual.
- Ao final, exibir um **resumo em tabela** (passo, ambiente, comando, status) no console e **exportá-lo para um arquivo de log (CSV)** dentro da pasta do projeto, informando quais passos executaram com sucesso, quais falharam ou precisam de ação manual (indicando o que falta configurar no ambiente) e as **instruções para corrigir cada problema**.

### B) Página web (HTML/CSS/JS, standalone)

Interativa, em arquivo único (sem dependências externas obrigatórias). Deve conter, nesta ordem:

1. Introdução com o texto: *"Atividade elaborada pelo Prof. Marcos Souza, baseado nos materiais didáticos fornecidos pela Sec. Educ. do Estado de São Paulo para o programa de Educação Profissional Paulista, curso Técnico em Desenvolvimento de Sistemas, na disciplina de [disciplina] – [série, bimestre, semana, aula e tema do material anexado]."* Seguido do parágrafo: *"A ferramenta de inteligência artificial Claude, desenvolvida pela Anthropic, foi utilizada para otimizar esta atividade."* — preenchido automaticamente com o modelo usado e a data/hora atual (não deixar para o aluno preencher).
2. Campo de texto (input) para o nome dos alunos do grupo, logo abaixo da introdução.
3. Checklist de recursos + todos os passos como itens marcáveis; a barra de progresso atualiza em tempo real via JavaScript conforme os itens (recursos inclusos) são marcados. Cada passo exibe os exemplos de sucesso e de falha (item 3 da seção anterior).
4. Bloco de respostas das questões oculto (`display:none` ou equivalente) até o progresso atingir ≥ 50%; ao atingir, revela automaticamente.
5. Seção "Fontes" ao final, listando o material de referência e demais fontes usadas.
6. Campo de feedback do aluno (texto livre) ao final da página.
7. Estado (checklist marcado, nomes preenchidos) deve persistir em memória durante a sessão (sem localStorage).
8. **Tema da página: "dark"** (fundo escuro, contraste adequado para leitura e para os blocos de código).

### C) Documento PDF

Estático — não pode reproduzir a lógica condicional da página web. Deve representar o **estado final completo** da atividade (100% concluída, todas as respostas visíveis), mantendo os mesmos elementos de conteúdo do item B (1; 2 como campo preenchível ou em branco para impressão; 3 como checklist já marcado, com os exemplos de sucesso/falha; 4 com respostas visíveis; 5; 6 como campo em branco para preenchimento manual). Pode usar paleta clara, adequada à impressão.

## Observações

- Idioma: português (Brasil).
- Nomear os arquivos de saída de forma consistente (ex.: `atividade-<tema>_script.ps1`, `atividade-<tema>.html`, `atividade-<tema>.pdf`, `relatorio-preparacao.csv`).
- Citar fontes no formato [Título](URL) quando aplicável.
- Antes de entregar, testar o que for possível (rodar o código e os testes, abrir a página, conferir o PDF) e informar o que não pôde ser testado.
