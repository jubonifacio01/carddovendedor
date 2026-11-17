# Card do Vendedor — Windows

Aplicativo desktop compacto para registrar diariamente os serviços e produtos de um atendente dos Correios e gerar um único relatório consolidado no fechamento do mês.

## O que está implementado nesta primeira versão

- Janela compacta, sem moldura, com ícone na bandeja do sistema do Windows.
- Clique esquerdo no ícone da bandeja para abrir o painel; menu do botão direito com opções para abrir ou sair.
- Fechar a janela apenas a oculta na bandeja, sem encerrar o aplicativo.
- Perfil individual por computador: nome do atendente e agência.
- Lançamento diário de PAC, SEDEX, Premium 10 e 12, VD, AR, Embalagem e Correios Celular.
- Controles de +1, -1 e edição direta de quantidades.
- Histórico com reabertura, correção e exclusão de dias.
- Resumo mensal e exportação de um arquivo Excel com resumo + detalhe diário.
- Backup JSON e restauração dos dados.
- Banco SQLite local, sem conta, servidor ou conexão com a internet.

## Regras de cálculo preservadas do arquivo enviado

As fórmulas foram lidas diretamente da planilha `CARD DO VENDEDOR EXCEL - EDITAVEL.xlsx`:

- **SEDEX %:** SEDEX ÷ (PAC + SEDEX).
- **Premium 10 e 12 %:** Premium ÷ (PAC + SEDEX + Premium).
- **VD %, AR % e Embalagem %:** quantidade do indicador ÷ (PAC + SEDEX + Premium).
- **Correios Celular:** soma das quantidades lançadas; a meta não entra na soma. A referência corrigida é `=SOMA(C16:G16)` no modelo semanal.

As metas iniciais vêm da coluna META do modelo: SEDEX 88%, Premium 2,65%, VD 35%, AR 35% e Embalagem 40%. Elas podem ser ajustadas no perfil. PAC não possui meta numérica preenchida no arquivo.

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

A prévia do navegador usa `localStorage`; o aplicativo Tauri instalado usa SQLite.

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

O banco `card-vendedor.sqlite3` é criado na pasta de dados do aplicativo do usuário do Windows (`app_data_dir` do Tauri). Cada instalação mantém seus próprios registros. Use **Exportar backup dos dados** antes de trocar de computador ou formatar o Windows e **Restaurar backup** no novo ambiente.

O aplicativo não envia os dados para terceiros. O relatório Excel e o backup abrem a janela nativa **Salvar como**, para o atendente escolher a pasta e o nome do arquivo.
