# Card do Vendedor — Painel rápido para Windows

Painel flutuante e compacto para registrar diariamente os serviços e produtos de um atendente dos Correios e gerar um único relatório consolidado no fechamento do mês. O painel é aberto pelo ícone na área de notificação (perto do relógio), sem manter uma janela comum na barra de tarefas.

## O que está implementado nesta versão 0.6.0

- Painel compacto, sem moldura e sempre acima das outras janelas, com ícone na área de notificação do Windows.
- O painel inicia oculto e aparece ao clicar no ícone perto do relógio. O segundo clique oculta novamente quando ele está em foco.
- Abertura posicionada no canto inferior direito da área útil da tela, acima da barra de tarefas.
- Controles próprios para arrastar, minimizar, maximizar/restaurar, alternar entre o painel completo e o modo micro de aproximadamente 10 × 3 cm, e ocultar o painel. Duplo clique na barra superior do painel completo também alterna maximizar/restaurar.
- Ocultar/minimizar não encerra o aplicativo; o menu da bandeja oferece a opção **Sair do aplicativo**.
- Interface horizontal para uso rápido no balcão: painel completo de 1080 × 270 e novo modo micro de aproximadamente 10 × 3 cm (378 × 113 px lógicos). O modo micro alinha os sete lançamentos em uma faixa com um botão grande de +1 em cada indicador; a data também pode ser trocada nesse formato. O modo escolhido fica salvo e é restaurado ao abrir o aplicativo.
- Tela principal simplificada no estilo Fluent/Windows 11: sete cartões de ação em uma única linha, com menos informação concorrente e cores neutras com azul de destaque do Windows.
- Um clique em qualquer área livre do cartão registra +1; o número é clicável para editar diretamente a quantidade.
- Atalhos de teclado `1` a `7` registram PAC, SEDEX, Premium, VD, AR, Embalagem e produto sazonal, respectivamente. `Ctrl+Z` ou o botão **Desfazer** reverte o último toque.
- Salvamento automático após os lançamentos; status visível na barra inferior.
- Lançamento diário de PAC, SEDEX, Premium 10 e 12, VD, AR e Embalagem.
- Produto sazonal configurável por mês: o atendente altera o nome do produto (por exemplo, Chip Correios Celular) e a meta mensal em unidades. A configuração de cada mês fica preservada, sem mudar os meses anteriores.
- Histórico com reabertura, correção e exclusão de dias.
- Resumo mensal e exportação de um arquivo Excel com resumo + detalhe diário, usando o nome do produto sazonal definido para aquele mês.
- Backup JSON e restauração dos dados, incluindo configurações sazonais por mês. A restauração abre o seletor nativo do Windows, valida o conteúdo, aceita o campo antigo `cellular` e substitui os registros em uma única transação SQLite para evitar restaurações pela metade.
- Banco SQLite local, sem conta, servidor ou conexão com a internet.
- Compatibilidade com os registros das versões anteriores: as quantidades antigas de Correios Celular são preservadas como quantidade do produto mensal configurável.

## Modo micro de 10 × 3 cm

No cabeçalho do painel completo, o botão com ícone de redução alterna para o modo micro. Ele mostra os sete indicadores em uma única faixa horizontal, com contador e um botão +1 grande para cada indicador; para corrigir quantidades, basta voltar ao painel completo; clicar no nome abre a configuração do produto sazonal, e o botão de expandir retorna ao painel completo. A data do lançamento pode ser alterada no próprio modo micro. Configurações de perfil e produto abrem automaticamente o painel completo para não comprimir formulários.

O tamanho de 378 × 113 é definido em pixels lógicos do Tauri, uma aproximação de 10 × 3 cm em escala de 96 DPI. A dimensão física percebida pode variar conforme a escala do Windows e o monitor utilizado.

## Sobre o termo “widget” no Windows 11

Esta versão funciona como um **painel flutuante da área de notificação** (ícone próximo ao relógio). Ela não é, ainda, um widget registrado no Painel de Widgets do Windows (`Win + W`). O Painel de Widgets é uma área separada do Windows e exige um provedor de widget nativo/empacotado; isso é uma integração adicional, não apenas uma configuração visual do Tauri.

A janela principal do painel abre em orientação horizontal (1080 × 270, com largura mínima de 1000 px) e não aparece como um programa comum na barra de tarefas (`skipTaskbar: true`). O acesso rápido é feito pelo ícone na área de notificação.

## Regras de cálculo preservadas do arquivo enviado

As fórmulas foram lidas diretamente da planilha `CARD DO VENDEDOR EXCEL - EDITAVEL.xlsx`:

- **SEDEX %:** SEDEX ÷ (PAC + SEDEX).
- **Premium 10 e 12 %:** Premium ÷ (PAC + SEDEX + Premium).
- **VD %, AR % e Embalagem %:** quantidade do indicador ÷ (PAC + SEDEX + Premium).
- **Produto sazonal do mês:** quantidade vendida no dia, com nome e meta em unidades configuráveis para cada mês. O nome padrão é “Correios Celular” para manter compatibilidade com a planilha original, mas pode ser trocado (por exemplo, chip ou outro produto da campanha). A meta fica guardada por referência mensal.
- **Correios Celular no Excel original:** a fórmula de total correta exclui a coluna B (meta) e soma as colunas C até G: `=SOMA(C16:G16)`. No aplicativo, a meta é armazenada separadamente e não entra no total de vendas.

As metas iniciais vêm da coluna META do modelo: SEDEX 88%, Premium 2,65%, VD 35%, AR 35% e Embalagem 40%. Elas podem ser ajustadas no perfil. PAC não possui meta numérica preenchida no arquivo. A meta do produto sazonal é configurada separadamente por mês, em unidades.

No relatório mensal, as taxas são recalculadas sobre os totais do mês. A tabela diária também mostra as taxas de cada dia.

## Executar em modo de desenvolvimento no Windows

Pré-requisitos:

1. Windows 10 ou 11 de 64 bits.
2. Node.js LTS e npm.
3. Rust instalado pelo `rustup`.
4. Rust 1.90 ou superior, necessário para o plugin de diálogos do Windows.
5. Visual Studio 2022 Build Tools com a carga **Desenvolvimento para desktop com C++**.
6. WebView2 Runtime (normalmente já presente no Windows 11).

Abra o PowerShell nesta pasta e execute:

```powershell
npm install
npm run tauri dev
```

Para abrir apenas uma prévia no navegador (sem bandeja e sem SQLite):

```powershell
npm install
npm run dev
```

A prévia do navegador usa `localStorage`; o aplicativo Tauri instalado usa SQLite. Os controles de janela e o ícone de bandeja só funcionam na versão Tauri.

## Gerar os instaladores usando o GitHub (sem compilar no computador)

O repositório inclui o workflow `.github/workflows/build-windows.yml`. Depois de enviar todo o projeto ao GitHub:

1. Abra o repositório no GitHub e entre na aba **Actions**.
2. Selecione **Build instalador Windows**.
3. Clique em **Run workflow** e confirme em **Run workflow**.
4. Aguarde a execução terminar com o status verde.
5. Abra a execução concluída e baixe o artefato **Card-do-Vendedor-nsis** para obter o instalador `.exe`. Esse artefato contém o instalador `.exe` (NSIS).

Esse processo usa um executor Windows hospedado pelo GitHub e não publica automaticamente uma Release. O arquivo fica disponível como artefato da execução do workflow. O workflow é manual: novas compilações só serão iniciadas quando você clicar em **Run workflow**.

A primeira compilação pode levar alguns minutos porque o GitHub precisa baixar as dependências do projeto e compilar as partes Rust do Tauri. O instalador não é assinado digitalmente; o Windows pode exibir um aviso do SmartScreen na primeira instalação.

## Gerar os instaladores do Windows

No PowerShell:

```powershell
npm install
npm run build:windows
```

Ou execute `build-windows.ps1`.

Os instaladores devem aparecer em:

- `src-tauri/target/release/bundle/nsis/` (instalador `.exe`)
- `src-tauri/target/release/bundle/msi/` (instalador `.msi`)

A geração do instalador precisa ser feita em um ambiente Windows com os pré-requisitos acima. Este pacote contém o código-fonte; não contém um `.exe` já compilado.

## Armazenamento e segurança dos dados

O banco `card-vendedor.sqlite3` é criado na pasta de dados do aplicativo do usuário do Windows (`app_data_dir` do Tauri). Cada instalação mantém seus próprios registros. Use **Exportar backup dos dados** antes de trocar de computador ou formatar o Windows e **Restaurar backup** no novo ambiente. A restauração agora seleciona o arquivo por uma janela nativa do Windows, verifica a estrutura e as quantidades e só então grava o conteúdo. O banco é atualizado por transação: se algum registro falhar, a restauração inteira é revertida.

O aplicativo não envia os dados para terceiros. O relatório Excel e o backup abrem a janela nativa **Salvar como**, para o atendente escolher a pasta e o nome do arquivo.
